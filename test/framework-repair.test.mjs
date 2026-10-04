import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameworkChat } from '../src/framework/chat.mjs';
import { emptyFramework, applyFrameworkTransaction, activeFrameworkFields } from '../src/framework/state.mjs';
import { writeFrameworkSnapshot } from '../src/framework/snapshots.mjs';
import { readRepair, repairPrompt, correctedResult } from '../src/framework/repair.mjs';
import { reviewFrameworkChat, frameworkFailure } from '../src/framework/diagnostics.mjs';
import { saveFrameworkVerified } from '../src/framework/storage.mjs';

const init = {protocol:1,id:'init',baseRevision:0,ops:[{op:'init',title:'Space game',entities:[{id:'pilot',label:'Pilot',kind:'player'},{id:'place',label:'Hangar',kind:'scene'}],groups:[{id:'gear',entityId:'pilot',label:'Gear'}],fields:[{id:'weapon',groupId:'gear',label:'Weapon',type:'text'},{id:'credits',groupId:'gear',label:'Credits',type:'number'},{id:'items',groupId:'gear',label:'Supplies',type:'collection',columns:[{id:'name',label:'Name',type:'text'},{id:'qty',label:'Quantity',type:'number'}]}],values:{weapon:'None (discarded)',credits:50000,items:[{id:'medkit',values:{name:'Medkit',qty:2}}]}}]};
const wrap = tx => `<rpg-framework>\n${typeof tx === 'string' ? tx : JSON.stringify(tx)}\n</rpg-framework>`;
const tx = (ops,id='detention') => ({protocol:1,id,baseRevision:1,ops});
const move = {op:'updateDefinition',target:'entity',id:'place',patch:{label:'Interview room',description:'The pilot has been detained.'}};
const bad = tx([move,{op:'upsertItem',fieldId:'weapon',item:null}]);
const good = tx([move,{op:'archive',target:'field',id:'weapon',archived:true}]);
const msg = mes => ({mes,is_user:false,swipe_id:0,swipes:[mes],swipe_info:[{extra:{}}]});
function harness(generate = async()=>wrap(good), limit=2) {
    const opening = msg('Opening'); writeFrameworkSnapshot(opening,applyFrameworkTransaction(emptyFramework(),init).state);
    let ctx={chat:[opening,{mes:'I accept the restraints.',is_user:true}],chatMetadata:{rpg_framework_v1:{mode:'universal'}},draft:'Untouched draft'};
    const requests=[],saved=[],errors=[],observed=[]; let failSave=false;
    const controller = new FrameworkChat({getContext:()=>ctx,save:async()=>{if(failSave)throw Error('PRIVATE save error');saved.push(structuredClone(ctx));},
        generateRepair:async prompt=>{requests.push(prompt);return generate(prompt);},repairLimit:()=>limit,sceneReviewMode:()=> 'off',report:e=>errors.push(e),observe:(m,e)=>observed.push(e)});
    controller.begin('normal'); const reply=msg('The pilot enters the room.\n'+wrap(bad));ctx.chat.push(reply);
    return {controller,reply,requests,saved,errors,observed,get ctx(){return ctx;},set ctx(v){ctx=v;},set failSave(v){failSave=v;}};
}
test('invalid typed removal is corrected in background without changing narrative, history roles or draft',async()=>{
    const h=harness(), original=h.reply.mes, count=h.ctx.chat.length;
    assert.equal(await h.controller.receive(h.reply),true);
    assert.equal(h.requests.length,1); assert.equal(h.ctx.chat.length,count);assert.equal(h.ctx.draft,'Untouched draft');
    assert.equal(h.reply.mes,'The pilot enters the room.');assert.equal(h.reply.swipes[0],h.reply.mes);
    assert.equal(h.controller.state().revision,2);assert.equal(h.controller.state().values.credits,50000);
    assert.equal(activeFrameworkFields(h.controller.state(),'gear').some(f=>f.id==='weapon'),false);
    assert.equal(h.controller.state().entities[1].label,'Interview room');
    const record=readRepair(h.reply);assert.equal(record.original,original);assert.equal(record.status,'corrected');
    assert.equal(record.attempts[0].status,'accepted');assert.deepEqual(h.reply.swipe_info[0].extra.rpg_framework_repairs,h.reply.extra.rpg_framework_repairs);
    assert.equal(h.saved[0].chat.at(-1).extra.rpg_framework_repairs[0].attempts[0].status,'requesting');
    assert.deepEqual(h.requests[0].filter(m=>m.role==='user').map(m=>m.content),['I accept the restraints.']);
    assert.equal(h.requests[0].at(-1).role,'system');assert.match(h.requests[0].at(-1).content,/fieldType.*text/);
    assert.equal(await h.controller.receive(h.reply),false);assert.equal(h.requests.length,1);
    const review=reviewFrameworkChat(h.ctx.chat);assert.equal(review.rows.at(-1).repair.status,'corrected');
    assert.equal(JSON.stringify(review).includes('I accept'),false);
});
test('two invalid repairs stop, retain previous state and cannot restart after reload',async()=>{
    let n=0;const h=harness(async()=>wrap(n++ ? '{bad second}' : '{bad first}'));
    const original=h.reply.mes;assert.equal(await h.controller.receive(h.reply),false);
    assert.equal(h.requests.length,2);assert.equal(h.controller.state().revision,1);assert.equal(h.reply.mes,original);
    assert.equal(readRepair(h.reply).attempts.length,2);
    const next=new FrameworkChat({getContext:()=>h.ctx,save:async()=>{},generateRepair:async()=>{throw Error('must not run');}});
    assert.equal(await next.repair(h.reply,next.state(),Object.assign(new Error(),{}),null),false);
    assert.equal(await next.retryRepair(h.reply),false);assert.equal(readRepair(h.reply).status,'request_failed');
});
test('explicit retry has an independently bounded attempt and preserves previous attempt count',async()=>{
    let n=0;const h=harness(async()=>++n===1?wrap('{bad first}'):wrap(good),1);
    await h.controller.receive(h.reply);assert.equal(h.requests.length,1);
    assert.equal(await h.controller.retryRepair(h.reply),true);assert.equal(h.requests.length,2);assert.equal(readRepair(h.reply).previousAttempts,1);
});
test('identical rejected output stops early and disabled mode sends nothing',async()=>{
    const h=harness(async()=>wrap(bad));await h.controller.receive(h.reply);assert.equal(h.requests.length,2);
    const off=harness(undefined,0);await off.controller.receive(off.reply);assert.equal(off.requests.length,0);assert.equal(off.saved.length,0);
});
test('omitted receipt is checked quietly; explicit no-change receipt preserves gameplay data',async()=>{
    const h=harness(async()=>wrap(tx([],'checked')));h.reply.mes='Nothing has changed.';
    const before=structuredClone(h.controller.state());
    assert.equal(await h.controller.receive(h.reply),true);assert.equal(h.requests.length,1);
    assert.equal(h.reply.mes,'Nothing has changed.');assert.equal(h.ctx.chat.length,3);
    assert.equal(h.controller.state().revision,2);assert.deepEqual(h.controller.state().values,before.values);
    assert.deepEqual(h.controller.state().entities,before.entities);
    assert.equal(readRepair(h.reply).failure.code,'missing_protocol');
    assert.match(h.requests[0].at(-1).content,/遗漏数据回执/);
    assert.equal(await h.controller.receive(h.reply),false);assert.equal(h.requests.length,1);
});

