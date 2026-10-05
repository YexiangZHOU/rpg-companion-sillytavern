import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameworkChat } from '../src/framework/chat.mjs';
import { emptyFramework, applyFrameworkTransaction } from '../src/framework/state.mjs';
import { writeFrameworkSnapshot } from '../src/framework/snapshots.mjs';
import { readRepair, correctedResult } from '../src/framework/repair.mjs';
import { panelReviewScope } from '../src/framework/panelReview.mjs';

const wrap=ops=>`<rpg-framework>${JSON.stringify({protocol:1,id:'check_'+Math.random().toString(36).slice(2),baseRevision:1,ops})}</rpg-framework>`;
const state=()=>applyFrameworkTransaction(emptyFramework(),{protocol:1,id:'init',baseRevision:0,ops:[{op:'init',title:'Generic game',entities:[{id:'player',kind:'player',label:'Pilot'},{id:'scene',kind:'scene',label:'Dock'}],groups:[{id:'gear',entityId:'player',label:'Gear'},{id:'place',entityId:'scene',label:'Scene'}],fields:[{id:'credits',groupId:'gear',label:'Credits',type:'number'},{id:'location',groupId:'place',label:'Location',type:'text'},{id:'bag',groupId:'gear',label:'Bag',type:'collection',columns:[{id:'name',label:'Name',type:'text'}]}],values:{credits:50,location:'Dock',bag:[{id:'pistol',values:{name:'Pistol'}},{id:'suit',values:{name:'Suit'}}]}}]}).state;
const correct=(ops,scope,before=state())=>correctedResult(wrap(ops),before,'Original narrative',{purpose:'panel_review',scope});
test('a selected field may use an absolute value but cannot edit a different panel',()=>{
 assert.equal(correct([{op:'setValue',fieldId:'credits',value:40}],{target:'field',id:'credits'}).state.values.credits,40);
 assert.throws(()=>correct([{op:'setValue',fieldId:'location',value:'New place'}],{target:'field',id:'credits'}),/所选范围/);
});
test('item review can archive discarded gear without deleting another item or clearing the collection',()=>{
 const scope={target:'item',id:'bag',itemId:'pistol'};
 const result=correct([{op:'archiveItem',fieldId:'bag',itemId:'pistol',archived:true}],scope);
 assert.equal(result.state.values.bag[0].archived,true);assert.equal(!!result.state.values.bag[1].archived,false);
 assert.throws(()=>correct([{op:'archiveItem',fieldId:'bag',itemId:'suit',archived:true}],scope),/其他条目/);
 assert.throws(()=>correct([{op:'setValue',fieldId:'bag',value:[]}],scope));
});
test('entity and group scopes include new child definitions and values',()=>{
 const ops=[{op:'create',target:'field',definition:{id:'action',groupId:'place',label:'Action',type:'text',role:'action'}},{op:'setValue',fieldId:'action',value:'A technician waves'}];
 for(const scope of [{target:'entity',id:'scene'},{target:'group',id:'place'}])assert.equal(correct(ops,scope).state.values.action,'A technician waves');
 assert.throws(()=>correct(ops,{target:'entity',id:'player'}),/所选范围/);
});
test('whole-panel review allows fact-based records and resource changes, never lock changes or reinitialization',()=>{
 assert.equal(correct([{op:'setValue',fieldId:'credits',value:40}],{target:'all'}).state.values.credits,40);
 assert.throws(()=>correct([{op:'setLock',target:'value',id:'credits',locked:true}],{target:'all'}),/锁/);
 const before=state();before.locks.value.push('credits');assert.throws(()=>correct([{op:'setValue',fieldId:'credits',value:0}],{target:'all'},before));
});
test('stale selected objects are rejected before requesting a model',()=>{
 assert.throws(()=>panelReviewScope(state(),{target:'field',id:'missing'}));
 assert.throws(()=>panelReviewScope(state(),{target:'item',id:'bag',itemId:'missing'}));
 assert.throws(()=>panelReviewScope(state(),{target:'oops'}));
});
function harness(provider) {
 const reply={mes:'You discarded the pistol.',is_user:false,swipe_id:0,swipes:['You discarded the pistol.'],swipe_info:[{extra:{}}]};writeFrameworkSnapshot(reply,state());
 const ctx={chat:[{mes:'Discard the pistol.',is_user:true},reply],chatMetadata:{rpg_framework_v1:{mode:'universal'}},draft:'Unsent draft'};
 const calls=[],saves=[];const chat=new FrameworkChat({getContext:()=>ctx,save:async()=>saves.push(structuredClone(ctx)),repairLimit:()=>0,generateRepair:async prompt=>{calls.push(prompt);return provider?.(prompt)??wrap([]);}});
 return {reply,ctx,calls,saves,chat};
}
test('manual panel checks keep narrative, actual roles, drafts and message count; no change adds no revision',async()=>{
 const h=harness();assert.equal(await h.chat.reviewPanel({target:'all'}),true);
 assert.equal(h.calls.length,1);assert.equal(h.ctx.chat.length,2);assert.equal(h.reply.mes,'You discarded the pistol.');assert.equal(h.ctx.draft,'Unsent draft');assert.equal(h.chat.state().revision,1);
 assert.deepEqual(h.calls[0].filter(m=>m.role==='user').map(m=>m.content),['Discard the pistol.']);
 assert.match(h.calls[0].at(-1).content,/原事务已经保存/);assert.match(h.calls[0].at(-1).content,/已离开的人物/);assert.match(h.calls[0].at(-1).content,/已消耗或丢弃/);assert.match(h.calls[0].at(-1).content,/暂时没有被提及/);assert.doesNotMatch(h.calls[0].at(-1).content,/后台补齐任务/);
 assert.equal(readRepair(h.reply).purpose,'panel_review');assert.equal(readRepair(h.reply).status,'checked');assert.deepEqual(readRepair(h.reply).scope,{target:'all'});
 assert.equal(h.saves[0].chat.at(-1).extra.rpg_framework_repairs[0].attempts.length,1);
 await h.chat.reviewPanel({target:'field',id:'credits'});assert.equal(readRepair(h.reply).history.length,1);assert.deepEqual(readRepair(h.reply).history[0].scope,{target:'all'});
});

