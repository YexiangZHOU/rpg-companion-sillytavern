import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameworkChat, frameworkMode } from '../src/framework/chat.mjs';
import { saveFrameworkVerified } from '../src/framework/storage.mjs';
import { emptyFramework, applyFrameworkTransaction, cloneFramework } from '../src/framework/state.mjs';
import { writeFrameworkSnapshot } from '../src/framework/snapshots.mjs';
import { entityAppearance, frameworkVisual, stripAcceptedPortraits } from '../src/framework/visual.mjs';
import { validateRoll, calculateRoll, shouldAuto } from '../src/systems/features/diceEngine.mjs';

const init = { protocol:1,id:'start',baseRevision:0,ops:[{op:'init',title:'任意游戏',entities:[{id:'me',label:'旅人',kind:'player'}],groups:[{id:'strange',entityId:'me',label:'未定义体系'}],fields:[{id:'score',groupId:'strange',label:'回声',type:'number'},{id:'appearance',groupId:'strange',label:'外观',type:'text'}],values:{score:-2.5,appearance:'蓝色外套'}}] };
const state = () => applyFrameworkTransaction(emptyFramework(),init).state;
const text = t => `一段叙事\n<rpg-framework>${JSON.stringify(t)}</rpg-framework>`;
const reply = mes => ({mes,is_user:false,swipe_id:0,swipes:[mes],swipe_info:[{extra:{}}]});
const patch = (revision,value,id='update') => ({protocol:1,id,baseRevision:revision,ops:[{op:'setValue',fieldId:'score',value}]});
function harness(existing=false) {
    let ctx={chat:[],chatMetadata:{},chatId:'synthetic',characterId:0,characters:[{name:'Test',avatar:'test.png'}],getRequestHeaders:()=>({'Content-Type':'application/json'})};
    const errors=[],renders=[]; let saves=0,fail=false;
    const controller=new FrameworkChat({getContext:()=>ctx,save:async()=>{saves++;if(fail)throw Error('offline');},report:e=>errors.push(e),render:(s,i)=>renders.push({s,i})});
    if(existing){const m=reply('早前叙事');writeFrameworkSnapshot(m,state());ctx.chat.push(m);}
    return {controller,get ctx(){return ctx;},set ctx(v){ctx=v;},errors,renders,get saves(){return saves;},set fail(v){fail=v;}};
}
test('fresh chat auto universal, legacy records and long established chats stay legacy',()=>{
    assert.equal(frameworkMode({chat:[],chatMetadata:{}}),'universal');
    assert.equal(frameworkMode({chat:[reply('greeting')],chatMetadata:{}}),'universal');
    assert.equal(frameworkMode({chat:[reply('one'),reply('two')],chatMetadata:{}}),'legacy');
    assert.equal(frameworkMode({chat:[{extra:{rpg_companion_swipes:{}}}],chatMetadata:{}}),'legacy');
    assert.equal(frameworkMode({chat:[],chatMetadata:{rpg_framework_v1:{mode:'legacy'}}}),'legacy');
});
test('real chat lifecycle accepts initialization, strips only accepted block, saves current swipe',async()=>{
    const h=harness();h.ctx.chat.push({mes:'开始',is_user:true});assert.match(h.controller.begin('normal'),/baseRevision/);
    const m=reply(text(init));h.ctx.chat.push(m);assert.equal(await h.controller.receive(m),true);
    assert.equal(m.mes,'一段叙事');assert.equal(m.swipes[0],m.mes);assert.equal(m.swipe_info[0].extra.rpg_framework_swipes[0].state.values.score,-2.5);
    assert.equal(h.ctx.chatMetadata.rpg_framework_v1.mode,'universal');assert.equal(h.saves,1);assert.equal(await h.controller.receive(m),false);assert.equal(h.saves,1);
});
test('following turn updates; reload, selected swipe and deletion restore definitions and values together',async()=>{
    const h=harness(true);h.ctx.chat.push({mes:'行动',is_user:true});h.controller.begin('normal');const m=reply(text(patch(1,8)));h.ctx.chat.push(m);await h.controller.receive(m);
    const stored=cloneFramework(h.ctx);const fresh=harness();fresh.ctx=stored;assert.equal(fresh.controller.restore().values.score,8);
    m.swipe_id=1;m.mes='另一个分支';m.swipes.push(m.mes);m.swipe_info.push({extra:{}});assert.equal(h.controller.restore().values.score,-2.5);
    m.swipe_id=0;m.mes=m.swipes[0];assert.equal(h.controller.restore().values.score,8);
    h.ctx.chat.pop();assert.equal(h.controller.restore().values.score,-2.5);
});
test('edited reply invalidates old snapshot and returns to valid ancestor',async()=>{
    const h=harness(true);h.ctx.chat[0].mes='编辑后的文字';assert.equal(h.controller.restore().initialized,false);
});
test('swipe regeneration is based on prior branch, not replaced assistant snapshot',async()=>{
    const h=harness(true);const prompt=h.controller.begin('swipe');assert.match(prompt,/"revision":0/);
    const m=h.ctx.chat[0];m.swipe_id=1;m.mes=text({...init,id:'alternate'});m.swipes.push(m.mes);m.swipe_info.push({extra:{}});await h.controller.receive(m);assert.equal(h.controller.state().revision,1);
});
test('invalid model data keeps original visible JSON and all prior values, without save',async()=>{
    const h=harness(true);h.controller.begin('normal');const m=reply(text(patch(1,'bad')));h.ctx.chat.push(m);const raw=m.mes;
    assert.equal(await h.controller.receive(m),false);assert.equal(m.mes,raw);assert.equal(h.saves,0);assert.equal(h.controller.state().values.score,-2.5);assert.equal(h.errors.length,1);
});
test('failed save rolls back visible text, swipes, extras, swipe metadata and mode',async()=>{
    const h=harness();h.controller.begin('normal');const m=reply(text(init));h.ctx.chat.push(m);const before=cloneFramework(m);h.fail=true;
    assert.equal(await h.controller.receive(m),false);assert.deepEqual(m,before);assert.equal(h.ctx.chatMetadata.rpg_framework_v1.mode,'universal');assert.equal(h.controller.state().initialized,false);
});
test('manual changes and locks persist; failed edit restores previous snapshot',async()=>{
    const h=harness(true);await h.controller.manual([{op:'setLock',target:'value',id:'strange',locked:true}]);await h.controller.manual([{op:'setValue',fieldId:'score',value:0}]);assert.equal(h.controller.state().values.score,0);
    h.fail=true;await assert.rejects(h.controller.manual([{op:'setValue',fieldId:'score',value:9}]));assert.equal(h.controller.state().values.score,0);assert.deepEqual(h.controller.state().locks.value,['strange']);
});
test('manual edit during model generation rejects stale model update',async()=>{
    const h=harness(true);h.controller.begin('normal');await h.controller.manual([{op:'setValue',fieldId:'score',value:4}]);const m=reply(text(patch(1,99)));h.ctx.chat.push(m);
    assert.equal(await h.controller.receive(m),false);assert.equal(h.controller.state().values.score,4);assert.match(h.errors[0],/生成期间/);
});
test('chat changes and disabled feature never accept old generation into another chat',async()=>{
    const h=harness();h.controller.begin('normal');const m=reply(text(init));h.ctx={chat:[m],chatMetadata:{}};assert.equal(await h.controller.receive(m),false);assert.equal(h.saves,0);
    h.controller.enabled=()=>false;assert.equal(h.controller.begin('normal'),'');
});
test('quiet, impersonation, continue, guided, dry run have no framework generation',()=>{
    const h=harness();for(const type of ['quiet','impersonate','continue'])assert.equal(h.controller.begin(type),'');assert.equal(h.controller.begin('normal',{suppressed:true}),'');assert.equal(h.controller.begin('normal',{dryRun:true}),'');
});
test('mode switch preserves legacy data; failure restores prior selection',async()=>{
    const h=harness();h.ctx.chatMetadata.rpg_companion={old:'intact'};await h.controller.setMode('universal');assert.deepEqual(h.ctx.chatMetadata.rpg_companion,{old:'intact'});h.fail=true;await assert.rejects(h.controller.setMode('legacy'));assert.equal(h.controller.active(),true);
});
test('unknown manually before first reply cannot create unanchored account state',async()=>{
    const h=harness();await assert.rejects(h.controller.manual([{op:'setValue',fieldId:'anything',value:2}]),/开始聊天/);
});
test('saving is serialized; second manual edit cannot roll back another accepted edit',async()=>{
    const h=harness(true);let resolve;h.controller.save=()=>new Promise(r=>resolve=r);const first=h.controller.manual([{op:'setValue',fieldId:'score',value:5}]);
    await assert.rejects(h.controller.manual([{op:'setValue',fieldId:'score',value:7}]),/正在保存/);resolve();await first;assert.equal(h.controller.state().values.score,5);
});
test('switching chat during save does not render old state into new panel',async()=>{
    const h=harness();let resolve;h.controller.save=()=>new Promise(r=>resolve=r);h.controller.begin('normal');const m=reply(text(init));h.ctx.chat.push(m);const pending=h.controller.receive(m);
    h.ctx={chat:[],chatMetadata:{}};resolve();await pending;assert.equal(h.renders.length,0);assert.equal(h.controller.state().initialized,false);
});
test('save readback catches swallowed save error, acknowledges exact state and mode',async()=>{
    const h=harness(true);h.ctx.saveChat=async()=>{};let saved=[{chat_metadata:h.ctx.chatMetadata},...cloneFramework(h.ctx.chat)];let called;
    const transport=async(url,args)=>{called={url,body:JSON.parse(args.body)};return{ok:true,json:async()=>saved};};
    await saveFrameworkVerified(h.ctx,transport);assert.equal(called.url,'/api/chats/get');assert.equal(called.body.file_name,'synthetic');
    saved[1].extra.rpg_framework_swipes[0].state.values.score=20;await assert.rejects(saveFrameworkVerified(h.ctx,transport),/回读核验/);
});
test('group readback uses captured chat id; HTTP failure and malformed response fail closed',async()=>{
    const h=harness(true);h.ctx.groupId='group';h.ctx.saveChat=async()=>{};
    await saveFrameworkVerified(h.ctx,async(url,args)=>{assert.equal(url,'/api/chats/group/get');assert.deepEqual(JSON.parse(args.body),{id:'synthetic'});return{ok:true,json:async()=>[{chat_metadata:h.ctx.chatMetadata},...h.ctx.chat]};});
    await assert.rejects(saveFrameworkVerified(h.ctx,async()=>({ok:false})),/核验保存/);await assert.rejects(saveFrameworkVerified(h.ctx,async()=>({ok:true,json:async()=>[]})),/未读取/);
});
test('model-defined scene reads no fixed numeric fields and never includes private thoughts',()=>{
    const s=state();assert.equal(entityAppearance(s,s.entities[0]),'蓝色外套');const v=frameworkVisual(s,'正在离开港口');assert.equal(v.cast[0].appearance,'蓝色外套');assert.equal(JSON.stringify(v).includes('score'),false);assert.equal(v.summary,'正在离开港口');
});
test('failed initializer never switches a fresh game silently to legacy',async()=>{
    const h=harness();h.ctx.chat.push(reply('开场'));h.controller.begin('normal');const m=reply(text({...init,ops:[]}));h.ctx.chat.push(m);await h.controller.receive(m);assert.equal(h.controller.active(),true);
});
test('only accepted portrait requests hide; failed, edited, other swipe and examples remain visible',()=>{
    const raw='叙事\n<rpg-portrait>{"entityId":"me"}</rpg-portrait>',m=reply(raw);
    assert.equal(stripAcceptedPortraits(raw,m),raw);m.extra={rpg_framework_portraits:{0:{reply:raw,images:{me:{url:'/user/images/demo.png'}}}}};assert.equal(stripAcceptedPortraits(raw,m),'叙事');
    m.swipe_id=1;assert.equal(stripAcceptedPortraits(raw,m),raw);m.swipe_id=0;m.mes='edited';assert.equal(stripAcceptedPortraits(raw,m),raw);
    m.mes='```\n'+raw+'\n```';m.extra.rpg_framework_portraits[0].reply=m.mes;assert.equal(stripAcceptedPortraits(m.mes,m),m.mes);
});
test('shared dice remains generic 2d6 plus integer modifier and player/automatic selection',()=>{
    const roll=validateRoll({id:'fictional_check',actor:'黎遥',actorType:'player',reason:'本游戏检查',count:2,sides:6,modifier:-1,dc:null});
    assert.equal(calculateRoll(roll,[3,5]).total,7);assert.equal(shouldAuto('player',roll),false);assert.equal(shouldAuto('auto',roll),true);
});