test('omitted NPC update is repaired without inventing a user message or altering narrative',async()=>{
    const npc={op:'create',target:'entity',definition:{id:'engineer',kind:'npc',label:'Engineer',description:'Speaking at the guide screen',visual:{mode:'portrait',subject:'person',description:'Brown jacket, scar above left eyebrow'}}};
    const h=harness(async()=>wrap(tx([npc],'met_engineer')));h.reply.mes='An engineer in a brown jacket, scar above his left eyebrow, answers by the guide screen.';
    const raw=h.reply.mes;assert.equal(await h.controller.receive(h.reply),true);
    assert.equal(h.controller.state().entities.at(-1).id,'engineer');assert.equal(h.reply.mes,raw);
    assert.deepEqual(h.requests[0].filter(m=>m.role==='user').map(m=>m.content),['I accept the restraints.']);
    assert.equal(h.controller.state().values.credits,50000);
});

test('disabled automatic omission correction sends zero calls and permits explicit retry',async()=>{
    const h=harness(async()=>wrap(tx([],'checked')),0);h.reply.mes='Nothing changed.';
    assert.equal(await h.controller.receive(h.reply),false);assert.equal(h.requests.length,0);
    assert.equal(h.observed.at(-1).status,'missing_protocol');
    assert.equal(await h.controller.retryRepair(h.reply),true);assert.equal(h.requests.length,1);
});

