import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFramework, applyFrameworkTransaction, cloneFramework } from '../src/framework/state.mjs';
import { buildFrameworkInstructions, applyFrameworkReply } from '../src/framework/protocol.mjs';
import { FrameworkChat } from '../src/framework/chat.mjs';
import { FrameworkObservations, reviewFrameworkChat } from '../src/framework/diagnostics.mjs';
import { writeFrameworkSnapshot } from '../src/framework/snapshots.mjs';
import { gameSummaryFields } from '../src/framework/panel.mjs';

const examples = () => [...buildFrameworkInstructions().matchAll(/<rpg-framework>\n(.*?)\n<\/rpg-framework>/g)].map(match => JSON.parse(match[1]));
const wrap = value => `<rpg-framework>${typeof value === 'string' ? value : JSON.stringify(value)}</rpg-framework>`;
const message = mes => ({ mes, is_user: false, swipe_id: 0, swipes: [mes], swipe_info: [{ extra: {} }] });

test('published examples are complete executable multi-entity transactions', () => {
    const [init, update] = examples(); assert.ok(init && update);
    const before = applyFrameworkReply(wrap(init), emptyFramework()).state;
    const after = applyFrameworkReply(wrap(update), before).state;
    assert.equal(after.values.coins, 18);
    assert.equal(after.values.cargo[0].values.quantity, 2);
    assert.match(after.entities.find(e => e.id === 'place').description, /ferry/);
    assert.equal(after.entities.find(e => e.id === 'clerk').kind, 'npc');
    assert.equal(after.entities.find(e => e.id === 'keeper').archived, true);
    assert.deepEqual(after.entities.filter(e => e.kind === 'scene' && !e.archived).map(e => e.id), ['place']);
    assert.equal(before.values.coins, 20);
    const next = applyFrameworkTransaction(after, {protocol:1,id:'next',baseRevision:2,ops:[
        {op:'upsertItem',fieldId:'cargo',item:{id:'parcel',values:{quantity:1}}},
        {op:'create',target:'group',definition:{id:'commitments',entityId:'traveler',label:'Commitments'}},
        {op:'create',target:'field',definition:{id:'delivery',groupId:'commitments',label:'Delivery',type:'text',summary:true}},
        {op:'setValue',fieldId:'delivery',value:'Accepted; awaiting delivery and payment'},
    ]}).state;
    assert.equal(next.values.coins, 18); assert.equal(next.values.cargo[0].values.name, 'Sealed parcel');
    assert.equal(next.values.cargo[0].values.quantity, 1);
    const saved = message('Narrative'); writeFrameworkSnapshot(saved, next);
    const ctx = {chat:[JSON.parse(JSON.stringify(saved))],chatMetadata:{}};
    assert.equal(new FrameworkChat({getContext:()=>ctx,save:async()=>{}}).state().values.delivery, next.values.delivery);
});

test('review distinguishes malformed JSON, valid JSON rejected by schema, absent protocol and uncommitted data', () => {
    const [init] = examples();
    const rows = reviewFrameworkChat([message(wrap('{bad: true}')), message(wrap({...init,ops:[]})), message('ordinary narrative'), message(wrap(init))]).rows;
    assert.deepEqual(rows.map(r=>r.status), ['parse_rejected','validation_rejected','no_protocol','valid_uncommitted']);
    assert.equal(rows[0].code,'json'); assert.equal(rows[1].code,'empty');
    assert.ok(rows.every(r=>r.basis==='replay'));
    assert.ok(rows.every(r=>r.baseRevision===0));
});

