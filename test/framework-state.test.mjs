import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFramework, applyFrameworkTransaction as apply, validateFramework, exportFramework, importFramework, cloneFramework, activeFrameworkGroups, activeFrameworkFields } from '../src/framework/state.mjs';
import { applyFrameworkReply, buildFrameworkInstructions } from '../src/framework/protocol.mjs';
import { writeFrameworkSnapshot, readFrameworkBranch } from '../src/framework/snapshots.mjs';
import { PREVIEW_CASES, previewInitialization } from '../examples/universal-rpg/fixtures.mjs';

let serial = 0;
const game = id => PREVIEW_CASES.find(part => part.id === id);
const init = (id = 'cultivation') => apply(emptyFramework(), previewInitialization(game(id))).state;
const txn = (state, ops, id = `txn_${++serial}`) => ({ protocol: 1, id, baseRevision: state.revision, ops });
const set = (fieldId, value) => ({ op: 'setValue', fieldId, value });
const update = (state, ops, options) => apply(state, txn(state, ops), options).state;
const fails = (state, ops, code, options) => {
    const before = JSON.stringify(state);
    assert.throws(() => apply(state, txn(state, ops), options), error => error.code === code);
    assert.equal(JSON.stringify(state), before, 'failed transaction must not mutate prior state');
};
const lock = (state, id, target = 'value') => update(state, [{ op: 'setLock', target, id, locked: true }], { actor: 'manual' });

