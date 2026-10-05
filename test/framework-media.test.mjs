import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFramework,applyFrameworkTransaction,validateFramework } from '../src/framework/state.mjs';
import { mediaTargets,coverageIssues,mediaPrompt,FrameworkMedia,readMedia,writeMedia,appearanceText } from '../src/framework/media.mjs';
import { frameworkVisual } from '../src/framework/visual.mjs';
import { FrameworkChat } from '../src/framework/chat.mjs';
import { writeFrameworkSnapshot } from '../src/framework/snapshots.mjs';
import { readRepair } from '../src/framework/repair.mjs';
import { saveFrameworkVerified } from '../src/framework/storage.mjs';
import { ImagePool } from '../src/systems/features/imagePool.mjs';
const visual=(description,mode='portrait',subject='object')=>({mode,subject,description});
function state(){return applyFrameworkTransaction(emptyFramework(),{protocol:1,id:'start',baseRevision:0,ops:[{op:'init',title:'Space',entities:[
    {id:'pilot',kind:'player',label:'Shared name',visual:visual('Short dark hair, red flight suit','portrait','person')},
    {id:'ship',kind:'frigate',label:'Shared name',visual:{...visual('Long silver frigate, twin engines'),visible:true}},
    {id:'scene',kind:'scene',label:'Hangar',description:'At the bay door; loading supplies.'}],
    groups:[{id:'gear',entityId:'pilot',label:'Gear',visual:visual('Toolbox','icon')},{id:'environment',entityId:'scene',label:'Around'}],
    fields:[{id:'balance',groupId:'gear',type:'number',label:'Credits'},
    {id:'weather',groupId:'environment',type:'text',label:'Climate',role:'weather',visual:visual('Rain cloud','icon','symbol')},
    {id:'time',groupId:'environment',type:'text',label:'Clock',role:'time'},
    {id:'secret',groupId:'gear',type:'text',label:'Thoughts',role:'private',visual:visual('SECRET','icon')},
    {id:'cargo',groupId:'gear',type:'collection',label:'Cargo',columns:[{id:'name',label:'Name',type:'text'},{id:'qty',label:'Amount',type:'number'}]}],
    values:{balance:50000,weather:'Rain',time:'Noon',secret:'SECRET',cargo:[{id:'medkit',values:{name:'Medkit',qty:2},visual:visual('Small white medical box','icon')}]}}]}).state;}
