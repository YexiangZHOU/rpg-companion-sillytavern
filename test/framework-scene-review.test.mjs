import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameworkChat } from '../src/framework/chat.mjs';
import { emptyFramework, applyFrameworkTransaction } from '../src/framework/state.mjs';
import { writeFrameworkSnapshot } from '../src/framework/snapshots.mjs';
import { readRepair, correctedResult } from '../src/framework/repair.mjs';
import { readMedia, writeMedia } from '../src/framework/media.mjs';
import { saveFrameworkVerified } from '../src/framework/storage.mjs';

const wrap = tx => `<rpg-framework>${JSON.stringify(tx)}</rpg-framework>`;
const message = mes => ({mes,is_user:false,swipe_id:0,swipes:[mes],swipe_info:[{extra:{}}]});
const initial = {protocol:1,id:'start',baseRevision:0,ops:[{op:'init',title:'Space game',entities:[{id:'pilot',kind:'player',label:'Pilot'},{id:'place',kind:'scene',label:'Dock',description:'At the dock'},{id:'ship',kind:'ship',label:'Ship'}],groups:[{id:'gear',entityId:'pilot',label:'Gear'}],fields:[{id:'credits',groupId:'gear',label:'Credits',type:'number'}],values:{credits:50000}}]};
const npc = {op:'create',target:'entity',definition:{id:'technician',kind:'npc',label:'Dock technician',description:'Nods at the pilot by the console',visual:{mode:'portrait',subject:'person',description:'Orange work clothes, stubble'}}};
const scene = {op:'updateDefinition',target:'entity',id:'place',patch:{description:'The pilot sees a technician by the console'}};
function harness({mode='noop',limit=2,provider}={}) {
    const opening=message('Opening');writeFrameworkSnapshot(opening,applyFrameworkTransaction(emptyFramework(),initial).state);
    let ctx={chat:[opening,{mes:'Is anyone nearby?',is_user:true}],chatMetadata:{rpg_framework_v1:{mode:'universal'}},draft:'Keep this draft'};
    const calls=[],saves=[];
    const controller=new FrameworkChat({getContext:()=>ctx,save:async()=>saves.push(structuredClone(ctx)),sceneReviewMode:()=>mode,repairLimit:()=>limit,
        generateRepair:async prompt=>{calls.push(prompt);return provider ? provider(prompt) : wrap({protocol:1,id:'review',baseRevision:controller.state().revision,ops:[npc,scene]});}});
    controller.begin('normal');const reply=message('A technician in orange work clothes, with stubble, nods at you by the console.\n'+wrap({protocol:1,id:'nochange',baseRevision:1,ops:[]}));ctx.chat.push(reply);
    return {controller,reply,calls,saves,get ctx(){return ctx;},set ctx(value){ctx=value;}};
}

