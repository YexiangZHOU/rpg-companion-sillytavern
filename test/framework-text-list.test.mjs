import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFrameworkTransaction, emptyFramework, exportFramework, importFramework } from '../src/framework/state.mjs';
import { FrameworkChat } from '../src/framework/chat.mjs';

const init = () => ({ protocol:1,id:'start',baseRevision:0,ops:[{op:'init',title:'Space game',entities:[{id:'ship',label:'Ship',kind:'ship'}],groups:[{id:'gear',entityId:'ship',label:'Equipment'}],fields:[{id:'weapons',groupId:'gear',label:'Weapons',type:'tags'},{id:'battery',groupId:'gear',label:'Battery',type:'resource'}],values:{weapons:['Pulse laser','Pulse laser'],battery:{current:60,max:100}}}] });
const raw = tx => `Story\n<rpg-framework>${JSON.stringify(tx)}</rpg-framework>`;
const reply = mes => ({mes,is_user:false,swipe_id:0,swipes:[mes],swipe_info:[{extra:{}}]});

test('repeated text labels preserve order and multiplicity through initialization and export',()=>{
 const state=applyFrameworkTransaction(emptyFramework(),init()).state;
 assert.deepEqual(state.values.weapons,['Pulse laser','Pulse laser']);
 assert.deepEqual(importFramework(exportFramework(state)).values.weapons,state.values.weapons);
});
test('chat accepts repeated equipment labels, saves, reloads and updates next turn',async()=>{
 let ctx={chat:[reply('Greeting'),{is_user:true,mes:'Start'}],chatMetadata:{}};
 let saved,saves=0;const errors=[];
 const controller=new FrameworkChat({getContext:()=>ctx,save:async()=>{saved=structuredClone(ctx);saves++;},report:e=>errors.push(e)});
 controller.begin('normal');const m=reply(raw(init()));ctx.chat.push(m);
 assert.equal(await controller.receive(m),true);assert.equal(m.mes,'Story');assert.equal(m.swipes[0],'Story');assert.equal(saves,1);
 ctx=structuredClone(saved);controller.restore();ctx.chat.push({is_user:true,mes:'Charge and install a third laser'});
 controller.begin('normal');const next=reply(raw({protocol:1,id:'charge',baseRevision:1,ops:[{op:'setValue',fieldId:'battery',value:{current:65,max:100}},{op:'setValue',fieldId:'weapons',value:['Pulse laser','Pulse laser','Pulse laser']}]}));ctx.chat.push(next);
 assert.equal(await controller.receive(next),true);assert.equal(saves,2);assert.deepEqual(errors,[]);
 ctx=structuredClone(saved);assert.equal(controller.restore().revision,2);assert.equal(controller.state().values.battery.current,65);assert.equal(controller.state().values.weapons.length,3);
});
test('duplicate definition IDs and choice options remain invalid',()=>{
 const t=init();t.ops[0].entities.push({...t.ops[0].entities[0]});
 assert.throws(()=>applyFrameworkTransaction(emptyFramework(),t),e=>e.code==='duplicate');
 const choice=init();choice.ops[0].fields.push({id:'mode',groupId:'gear',label:'Mode',type:'choice',options:['Idle','Idle']});
 assert.throws(()=>applyFrameworkTransaction(emptyFramework(),choice),e=>e.code==='duplicate');
});
test('collection entry IDs stay unique even when their labels match',()=>{
 const t=init();t.ops[0].fields[0]={id:'weapons',groupId:'gear',label:'Weapons',type:'collection',columns:[{id:'name',label:'Name',type:'text'}]};
 t.ops[0].values.weapons=[{id:'first',values:{name:'Pulse laser'}},{id:'second',values:{name:'Pulse laser'}}];
 assert.equal(applyFrameworkTransaction(emptyFramework(),t).state.values.weapons.length,2);
 t.ops[0].values.weapons[1].id='first';assert.throws(()=>applyFrameworkTransaction(emptyFramework(),t),e=>e.code==='duplicate');
});
test('invalid list types and size, value locks and stale revisions still reject atomically',()=>{
 const state=applyFrameworkTransaction(emptyFramework(),init()).state;
 const update=value=>({protocol:1,id:'update',baseRevision:1,ops:[{op:'setValue',fieldId:'battery',value:{current:65,max:100}},{op:'setValue',fieldId:'weapons',value}]});
 for(const value of [[123],Array(33).fill('Laser'),['']]){
  assert.throws(()=>applyFrameworkTransaction(state,update(value)));assert.equal(state.values.battery.current,60);
 }
 const locked=applyFrameworkTransaction(state,{protocol:1,id:'lock',baseRevision:1,ops:[{op:'setLock',target:'value',id:'weapons',locked:true}]},{actor:'manual'}).state;
 assert.throws(()=>applyFrameworkTransaction(locked,{...update(['Laser','Laser']),baseRevision:2}),e=>e.code==='locked');
 assert.throws(()=>applyFrameworkTransaction(locked,update(['Laser','Laser'])),e=>e.code==='conflict');
});