const tx=(s,ops)=>applyFrameworkTransaction(s,{protocol:1,id:`change_${s.revision}`,baseRevision:s.revision,ops}).state;
test('generic schema, item merge and public scene bridge preserve old data',()=>{
    const s=state();assert.equal(coverageIssues(s).length,0);assert.equal(mediaTargets(s).length,5);
    const next=tx(s,[{op:'upsertItem',fieldId:'cargo',item:{id:'medkit',values:{qty:1}}}]);
    assert.deepEqual(next.values.cargo[0].visual,s.values.cargo[0].visual);
    assert.equal(mediaTargets(next).find(t=>t.kind==='item').fingerprint,mediaTargets(s).find(t=>t.kind==='item').fingerprint);
    const scene=frameworkVisual(s);assert.equal(scene.cast.length,2);assert.match(scene.player.appearance,/Short/);
    assert.equal(scene.weather.condition,'Rain');assert.equal(scene.time.display,'Noon');assert.doesNotMatch(JSON.stringify(scene),/SECRET|50000|Medkit/);
    const hidden=tx(s,[{op:'updateDefinition',target:'entity',id:'ship',patch:{visual:{...s.entities[1].visual,visible:false}}}]);
    assert.equal(frameworkVisual(hidden).cast.length,1);
});
test('coverage is independent of transaction validity, explicit pending and old appearance labels',()=>{
    const s=state();delete s.entities[0].visual;delete s.entities[2].description;
    validateFramework(s);assert.deepEqual(coverageIssues(s).map(i=>i.code),['scene_details','appearance','portrait_intent']);
    s.entities[0].visual={mode:'portrait',pending:'Player has not chosen appearance'};assert.equal(coverageIssues(s).length,1);
    s.fields.push({id:'look',groupId:'gear',label:'Appearance',type:'text'});s.values.look='Old flight suit';
    assert.equal(appearanceText(s,s.entities[0]),'Old flight suit');
    s.fields.at(-1).role='private';assert.equal(appearanceText(s,s.entities[0]),'');
});
for(const bad of [{mode:'url'},{mode:'icon',url:'https://example.org'},{mode:'icon',description:'x'.repeat(2401)},{mode:'portrait',subject:'human-bust'},{mode:'none',visible:'true'}])test('reject invalid visual '+JSON.stringify(bad).slice(0,70),()=>{
    const s=state();assert.throws(()=>tx(s,[{op:'updateDefinition',target:'entity',id:'pilot',patch:{visual:bad}}]));assert.equal(s.revision,1);
});
test('archival, private fields, none and inherited locks remove or block media targets',()=>{
    let s=state();s.locks.structure=['gear'];assert.equal(mediaTargets(s).find(t=>t.kind==='item').locked,true);
    assert.throws(()=>tx(s,[{op:'upsertItem',fieldId:'cargo',item:{id:'medkit',values:{},visual:visual('New','icon')}}]),/锁/);
    s.locks.structure=[];s=tx(s,[{op:'archiveItem',fieldId:'cargo',itemId:'medkit',archived:true},{op:'updateDefinition',target:'entity',id:'ship',patch:{visual:{mode:'none'}}}]);
    assert.equal(mediaTargets(s).some(t=>t.kind==='item'||t.id==='ship'||t.id==='secret'),false);
});
test('person, vessel and icon framing are distinct and fingerprint excludes quantities',()=>{
    const targets=mediaTargets(state());assert.match(mediaPrompt(targets.find(t=>t.id==='pilot')),/head and upper body/);
    assert.match(mediaPrompt(targets.find(t=>t.id==='ship')),/complete silhouette/);
    assert.match(mediaPrompt(targets.find(t=>t.kind==='item')),/compact icon/);
});
function harness(){
    let s=state(),mode='auto',ctx={chat:[{mes:'A new scene.',swipe_id:0,swipe_info:[{extra:{}}]}],chatMetadata:{}};
    const calls=[],saves=[];let provider=async()=>'/user/images/test/image.png',failSave=false;
    const manager=new FrameworkMedia({getContext:()=>ctx,state:()=>s,active:()=>true,mode:()=>mode,blocked:()=>false,
        generate:async(prompt,valid)=>{calls.push(prompt);return provider(valid);},persist:async()=>{if(failSave)throw Error('secret');saves.push(structuredClone(ctx.chat));}});
    return {manager,calls,saves,get s(){return s;},set s(v){s=v;},get ctx(){return ctx;},set ctx(v){ctx=v;},set mode(v){mode=v;},set provider(v){provider=v;},set failSave(v){failSave=v;}};
}
test('different target images really overlap and serialized commits preserve both completions',async()=>{
    const h=harness(),finish=[];let saving=0,peakSaving=0,started;
    const bothStarted=new Promise(r=>started=r);
    h.provider=()=>new Promise(r=>{finish.push(r);if(finish.length===2)started();});
    h.manager.persist=async()=>{saving++;peakSaving=Math.max(peakSaving,saving);await new Promise(r=>setImmediate(r));saving--;};
    const first=h.manager.run('entity:pilot'),second=h.manager.run('entity:ship');
    await bothStarted;assert.equal(h.calls.length,2);assert.equal(h.manager.jobs.size,2);
    assert.equal(await h.manager.run('entity:pilot',{refresh:true}),false);
    finish[1]('/user/images/ship.png');finish[0]('/user/images/pilot.png');assert.deepEqual(await Promise.all([first,second]),[true,true]);
    assert.equal(peakSaving,1);assert.equal(readMedia(h.ctx.chat)['entity:pilot'].url,'/user/images/pilot.png');assert.equal(readMedia(h.ctx.chat)['entity:ship'].url,'/user/images/ship.png');
    assert.equal(h.manager.jobs.size,0);assert.equal(h.ctx.chat.length,1);
});
test('shared image pool admits ten simultaneous requests, queues extras and skips stale queued work',async()=>{
    const pool=new ImagePool(10),finish=[];let calls=0,valid=true;
    const jobs=Array.from({length:12},(_,i)=>pool.run(()=>{calls++;return new Promise(r=>finish.push(r));},()=>i<10||valid));
    await new Promise(r=>setImmediate(r));assert.equal(calls,10);assert.equal(pool.active,10);assert.equal(pool.waiting.length,2);valid=false;
    finish.forEach(r=>r('done'));const results=await Promise.all(jobs);assert.equal(calls,10);assert.equal(pool.peak,10);assert.equal(pool.active,0);assert.deepEqual(results.slice(10),[null,null]);
});
test('canceling one concurrent image does not discard another target',async()=>{
    const h=harness(),finish=[];h.provider=()=>new Promise(r=>finish.push(r));const jobs=[h.manager.run('entity:pilot'),h.manager.run('entity:ship')];
    await new Promise(r=>setImmediate(r));h.manager.cancel('entity:pilot');finish[0]('/user/images/pilot.png');finish[1]('/user/images/ship.png');
    assert.deepEqual(await Promise.all(jobs),[false,true]);assert.equal(readMedia(h.ctx.chat)['entity:pilot'].url,undefined);assert.equal(readMedia(h.ctx.chat)['entity:ship'].url,'/user/images/ship.png');
});
test('automatic media is bounded, persisted, deduplicated and never appends chat',async()=>{
    const h=harness(),message=h.ctx.chat[0];await h.manager.automatic(message);
    assert.equal(h.calls.length,2);assert.equal(h.ctx.chat.length,1);assert.equal(Object.keys(readMedia(h.ctx.chat)).length,2);
    assert.equal(h.saves[0][0].extra.rpg_framework_media[0].entries['entity:pilot'].status,'requesting');
    await h.manager.automatic(message);assert.equal(h.calls.length,2);
    const key='entity:pilot';assert.equal(await h.manager.run(key),false);
    h.s.values.balance=123;assert.equal(await h.manager.run(key),false);
    assert.equal(await h.manager.run(key,{refresh:true}),true);assert.equal(h.calls.length,3);
    assert.deepEqual(message.extra.rpg_framework_media,message.swipe_info[0].extra.rpg_framework_media);
});
for(const mode of ['off','manual','proposal'])test(`${mode} never generates automatically`,async()=>{
    const h=harness();h.mode=mode;await h.manager.automatic(h.ctx.chat[0]);assert.equal(h.calls.length,0);
    assert.equal(await h.manager.run('entity:ship'),mode!=='off');
});
for(const [name,change] of [
    ['chat',h=>h.ctx={chat:[],chatMetadata:{}}],['swipe',h=>h.ctx.chat[0].swipe_id=1],
    ['reply',h=>h.ctx.chat[0].mes='Edited'],['new turn',h=>h.ctx.chat.push({is_user:true,mes:'Next'})],
    ['appearance',h=>h.s.entities[0].visual.description='Changed'],['archive',h=>h.s.entities[0].archived=true],
    ['lock',h=>h.s.locks.structure=['pilot']],['disabled',h=>h.mode='off'],['stop',h=>h.manager.cancel()],
])test('discard late image after '+name,async()=>{
    const h=harness();let finish;h.provider=()=>new Promise(r=>finish=r);
    const promise=h.manager.automatic(h.ctx.chat[0]);await new Promise(r=>setImmediate(r));assert.equal(h.calls.length,1);
    const old=h.ctx;change(h);finish('/user/images/test/late.png');await promise;
    assert.equal(Object.values(readMedia(old.chat)).some(e=>e.url?.includes('late')),false);
    if(name==='stop')assert.equal(h.calls.length,1);
});
test('failed refresh preserves old image, does not automatically retry, and explicit retry works',async()=>{
    const h=harness();await h.manager.run('entity:pilot');h.s.entities[0].visual.description='New uniform';h.provider=async()=>{throw Error('secret provider body');};
    assert.equal(await h.manager.run('entity:pilot'),false);const entry=readMedia(h.ctx.chat)['entity:pilot'];
    assert.equal(entry.status,'failed');assert.match(entry.url,/image.png/);assert.doesNotMatch(JSON.stringify(entry),/secret/);
    h.provider=async()=>'/user/images/test/new.png';assert.equal(await h.manager.run('entity:pilot',{automatic:true}),false);
    assert.equal(await h.manager.run('entity:pilot',{refresh:true}),true);
});
test('unsafe URL and uncertain save never become successful images or repeated requests',async()=>{
    const h=harness();h.provider=async()=>'https://evil.test/image.png';assert.equal(await h.manager.run('entity:pilot'),false);
    assert.equal(readMedia(h.ctx.chat)['entity:pilot'].code,'image_result');
    h.failSave=true;await assert.rejects(h.manager.run('entity:ship'));assert.equal(h.manager.uncertain.has(h.ctx.chat[0]),true);
    assert.equal(await h.manager.run('entity:ship'),false);assert.equal(h.calls.length,1);
});
test('legacy locked images remain locked and swipe stores are isolated',async()=>{
    const h=harness(),m=h.ctx.chat[0];m.extra={rpg_framework_portraits:{0:{reply:m.mes,images:{pilot:{url:'/user/images/old.png',locked:true}}}}};
    assert.equal(await h.manager.run('entity:pilot',{refresh:true}),false);assert.equal(h.calls.length,0);
    writeMedia(m,{'field:weather':{url:'/user/images/rain.png'}});m.swipe_id=1;m.mes='Other';assert.deepEqual(readMedia(h.ctx.chat),{});
});
test('explicit completion uses one quiet call, preserves committed values and never appends a player message',async()=>{
    const s=state();delete s.entities[0].visual;const message={mes:'The pilot wears a red flight suit.',is_user:false};writeFrameworkSnapshot(message,s);
    const ctx={chat:[message],chatMetadata:{rpg_framework_v1:{mode:'universal'}}};let calls=0;
    const chat=new FrameworkChat({getContext:()=>ctx,save:async()=>{},generateRepair:async prompt=>{
        calls++;assert.equal(prompt.at(-1).role,'system');assert.match(prompt.at(-1).content,/已经保存/);
        return '<rpg-framework>'+JSON.stringify({protocol:1,id:'complete',baseRevision:1,ops:[{op:'updateDefinition',target:'entity',id:'pilot',patch:{visual:visual('Red flight suit','portrait','person')}}]})+'</rpg-framework>';
    }});
    assert.equal(await chat.completeMissing(),true);assert.equal(calls,1);assert.equal(ctx.chat.length,1);assert.equal(message.mes,'The pilot wears a red flight suit.');
    assert.equal(chat.state().values.balance,50000);assert.equal(readRepair(message).purpose,'coverage');assert.equal(coverageIssues(chat.state()).length,0);
});
test('completion cannot spend money and leaves the accepted snapshot untouched',async()=>{
    const s=state();delete s.entities[0].visual;const message={mes:'Opening',is_user:false};writeFrameworkSnapshot(message,s);
    const ctx={chat:[message],chatMetadata:{rpg_framework_v1:{mode:'universal'}}};let calls=0;
    const chat=new FrameworkChat({getContext:()=>ctx,save:async()=>{},generateRepair:async()=>{calls++;return '<rpg-framework>'+JSON.stringify({protocol:1,id:'bad',baseRevision:1,ops:[{op:'setValue',fieldId:'balance',value:0}]})+'</rpg-framework>';}});
    assert.equal(await chat.completeMissing(),false);assert.equal(calls,1);assert.equal(chat.state().values.balance,50000);assert.equal(chat.state().revision,1);
});
test('quiet generation hooks do not invalidate an ordinary generation or background job',()=>{
    const ctx={chat:[],chatMetadata:{rpg_framework_v1:{mode:'universal'}}};
    const controller=new FrameworkChat({getContext:()=>ctx,save:async()=>{}});
    controller.begin('normal');const generation=controller.generation;controller.repairJob={cancelled:false};
    assert.equal(controller.begin('quiet'),'');assert.equal(controller.generation,generation);assert.equal(controller.repairJob.cancelled,false);
    controller.begin('normal');assert.equal(controller.repairJob.cancelled,true);
});
test('image records and per-chat mode participate in save readback',async()=>{
    const h=harness();await h.manager.run('entity:pilot');
    Object.assign(h.ctx,{chatId:'test',characterId:0,characters:[{name:'Test',avatar:'test.png'}],saveChat:async()=>{},getRequestHeaders:()=>({})});
    h.ctx.chatMetadata.rpg_framework_v1={mode:'universal',mediaMode:'manual'};
    let stored=structuredClone([{chat_metadata:h.ctx.chatMetadata},...h.ctx.chat]);
    await saveFrameworkVerified(h.ctx,async()=>({ok:true,json:async()=>stored}));
    delete stored[1].extra.rpg_framework_media[0].entries['entity:pilot'];
    await assert.rejects(saveFrameworkVerified(h.ctx,async()=>({ok:true,json:async()=>stored})),/回读/);
    stored=structuredClone([{chat_metadata:h.ctx.chatMetadata},...h.ctx.chat]);stored[0].chat_metadata.rpg_framework_v1.mediaMode='auto';
    await assert.rejects(saveFrameworkVerified(h.ctx,async()=>({ok:true,json:async()=>stored})),/回读/);
});