test('explicit no-change receipt with review disabled respects revision/replay rules without extra calls',async()=>{
    const h=harness();h.reply.mes='Nothing changed.\n'+wrap(tx([],'checked'));
    assert.equal(await h.controller.receive(h.reply),true);assert.equal(h.requests.length,0);
    assert.equal(h.controller.state().revision,2);assert.equal(h.reply.mes,'Nothing changed.');
    const same=applyFrameworkTransaction(h.controller.state(),tx([],'checked'));assert.equal(same.duplicate,true);
    assert.throws(()=>applyFrameworkTransaction(h.controller.state(),tx([],'stale')),/状态已变化/);
    assert.throws(()=>applyFrameworkTransaction(emptyFramework(),{protocol:1,id:'empty',baseRevision:0,ops:[]}),/尚未初始化/);
});

test('quoted protocol examples never trigger automatic omission correction',async()=>{
    const h=harness();h.reply.mes='```json\n'+wrap(good)+'\n```';
    assert.equal(await h.controller.receive(h.reply),false);assert.equal(h.requests.length,0);
});
for(const [name,mutate] of [
    ['new player turn',h=>h.ctx.chat.push({is_user:true,mes:'New action'})],
    ['edited reply',h=>h.reply.mes='Edited'],
    ['changed swipe',h=>h.reply.swipe_id=1],
    ['deleted reply',h=>h.ctx.chat.pop()],
    ['different chat',h=>h.ctx={chat:[],chatMetadata:{}}],
    ['explicit stop',h=>h.controller.cancelRepair()],
    ['disabled extension',h=>h.controller.enabled=()=>false],
    ['manual change',h=>h.controller.manual([{op:'setValue',fieldId:'credits',value:49999}])],
    ['changed lock',h=>h.controller.manual([{op:'setLock',target:'value',id:'weapon',locked:true}])],
]) test(`pending correction cannot overwrite ${name}`,async()=>{
    let resolve,started;const waiting=new Promise(r=>started=r);
    const h=harness(()=>{started();return new Promise(r=>resolve=r);});const pending=h.controller.receive(h.reply);await waiting;
    await mutate(h);resolve(wrap(good));assert.equal(await pending,false);assert.equal(h.requests.length,1);
    assert.notEqual(readRepair(h.reply)?.status,'corrected');
});
test('duplicate receive events share the in-flight budget',async()=>{
    let resolve,started;const waiting=new Promise(r=>started=r);const h=harness(()=>{started();return new Promise(r=>resolve=r);});
    const pending=h.controller.receive(h.reply);await waiting;assert.equal(await h.controller.receive(h.reply),false);assert.equal(h.requests.length,1);
    resolve(wrap(good));assert.equal(await pending,true);
});
test('network failures stop without exposing provider error bodies',async()=>{
    const h=harness(async()=>{throw Error('PRIVATE KEY VALUE');});await h.controller.receive(h.reply);
    assert.equal(h.requests.length,1);assert.equal(readRepair(h.reply).status,'request_failed');
    assert.equal(JSON.stringify([h.reply,h.errors]).includes('PRIVATE'),false);
});
test('failed budget persistence sends no model request',async()=>{
    const h=harness();h.failSave=true;const before=structuredClone(h.reply);await h.controller.receive(h.reply);
    assert.equal(h.requests.length,0);assert.deepEqual(h.reply,before);assert.equal(h.observed.at(-1).status,'save_failed');
});
test('uncertain final save cannot trigger more correction calls or expose corrected state',async()=>{
    const h=harness(async()=>{h.failSave=true;return wrap(good);});const original=h.reply.mes;await h.controller.receive(h.reply);
    assert.equal(h.requests.length,1);assert.equal(h.reply.mes,original);assert.equal(h.controller.state().revision,1);assert.equal(h.observed.at(-1).status,'save_failed');
    assert.equal(await h.controller.retryRepair(h.reply),false);assert.equal(h.requests.length,1);
});
test('invalid JSON can be repaired without dropping narrative surrounding its data block',async()=>{
    const h=harness();h.reply.mes='Before.\n'+wrap('{broken:1}')+'\nAfter.';
    assert.equal(await h.controller.receive(h.reply),true);assert.equal(h.reply.mes,'Before.\n\nAfter.');
    assert.equal(h.requests.length,1);assert.equal(readRepair(h.reply).failure.status,'parse_rejected');
});
test('repair cannot bypass a parent lock or update credits with a rejected removal',async()=>{
    const h=harness(async()=>wrap({...good,baseRevision:2,ops:[{op:'setValue',fieldId:'credits',value:20000},...good.ops]}));
    h.ctx.chat.pop();await h.controller.manual([{op:'setLock',target:'structure',id:'gear',locked:true}]);
    h.controller.begin('normal');h.reply.mes='Unchanged story.\n'+wrap({...bad,baseRevision:2});h.ctx.chat.push(h.reply);
    assert.equal(await h.controller.receive(h.reply),false);assert.equal(h.requests.length,2);
    assert.equal(h.controller.state().revision,2);assert.equal(h.controller.state().values.credits,50000);
    assert.equal(h.controller.state().entities[1].label,'Hangar');
});
test('successful main transaction with failed save does not ask model to repair storage',async()=>{
    const h=harness();h.reply.mes=wrap(good);h.failSave=true;await h.controller.receive(h.reply);assert.equal(h.requests.length,0);
});
test('new prose and action tags in correction output are rejected, original narrative unchanged',()=>{
    const before=applyFrameworkTransaction(emptyFramework(),init).state;
    for(const extra of ['New plot','<rpg-roll>{}</rpg-roll>','<rpg-portrait>{}</rpg-portrait>']) assert.throws(()=>correctedResult(wrap(good)+extra,before,'Original'),/纠错只能/);
});
test('type errors identify the operation and cannot partially apply preceding valid edits',()=>{
    const before=applyFrameworkTransaction(emptyFramework(),init).state;
    try{applyFrameworkTransaction(before,bad);assert.fail();}catch(e){assert.deepEqual(frameworkFailure(e),{status:'validation_rejected',code:'collection',operation:2,fieldId:'weapon',fieldType:'text'});}
    assert.equal(before.entities[1].label,'Hangar');assert.equal(before.revision,1);
});
test('collection removal, partial consumption and restoration preserve identities and other possessions',()=>{
    let state=applyFrameworkTransaction(emptyFramework(),init).state;
    state=applyFrameworkTransaction(state,tx([{op:'upsertItem',fieldId:'items',item:{id:'medkit',values:{qty:1}}}],'consume')).state;
    state=applyFrameworkTransaction(state,{...tx([{op:'archiveItem',fieldId:'items',itemId:'medkit',archived:true}],'drop'),baseRevision:2}).state;
    assert.equal(state.values.items[0].archived,true);assert.equal(state.values.items[0].values.qty,1);
    state=applyFrameworkTransaction(state,{...tx([{op:'archiveItem',fieldId:'items',itemId:'medkit',archived:false}],'recover'),baseRevision:3}).state;
    assert.equal(state.values.items.length,1);assert.equal(state.values.items[0].archived,false);assert.equal(state.values.credits,50000);
});
test('repair records and preferences participate in verified persistence',async()=>{
    const h=harness();await h.controller.receive(h.reply);
    Object.assign(h.ctx,{chatId:'test',characterId:0,characters:[{name:'Test',avatar:'test.png'}],saveChat:async()=>{},getRequestHeaders:()=>({})});
    let saved=structuredClone([{chat_metadata:h.ctx.chatMetadata},...h.ctx.chat]);
    await saveFrameworkVerified(h.ctx,async()=>({ok:true,json:async()=>saved}));
    saved.at(-1).extra.rpg_framework_repairs[0].status='failed';
    await assert.rejects(saveFrameworkVerified(h.ctx,async()=>({ok:true,json:async()=>saved})),/回读/);
});
