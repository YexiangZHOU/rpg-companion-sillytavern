import test from 'node:test';
import assert from 'node:assert/strict';
import { frameworkMessagePresentation } from '../src/framework/presentation.mjs';
import { applyFrameworkReply } from '../src/framework/protocol.mjs';
import { emptyFramework } from '../src/framework/state.mjs';

test('invalid JSON remains rejected while display separates narrative and raw evidence', () => {
    for (const json of ['{"protocol":1}}', '{crunch_o2: true}', '{"ops": [']) {
        const raw = `The dock alarm sounds.\n<rpg-framework>${json}</rpg-framework>`;
        assert.throws(() => applyFrameworkReply(raw, emptyFramework()));
        const display = frameworkMessagePresentation(raw);
        assert.equal(display.visible, 'The dock alarm sounds.');
        assert.equal(display.blocks[0].raw, raw.slice(raw.indexOf('<rpg-framework>')));
        assert.equal(raw.includes(json), true);
    }
});
test('quoted, fenced and inline protocol examples stay visible', () => {
    for (const raw of ['> <rpg-framework>{}</rpg-framework>', '```json\n<rpg-framework>{}</rpg-framework>\n```', '`<rpg-framework>{}</rpg-framework>`']) {
        const display = frameworkMessagePresentation(raw);
        assert.equal(display.visible, raw); assert.deepEqual(display.blocks, []);
    }
});
test('literal closing tags in JSON strings do not truncate raw evidence', () => {
    const json = JSON.stringify({ value: 'literal </rpg-framework> and \\"quoted\\" text' });
    const raw = `Before\n<rpg-framework>${json}</rpg-framework>\nAfter`;
    const display = frameworkMessagePresentation(raw);
    assert.equal(display.visible, 'Before\n\nAfter');
    assert.equal(display.blocks[0].raw, `<rpg-framework>${json}</rpg-framework>`);
});
test('multiple rejected transactions retain every raw block and surrounding prose', () => {
    const raw = 'A<rpg-framework>{}</rpg-framework>B<rpg-framework>{bad}</rpg-framework>C';
    const display = frameworkMessagePresentation(raw);
    assert.equal(display.visible, 'ABC'); assert.equal(display.blocks.length, 2);
});
test('unfinished protocol is folded as uncommitted, without guessing or accepting values', () => {
    const raw = 'Narrative\n<rpg-framework>{"value":"unfinished';
    const display = frameworkMessagePresentation(raw);
    assert.equal(display.visible, 'Narrative'); assert.equal(display.blocks[0].complete, false);
    assert.equal(display.blocks[0].raw, raw.slice(raw.indexOf('<rpg-framework>')));
});
test('ordinary messages and HTML-like narrative remain untouched', () => {
    const raw = 'A <strong>door</strong> and {a clue}.';
    assert.equal(frameworkMessagePresentation(raw).visible, raw);
    assert.deepEqual(frameworkMessagePresentation(raw).blocks, []);
});
