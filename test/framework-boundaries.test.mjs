import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFramework, cloneFramework } from '../src/framework/state.mjs';
import { applyFrameworkReply, buildFrameworkInstructions } from '../src/framework/protocol.mjs';
import { frameworkVisibleText } from '../src/framework/textContext.mjs';
import { frameworkMessagePresentation } from '../src/framework/presentation.mjs';
import { FrameworkChat } from '../src/framework/chat.mjs';
import { FrameworkObservations, reviewFrameworkChat, frameworkSceneWarnings } from '../src/framework/diagnostics.mjs';

const blocks = () => [...buildFrameworkInstructions().matchAll(/<rpg-framework>\n.*?\n<\/rpg-framework>/g)].map(m => m[0]);
const message = mes => ({mes,is_user:false,swipe_id:0,swipes:[mes],swipe_info:[{extra:{}}]});
const afterFence = (block, open='```', close=open) => `Narrative.\n${open}text\nLegacy status.\n${close}${block}`;

test('a tagged transaction immediately following a matching closing fence is accepted without changing its JSON', () => {
    for (const [open,close] of [['```','```'],['~~~','~~~'],['````','`````']]) {
        const block=blocks()[0],raw=afterFence(block,open,close),base=emptyFramework();
        const result=applyFrameworkReply(raw,base);
        assert.equal(result.accepted,true);assert.equal(result.state.revision,1);
        assert.equal(result.visibleText,raw.slice(0,raw.indexOf(block)).trimEnd());
        assert.equal(base.revision,0);
        const masked=frameworkVisibleText(raw);
        assert.equal(masked.length,raw.length);assert.equal(masked.indexOf('<rpg-framework>'),raw.indexOf('<rpg-framework>'));
    }
});

test('shorter, mismatched, quoted and unclosed fences never execute nested protocol examples', () => {
    const block=blocks()[0];
    const samples=[afterFence(block,'````','```'),afterFence(block,'~~~','```'),
        `\`\`\`json\n${block}\n\`\`\``, `\`\`\`json\n${block}`, `\`\`\`${block}`,
        `> \`\`\`\n> ${block.replaceAll('\n','\n> ')}\n> \`\`\``,
        `Example: \`${block.replaceAll('\n','')}\``,
        afterFence(block,'```','```not-a-closing-fence '),
        afterFence(block,'```','~~~\n')];
    for (const raw of samples) {
        const state=emptyFramework(), result=applyFrameworkReply(raw,state);
        assert.equal(result.accepted,false,raw);assert.equal(state.revision,0);
        assert.equal(result.diagnostic.status,'ignored_protocol');
        assert.equal(frameworkMessagePresentation(raw).visible,raw);
    }
});

test('actual code examples before and after a transaction remain excluded', () => {
    const block=blocks()[0];
    const raw=`\`\`\`json\n${block}\n\`\`\`\n${block}\n~~~json\n${block}\n~~~`;
    const result=applyFrameworkReply(raw,emptyFramework());assert.equal(result.accepted,true);
    const display=frameworkMessagePresentation(raw);assert.equal(display.blocks.length,1);
    assert.equal(display.blocks[0].start,raw.indexOf(block,raw.indexOf(block)+block.length));
});

test('malformed, duplicate and schema-invalid transactions after a fence remain rejected and reviewable', () => {
    for (const block of ['<rpg-framework>{bad:true}</rpg-framework>',
        '<rpg-framework>{"protocol":1}}</rpg-framework>',
        '<rpg-framework>{"protocol":1}', blocks()[0]+blocks()[0],
        blocks()[0].replace('"coins":20','"coins":"invalid"')]) {
        const raw=afterFence(block),base=emptyFramework();
        assert.throws(()=>applyFrameworkReply(raw,base));assert.equal(base.revision,0);
        const display=frameworkMessagePresentation(raw);assert.ok(display.blocks.length);
        assert.equal(display.blocks.map(b=>b.raw).join(''),block);
        assert.equal(display.visible,'Narrative.\n```text\nLegacy status.\n```');
    }
});

test('CRLF, tabs and literal braces or tags in field strings preserve exact source evidence', () => {
    const block=blocks()[0].replace('At the east pier; boarding has begun.','A `sign` says } and </rpg-framework>.');
    const raw=afterFence(block,'```','```\t').replaceAll('\n','\r\n');
    const result=applyFrameworkReply(raw,emptyFramework());assert.equal(result.accepted,true);
    assert.match(result.state.entities.find(e=>e.id==='place').description,/A `sign` says }/);
    assert.equal(frameworkMessagePresentation(raw).blocks[0].raw,block.replaceAll('\n','\r\n'));
});

test('same-line fence lifecycle saves once, reloads correctly, and reports ignored examples distinctly', async () => {
    const observations=new FrameworkObservations(), ctx={chat:[],chatMetadata:{}};let saves=0;
    const controller=new FrameworkChat({getContext:()=>ctx,save:async()=>{saves++;},observe:(m,e)=>observations.record(m,e)});
    controller.begin('normal');const first=message(afterFence(blocks()[0]));ctx.chat.push(first);
    assert.equal(await controller.receive(first),true);assert.equal(saves,1);
    assert.equal(await controller.receive(first),false);assert.equal(saves,1);
    const restored=new FrameworkChat({getContext:()=>cloneFramework(ctx),save:async()=>{throw Error('unexpected');}});
    assert.equal(restored.state().revision,1);
    controller.begin('normal');const ignored=message('```json\n'+blocks()[1]+'\n```');ctx.chat.push(ignored);
    assert.equal(await controller.receive(ignored),false);assert.equal(saves,1);
    const rows=reviewFrameworkChat(ctx.chat,observations).rows;
    assert.equal(rows[1].status,'ignored_protocol');assert.equal(rows[1].basis,'observed_this_page');
    assert.equal(reviewFrameworkChat(cloneFramework(ctx.chat)).rows[1].status,'ignored_protocol');
});

test('multiple active scenes produce a nonmutating warning rather than guessing which entities departed', () => {
    const state=applyFrameworkReply(blocks()[0],emptyFramework()).state;
    state.entities.push({id:'elsewhere',label:'Elsewhere',kind:'scene',archived:false});
    const before=cloneFramework(state);assert.deepEqual(frameworkSceneWarnings(state),['multiple_active_scenes']);
    assert.deepEqual(state,before);
    state.entities.find(e=>e.id==='elsewhere').archived=true;assert.deepEqual(frameworkSceneWarnings(state),[]);
    const updated=applyFrameworkReply(blocks()[1],state).state;
    assert.deepEqual(frameworkSceneWarnings(updated),[]);
    assert.equal(updated.entities.find(e=>e.id==='keeper').archived,true);
    assert.equal(updated.entities.find(e=>e.id==='clerk').archived,false);
    assert.equal(updated.entities.find(e=>e.id==='traveler').archived,false);
});