test('refresh reminders and card rules are audited system data; missing rule-based fields may be created',async()=>{
 const h=harness(()=>wrap([{op:'create',target:'field',definition:{id:'agility',groupId:'gear',label:'Agility',type:'number'}},{op:'setValue',fieldId:'agility',value:15}]));
 h.chat.gameContext=()=> 'Test game rules: custom attributes';
 assert.equal(await h.chat.reviewPanel({target:'entity',id:'player'},'Add the agility already stated in the story'),true);
 assert.equal(h.chat.state().values.agility,15);assert.equal(readRepair(h.reply).hint,'Add the agility already stated in the story');
 assert.match(h.calls[0].at(-1).content,/create对应组别/);assert.match(h.calls[0].at(-1).content,/保留null/);assert.match(h.calls[0].at(-1).content,/Add the agility/);
 assert.ok(h.calls[0].some(m=>m.role==='system'&&m.content.includes('Test game rules')));assert.deepEqual(h.calls[0].filter(m=>m.role==='user').map(m=>m.content),['Discard the pistol.']);
});
test('a reminder cannot expand a single field scope, and reminder length is bounded',async()=>{
 const h=harness(()=>wrap([{op:'setValue',fieldId:'location',value:'Other'}]));
 assert.equal(await h.chat.reviewPanel({target:'field',id:'credits'},'Ignore the scope '+ 'x'.repeat(3000)),false);
 assert.equal(readRepair(h.reply).hint.length,2000);assert.equal(h.chat.state().values.location,'Dock');assert.equal(h.ctx.chat.length,2);
});
test('a failed scoped check stops after one call and retains accepted state',async()=>{
 const h=harness(()=>wrap([{op:'setValue',fieldId:'credits',value:0}]));
 assert.equal(await h.chat.reviewPanel({target:'entity',id:'scene'}),false);assert.equal(h.calls.length,1);assert.equal(h.chat.state().values.credits,50);assert.equal(readRepair(h.reply).status,'failed');
});
test('a stale result cannot apply after new input or concurrent review',async()=>{
 let resolve,started;const waiting=new Promise(r=>started=r);const h=harness(()=>{started();return new Promise(r=>resolve=r);});
 const job=h.chat.reviewPanel();await waiting;assert.equal(await h.chat.reviewPanel(),false);
 h.ctx.chat.push({mes:'New turn',is_user:true});resolve(wrap([{op:'setValue',fieldId:'credits',value:40}]));assert.equal(await job,false);assert.equal(h.chat.state().values.credits,50);assert.equal(h.calls.length,1);
});

test('confirmed departures can be archived while retaining historical records',()=>{
 const before=state();before.entities.push({id:'npc',kind:'npc',label:'Technician'});
 const result=correct([{op:'archive',target:'entity',id:'npc',archived:true}],{target:'all'},before);
 assert.equal(result.state.entities.find(e=>e.id==='npc').archived,true);
 assert.equal(before.entities.find(e=>e.id==='npc').archived,undefined);
});