test('a syntactically valid no-change receipt gets one quiet cast review and preserves accepted gameplay/media',async()=>{
    const h=harness();writeMedia(h.ctx.chat[0],{'entity:place':{url:'/user/images/dock.png',status:'ready'}});
    const count=h.ctx.chat.length;
    assert.equal(await h.controller.receive(h.reply),true);assert.equal(h.calls.length,1);
    assert.equal(h.controller.state().revision,3);assert.equal(h.controller.state().entities.at(-1).id,'technician');
    assert.equal(h.controller.state().values.credits,50000);assert.equal(h.ctx.chat.length,count);assert.equal(h.ctx.draft,'Keep this draft');
    assert.equal(h.reply.mes,'A technician in orange work clothes, with stubble, nods at you by the console.');
    assert.equal(readMedia(h.ctx.chat)['entity:place'].url,'/user/images/dock.png');
    assert.equal(readRepair(h.reply).purpose,'review');assert.equal(readRepair(h.reply).status,'corrected');
    assert.deepEqual(h.calls[0].filter(m=>m.role==='user').map(m=>m.content),['Is anyone nearby?']);
    assert.match(h.calls[0].at(-1).content,/原事务已经保存/);
    assert.match(h.calls[0].at(-1).content,/未知姓名/);
    assert.equal(h.saves[1].chat.at(-1).extra.rpg_framework_repairs[0].attempts.length,1);
    assert.equal(await h.controller.receive(h.reply),false);assert.equal(h.calls.length,1);
});
test('a genuine no-change review writes an audit record without adding another game revision',async()=>{
    const h=harness({provider:()=>wrap({protocol:1,id:'check',baseRevision:2,ops:[]})});
    await h.controller.receive(h.reply);assert.equal(h.controller.state().revision,2);
    assert.equal(readRepair(h.reply).status,'checked');assert.equal(h.calls.length,1);
});
for(const options of [{mode:'off'},{limit:0}])test('automatic review can be disabled without rejecting a valid receipt '+JSON.stringify(options),async()=>{
    const h=harness(options);assert.equal(await h.controller.receive(h.reply),true);
    assert.equal(h.calls.length,0);assert.equal(h.controller.state().revision,2);
});
test('every-reply review also finds omissions in a nonempty accepted transaction',async()=>{
    const h=harness({mode:'all'});h.reply.mes='A technician nods.\n'+wrap({protocol:1,id:'paid',baseRevision:1,ops:[{op:'setValue',fieldId:'credits',value:49990}]});
    await h.controller.receive(h.reply);assert.equal(h.calls.length,1);assert.equal(h.controller.state().values.credits,49990);
});
test('manual review works on an accepted historical reply without parsing or rewriting its narrative',async()=>{
    const h=harness({mode:'off',limit:0});await h.controller.receive(h.reply);
    assert.equal(await h.controller.reviewScene(),true);assert.equal(h.calls.length,1);assert.equal(readRepair(h.reply).manual,true);
});
test('malformed review output stops after one call and preserves the accepted receipt',async()=>{
    const h=harness({provider:()=>'<rpg-framework>{broken}</rpg-framework>'});
    assert.equal(await h.controller.receive(h.reply),true);assert.equal(h.calls.length,1);
    assert.equal(h.controller.state().revision,2);assert.equal(readRepair(h.reply).status,'failed');
    const reloaded=new FrameworkChat({getContext:()=>h.ctx,save:async()=>{},generateRepair:()=>assert.fail('must not restart')});
    assert.equal(await reloaded.reviewScene(h.reply,false),false);
});
test('review failure cannot expose provider secrets or mark the original accepted state as uncommitted',async()=>{
    const h=harness({provider:()=>{throw Error('SECRET provider details');}});
    assert.equal(await h.controller.receive(h.reply),true);assert.equal(h.controller.state().revision,2);
    assert.equal(readRepair(h.reply).status,'request_failed');assert.doesNotMatch(JSON.stringify(h.reply),/SECRET/);
});
for(const [name,mutate] of [
    ['chat switch',h=>h.ctx={chat:[],chatMetadata:{}}],
    ['new user message',h=>h.ctx.chat.push({mes:'Go',is_user:true})],
    ['swipe',h=>h.reply.swipe_id=1],
    ['manual edit',h=>h.controller.manual([{op:'setValue',fieldId:'credits',value:49999}])],
    ['stop',h=>h.controller.cancelRepair()],
])test('late scene review cannot overwrite '+name,async()=>{
    let resolve,started;const waiting=new Promise(r=>started=r);
    const h=harness({provider:()=>{started();return new Promise(r=>resolve=r);}});
    const pending=h.controller.receive(h.reply);await waiting;await mutate(h);
    resolve(wrap({protocol:1,id:'late',baseRevision:2,ops:[npc]}));await pending;
    assert.notEqual(readRepair(h.reply)?.status,'corrected');assert.equal(h.calls.length,1);
});
test('review has a strict public scene/cast scope even for otherwise valid transactions',()=>{
    const before=applyFrameworkTransaction(emptyFramework(),initial).state;
    const invalid=[
        {op:'setValue',fieldId:'credits',value:0},
        {op:'updateDefinition',target:'entity',id:'ship',patch:{description:'Changed'}},
        {op:'archive',target:'entity',id:'pilot',archived:true},
        {op:'setLock',target:'structure',id:'place',locked:true},
        {op:'create',target:'entity',definition:{id:'other_player',kind:'player',label:'Player'}},
    ];
    for(const op of invalid)assert.throws(()=>correctedResult(wrap({protocol:1,id:'bad',baseRevision:1,ops:[op]}),before,'Original','review'),/复核不能|模型不能更改玩家的锁/);
    assert.equal(before.values.credits,50000);
});
test('review can create public text fields and archive a departed NPC, while locks still apply',()=>{
    let before=applyFrameworkTransaction(emptyFramework(),initial).state;
    before=applyFrameworkTransaction(before,{protocol:1,id:'cast',baseRevision:1,ops:[npc]}).state;
    const ops=[{op:'create',target:'group',definition:{id:'public',entityId:'technician',label:'Public details'}},{op:'create',target:'field',definition:{id:'action',groupId:'public',label:'Action',type:'text',role:'action'}},{op:'setValue',fieldId:'action',value:'Leaves for the corridor'},{op:'archive',target:'entity',id:'technician',archived:true}];
    const result=correctedResult(wrap({protocol:1,id:'leave',baseRevision:2,ops}),before,'Original','review');
    assert.equal(result.state.entities.at(-1).archived,true);assert.equal(result.state.values.action,'Leaves for the corridor');
    before=applyFrameworkTransaction(before,{protocol:1,id:'lock',baseRevision:2,ops:[{op:'setLock',target:'structure',id:'technician',locked:true}]},{actor:'manual'}).state;
    assert.throws(()=>correctedResult(wrap({protocol:1,id:'locked',baseRevision:3,ops:[{op:'archive',target:'entity',id:'technician',archived:true}]}),before,'Original','review'),/锁/);
});
test('review preference must be saved and read back exactly',async()=>{
    const h=harness({mode:'off'});await h.controller.setSceneReviewMode('all');
    assert.equal(h.ctx.chatMetadata.rpg_framework_v1.sceneReviewMode,'all');
    Object.assign(h.ctx,{chatId:'test',characterId:0,characters:[{name:'Test',avatar:'test.png'}],saveChat:async()=>{},getRequestHeaders:()=>({})});
    const stored=structuredClone([{chat_metadata:h.ctx.chatMetadata},...h.ctx.chat]);
    await saveFrameworkVerified(h.ctx,async()=>({ok:true,json:async()=>stored}));
    stored[0].chat_metadata.rpg_framework_v1.sceneReviewMode='off';
    await assert.rejects(saveFrameworkVerified(h.ctx,async()=>({ok:true,json:async()=>stored})),/回读/);
});