for (const sample of PREVIEW_CASES) test(`model-defined ${sample.id}: initialize, update and create a new group`, () => {
    let state = init(sample.id);
    assert.deepEqual(state.groups.map(part => part.label), sample.groups.map(part => part.label));
    state = update(state, sample.updates[0].ops);
    const count = state.groups.length;
    state = update(state, sample.updates[1].ops);
    assert.equal(state.groups.length, count + 1);
    assert.equal(validateFramework(state), state);
});
test('fresh framework has no game fields, resources, groups or entities', () => {
    const state = emptyFramework();
    assert.equal(state.fields.length + state.groups.length + state.entities.length, 0);
    assert.deepEqual(state.values, {});
});
test('entirely unfamiliar categories and fields are accepted without code changes', () => {
    const state = apply(emptyFramework(), { protocol: 1, id: 'unusual', baseRevision: 0, ops: [{ op: 'init', title: '记忆之海', entities: [{ id: 'echo', label: '回声', kind: '意识' }], groups: [{ id: 'fragments', entityId: 'echo', label: '遗忘的形状' }], fields: [{ id: 'melody', groupId: 'fragments', label: '最后的旋律', type: 'text' }], values: { melody: '没有数值，只有一段旋律。' } }] }).state;
    assert.equal(state.values.melody, '没有数值，只有一段旋律。');
    assert.equal(state.fields.length, 1);
});
test('unknown, zero, negative values, decimals and false stay distinct through export', () => {
    let state = init('shop');
    assert.equal(state.values.funds, -12.5);
    assert.equal(state.values.rating, 4.2);
    assert.equal(state.values.stock_items[1].values.quantity, 0);
    state = update(state, [set('funds', 0), set('open', false)]);
    const stored = importFramework(exportFramework(state));
    assert.equal(stored.values.funds, 0); assert.equal(stored.values.open, false);
    assert.equal(init().values.reputation, null);
});
test('no-number narrative has no generated HP, levels or default attributes', () => {
    const state = init('story');
    assert.ok(state.fields.every(field => field.type === 'text'));
    assert.equal(state.values.photo, null);
});
test('all operations roll back together when a later value is invalid', () => {
    fails(init(), [set('awareness', 42), set('spirit', { current: 100, max: 60 })], 'range');
});
test('updates reject unknown IDs, incorrect types and invalid choices', () => {
    fails(init(), [set('missing', 4)], 'reference');
    fails(init(), [set('awareness', '14')], 'number');
    fails(init(), [set('realm', '至尊境')], 'choice');
});
test('integer constraints reject decimals but other fields accept them', () => {
    const state = init('shop');
    fails(state, [{ op: 'upsertItem', fieldId: 'stock_items', item: { id: 'tea', values: { quantity: 1.5 } } }], 'integer');
    assert.equal(update(state, [set('funds', .125)]).values.funds, .125);
});
test('stale versions cannot overwrite a newer state', () => {
    const state = init(), old = txn(state, [set('awareness', 25)]), next = update(state, [set('awareness', 23)]);
    assert.throws(() => apply(next, old), error => error.code === 'conflict');
    assert.equal(next.values.awareness, 23);
});
test('same transaction is idempotent and reused IDs with changed payload are rejected', () => {
    const state = init(), transaction = txn(state, [set('awareness', 25)]), next = apply(state, transaction).state;
    const replay = apply(next, transaction);
    assert.equal(replay.duplicate, true); assert.deepEqual(replay.state, next);
    assert.throws(() => apply(next, { ...transaction, ops: [set('awareness', 99)] }), error => error.code === 'duplicate');
});
test('old transactions beyond the receipt window still cannot replay their stale base', () => {
    let state = init(); const old = txn(state, [set('awareness', 22)]); state = apply(state, old).state;
    for (let n = 0; n < 34; n++) state = update(state, [set('awareness', n)]);
    assert.equal(state.applied.length, 32);
    assert.throws(() => apply(state, old), error => error.code === 'conflict');
});
test('value locks reject model updates, manual edits remain possible', () => {
    const state = lock(init(), 'spirit');
    fails(state, [set('spirit', { current: 40, max: 60 })], 'locked');
    assert.equal(update(state, [set('spirit', { current: 40, max: 60 })], { actor: 'manual' }).values.spirit.current, 40);
});
test('group value locks inherit to child fields', () => {
    fails(lock(init(), 'cultivation'), [set('awareness', 14)], 'locked');
});
test('model cannot remove locks or bypass them by archiving a parent', () => {
    const state = lock(init(), 'spirit');
    fails(state, [{ op: 'setLock', target: 'value', id: 'spirit', locked: false }], 'permission');
    fails(state, [{ op: 'archive', target: 'group', id: 'cultivation', archived: true }], 'locked');
});
test('structure lock prevents rename and addition without blocking unlocked values', () => {
    const state = lock(init(), 'cultivation', 'structure');
    fails(state, [{ op: 'updateDefinition', target: 'group', id: 'cultivation', patch: { label: '气海' } }], 'locked');
    fails(state, [{ op: 'create', target: 'field', definition: { id: 'new_stat', groupId: 'cultivation', label: '新值', type: 'number' } }], 'locked');
    assert.equal(update(state, [set('awareness', 20)]).values.awareness, 20);
});
test('rename and move within an entity preserve value and stable ID', () => {
    const state = update(init(), [{ op: 'updateDefinition', target: 'field', id: 'awareness', patch: { label: '识海', groupId: 'relations' } }]);
    assert.equal(state.values.awareness, 12.5);
    assert.equal(state.fields.find(field => field.id === 'awareness').label, '识海');
});
test('move cannot transfer a field to a different entity or a locked destination', () => {
    fails(init('space'), [{ op: 'updateDefinition', target: 'field', id: 'oxygen', patch: { groupId: 'systems' } }], 'owner');
    fails(lock(init(), 'relations', 'structure'), [{ op: 'updateDefinition', target: 'field', id: 'awareness', patch: { groupId: 'relations' } }], 'locked');
});
test('object resource update never changes another object', () => {
    const state = init('space'), next = update(state, [set('shield', { current: 12, max: 90 })]);
    assert.deepEqual(next.values.oxygen, state.values.oxygen);
});
test('archive keeps values, hides descendants, and can be restored', () => {
    let state = update(init(), [{ op: 'archive', target: 'group', id: 'cultivation', archived: true }]);
    assert.equal(activeFrameworkGroups(state, 'traveler').some(part => part.id === 'cultivation'), false);
    assert.equal(activeFrameworkFields(state, 'cultivation').length, 0);
    assert.equal(state.values.spirit.current, 38);
    fails(state, [set('awareness', 14)], 'archived');
    state = update(state, [{ op: 'archive', target: 'group', id: 'cultivation', archived: false }]);
    assert.equal(activeFrameworkFields(state, 'cultivation').length, 4);
});
test('collection item patch preserves other fields and other items', () => {
    const state = update(init('shop'), [{ op: 'upsertItem', fieldId: 'stock_items', item: { id: 'tea', values: { quantity: 12 } } }]);
    assert.equal(state.values.stock_items[0].values.name, '青叶茶');
    assert.equal(state.values.stock_items[0].values.price, 2.5);
    assert.equal(state.values.stock_items[1].values.quantity, 0);
});
test('collection overwrite is forbidden; archive never destroys item data', () => {
    const state = init('shop'); fails(state, [set('stock_items', [])], 'collection');
    let next = update(state, [{ op: 'archiveItem', fieldId: 'stock_items', itemId: 'tea', archived: true }]);
    assert.equal(next.values.stock_items[0].values.quantity, 18);
    fails(next, [{ op: 'upsertItem', fieldId: 'stock_items', item: { id: 'tea', values: { quantity: 0 } } }], 'archived');
    next = update(next, [{ op: 'archiveItem', fieldId: 'stock_items', itemId: 'tea', archived: false }]);
    assert.equal(next.values.stock_items[0].archived, false);
});
test('unknown collection can become known empty without inventing items', () => {
    let state = update(init(), [{ op: 'create', target: 'field', definition: { id: 'unknown_list', groupId: 'treasures', label: '待清点', type: 'collection', columns: [{ id: 'name', label: '名称', type: 'text' }] } }]);
    assert.equal(state.values.unknown_list, null);
    state = update(state, [set('unknown_list', [])]); assert.deepEqual(state.values.unknown_list, []);
});
test('collection can add columns without rewriting existing item values', () => {
    const state = init('shop'), old = state.fields.find(field => field.id === 'stock_items');
    const next = update(state, [{ op: 'updateDefinition', target: 'field', id: old.id, patch: { columns: [...old.columns, { id: 'origin', label: '产地', type: 'text' }] } }]);
    assert.deepEqual(next.values.stock_items, state.values.stock_items);
    fails(next, [{ op: 'updateDefinition', target: 'field', id: old.id, patch: { columns: old.columns.slice(1) } }], 'columns');
});
test('unknown column values and duplicate identifiers are rejected atomically', () => {
    fails(init('shop'), [{ op: 'upsertItem', fieldId: 'stock_items', item: { id: 'tea', values: { magic: 10 } } }], 'column');
    fails(init(), [{ op: 'create', target: 'group', definition: { id: 'spirit', entityId: 'traveler', label: '重号' } }], 'duplicate');
});
test('immutable types and arbitrary scripts are not accepted as schema patches', () => {
    fails(init(), [{ op: 'updateDefinition', target: 'field', id: 'awareness', patch: { type: 'text' } }], 'shape');
    fails(init(), [{ op: 'create', target: 'field', definition: { id: 'script', groupId: 'cultivation', label: '脚本', type: 'javascript' } }], 'type');
});
test('malicious keys, non-JSON values and excessive depth are rejected', () => {
    const state = init();
    assert.throws(() => apply(state, JSON.parse('{"protocol":1,"id":"evil","baseRevision":1,"ops":[],"__proto__":{}}')), error => error.code === 'key');
    fails(state, [set('awareness', Infinity)], 'type');
    let nested = {}; for (let n = 0; n < 22; n++) nested = { nested };
    fails(state, [set('reputation', nested)], 'limit');
    assert.equal({}.polluted, undefined);
});
test('model definition and values with markup stay plain data', () => {
    const text = '<img src=x onerror="alert(1)">';
    const state = update(init(), [set('reputation', text), { op: 'updateDefinition', target: 'field', id: 'reputation', patch: { label: text } }]);
    assert.equal(importFramework(exportFramework(state)).values.reputation, text);
});
test('init cannot reset an existing game or coexist with other ops', () => {
    fails(init(), previewInitialization(game('cultivation')).ops, 'init');
    fails(emptyFramework(), [...previewInitialization(game('cultivation')).ops, set('awareness', 22)], 'init');
});
test('definition changes that invalidate old values reject the entire transaction', () => {
    fails(init(), [{ op: 'updateDefinition', target: 'field', id: 'awareness', patch: { max: 10 } }], 'range');
});
test('successful tagged protocol removes only accepted data and preserves narration', () => {
    const raw = `开始游戏。\n<rpg-framework>${JSON.stringify(previewInitialization(game('story')))}</rpg-framework>`;
    const result = applyFrameworkReply(raw, emptyFramework());
    assert.equal(result.accepted, true); assert.equal(result.visibleText, '开始游戏。');
    assert.equal(result.state.groups[0].label, '线索');
});
test('quoted/fenced/inline examples are never executed', () => {
    const block = `<rpg-framework>${JSON.stringify(previewInitialization(game('story')))}</rpg-framework>`;
    for (const raw of [`\`\`\`json\n${block}\n\`\`\``, `> ${block}`, `示例：\`${block}\``]) {
        const result = applyFrameworkReply(raw, emptyFramework()); assert.equal(result.accepted, false); assert.equal(result.visibleText, raw);
    }
});
test('multiple or invalid model transactions do not accept or hide data', () => {
    const state = init(), block = `<rpg-framework>${JSON.stringify(txn(state, [set('awareness', 20)]))}</rpg-framework>`;
    assert.throws(() => applyFrameworkReply(block + block, state), /一项/);
    assert.throws(() => applyFrameworkReply('<rpg-framework>{bad}</rpg-framework>', state), /JSON/);
    assert.equal(state.values.awareness, 12.5);
});
test('protocol parsing preserves backticks and literal closing tags inside field text', () => {
    const state = init('story'), value = '线索写着 `旧钟楼`，旁边还有 </rpg-framework> 与 <rpg-framework> 字样。';
    const block = `<rpg-framework>${JSON.stringify(txn(state, [set('photo', value)]))}</rpg-framework>`;
    const result = applyFrameworkReply(`新线索。\n${block}`, state);
    assert.equal(result.state.values.photo, value);
    assert.equal(result.visibleText, '新线索。');
});
test('incomplete protocol wrappers cannot apply partial values', () => {
    const state = init('story'), raw = `<rpg-framework>${JSON.stringify(txn(state, [set('photo', '新的照片')]))}`;
    assert.throws(() => applyFrameworkReply(raw, state), /结束标签/);
    assert.equal(state.values.photo, null);
});
test('initialization prompt has empty dynamic definitions and excludes receipt history', () => {
    const instructions = buildFrameworkInstructions(emptyFramework());
    assert.match(instructions, /没有必选分类/); assert.match(instructions, /"fields":\[\]/);
    assert.doesNotMatch(buildFrameworkInstructions(init()), /"applied"/);
});
test('snapshots isolate swipes and restore both schema and values', () => {
    const original = init(), expanded = update(original, game('cultivation').updates[1].ops);
    const message = { mes: '初始回复', swipe_id: 0, swipe_info: [{}, {}] };
    writeFrameworkSnapshot(message, original);
    message.mes = '另一个分支'; message.swipe_id = 1; writeFrameworkSnapshot(message, expanded);
    assert.equal(readFrameworkBranch([message]).groups.length, 5);
    message.mes = '初始回复'; message.swipe_id = 0;
    assert.equal(readFrameworkBranch([message]).groups.length, 4);
    assert.equal(readFrameworkBranch([message]).values.spirit.current, 38);
});
test('edit and deletion invalidate stale snapshots and never use unrelated chat state', () => {
    const first = { mes: '第一轮' }, second = { mes: '第二轮' };
    const original = init(), changed = update(original, [set('awareness', 20)]);
    writeFrameworkSnapshot(first, original); writeFrameworkSnapshot(second, changed);
    assert.equal(readFrameworkBranch([first, second]).values.awareness, 20);
    second.mes = '已经改写'; assert.equal(readFrameworkBranch([first, second]).values.awareness, 12.5);
    assert.equal(readFrameworkBranch([first]).values.awareness, 12.5);
    assert.deepEqual(readFrameworkBranch([]), emptyFramework());
});
test('snapshot results are independent copies, invalid state is not silently trusted', () => {
    const message = { mes: '回复' }, state = init(); writeFrameworkSnapshot(message, state);
    const restored = readFrameworkBranch([message]); restored.values.awareness = 99;
    assert.equal(readFrameworkBranch([message]).values.awareness, 12.5);
    message.extra.rpg_framework_swipes[0].state.values.spirit = { current: 100, max: 60 };
    assert.throws(() => readFrameworkBranch([message]), error => error.code === 'range');
});