test('saved snapshots survive reload while replay never accepts an earlier failed update', () => {
    const [init, update] = examples(); const state = applyFrameworkTransaction(emptyFramework(),init).state;
    const saved = message('Opening'); writeFrameworkSnapshot(saved,state);
    const messages = [saved,message(wrap(update)),message(wrap({...update,id:'later',baseRevision:2}))];
    const before = cloneFramework(messages), rows = reviewFrameworkChat(messages).rows;
    assert.deepEqual(messages,before);
    assert.deepEqual(rows.map(r=>r.status),['snapshot','valid_uncommitted','validation_rejected']);
    assert.equal(rows[2].code,'conflict');
    assert.equal(reviewFrameworkChat(cloneFramework(messages)).rows[0].revision,1);
});

test('runtime save failures remain observable without storing provider errors or changing chat records', async () => {
    const observations = new FrameworkObservations(), ctx={chat:[],chatMetadata:{}};
    const controller = new FrameworkChat({getContext:()=>ctx,save:async()=>{throw Error('private-provider-diagnostic');},observe:(m,e)=>observations.record(m,e)});
    controller.begin('normal'); const reply=message(wrap(examples()[0]));ctx.chat.push(reply); const before=cloneFramework(reply);
    assert.equal(await controller.receive(reply),false); assert.deepEqual(reply,before);
    const review=reviewFrameworkChat(ctx.chat,observations);
    assert.equal(review.rows[0].status,'save_failed'); assert.equal(review.rows[0].basis,'observed_this_page');
    assert.equal(JSON.stringify(review).includes('private-provider'),false);
    assert.equal(JSON.stringify(review).includes('Sealed parcel'),false);
    assert.equal(reviewFrameworkChat(ctx.chat).rows[0].status,'valid_uncommitted');
});

test('observations do not leak across edits, swipes or distinct chats', () => {
    const observations=new FrameworkObservations(), reply=message('First');
    observations.record(reply,{status:'no_protocol'});assert.ok(observations.get(reply));
    reply.swipe_id=1; assert.equal(observations.get(reply),null);
    reply.swipe_id=0;reply.mes='Edited';assert.equal(observations.get(reply),null);
    assert.equal(observations.get(message('First')),null);
});

test('diagnostic callback failure cannot reject an otherwise saved transaction', async () => {
    const ctx={chat:[],chatMetadata:{}};
    const controller=new FrameworkChat({getContext:()=>ctx,save:async()=>{},observe:()=>{throw Error('diagnostic failure');}});
    controller.begin('normal');const reply=message(wrap(examples()[0]));ctx.chat.push(reply);
    assert.equal(await controller.receive(reply),true);assert.equal(controller.state().revision,1);
});

test('invalid saved state prevents false replay against a fabricated empty baseline', () => {
    const reply=message('Opening');reply.extra={rpg_framework_swipes:{0:{protocol:1,reply:reply.mes,state:{}}}};
    const rows=reviewFrameworkChat([reply,message(wrap(examples()[0]))]).rows;
    assert.equal(rows[0].status,'invalid_snapshot');assert.equal(rows[1].status,'unknown_baseline');
});

test('diagnostic history bounds displayed rows but still reads preceding valid state', () => {
    const saved=message('Opening');writeFrameworkSnapshot(saved,applyFrameworkTransaction(emptyFramework(),examples()[0]).state);
    const review=reviewFrameworkChat([saved,...Array.from({length:110},()=>message('No change'))]);
    assert.equal(review.total,111);assert.equal(review.rows.length,100);assert.ok(review.truncated);assert.equal(review.rows[0].baseRevision,1);
});

test('automatic summaries use existing compact values without changing schema and keep NPC status inside', () => {
    const state=applyFrameworkTransaction(emptyFramework(),examples()[0]).state, player=state.entities[0];
    state.fields[0].summary=false;const before=cloneFramework(state);
    assert.deepEqual(gameSummaryFields(state,player).map(f=>f.id),['coins']);assert.deepEqual(state,before);
    assert.deepEqual(gameSummaryFields(state,{...player,kind:'npc'}),[]);
    state.values.coins=null;assert.deepEqual(gameSummaryFields(state,player),[]);
    state.fields[0].summary=true;assert.equal(gameSummaryFields(state,player).length,1);
});
