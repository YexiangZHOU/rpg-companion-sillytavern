import { emptyFramework, cloneFramework, applyFrameworkTransaction, exportFramework, importFramework } from '../../src/framework/state.mjs';
import { applyFrameworkReply, buildFrameworkInstructions } from '../../src/framework/protocol.mjs';
import { FrameworkPanel } from '../../src/framework/panel.mjs';
import { PREVIEW_CASES, previewInitialization } from './fixtures.mjs';

const element = id => document.getElementById(id);
const STORAGE_KEY = 'rpg_framework_synthetic_preview_v1';
let serial = Date.now(), activeCase = PREVIEW_CASES[0], state = emptyFramework(), lastReply = null;
const sessions = new Map();
let storageNotice = '';
try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    for (const game of PREVIEW_CASES) {
        const session = saved[game.id];
        if (!session || !Array.isArray(session.history) || session.history.length > 24 || !session.history.some(part => part.id === session.current)) continue;
        for (const part of session.history) importFramework(JSON.stringify(part.state));
        sessions.set(game.id, session);
    }
} catch { storageNotice = '旧预览数据无法读取，本次使用新的合成样例。'; }
function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(sessions))); }
    catch { storageNotice = '浏览器未允许保存，当前预览仍可操作；刷新后可能丢失变化。'; }
}
function report(message, failure = false) { element('feedback').textContent = message + (storageNotice ? ` ${storageNotice}` : ''); element('feedback').classList.toggle('is-error', failure); }
function envelope(ops) { return { protocol: 1, id: `preview_${++serial}`, baseRevision: state.revision, ops }; }
const panel = new FrameworkPanel(element('player-panel'), { onOperation: op => {
    try { commit(applyFrameworkTransaction(state, envelope([op]), { actor: 'manual' }), '手动操作'); }
    catch (error) { report(error.message, true); throw error; }
} });
function currentSession() { return sessions.get(activeCase.id); }
function draw() {
    panel.render(state);
    element('state-version').textContent = `记录版本 ${state.revision}`;
    element('game-title').textContent = state.title || '等待模型建立游戏数据';
    element('game-note').textContent = activeCase.note;
    element('scene-title').textContent = activeCase.title;
    const summary = element('schema-summary'); summary.replaceChildren();
    for (const [label, amount] of [['对象', state.entities.filter(part => !part.archived).length], ['组别', state.groups.filter(part => !part.archived).length], ['字段', state.fields.filter(part => !part.archived).length]]) {
        const term = document.createElement('dt'), value = document.createElement('dd'); term.textContent = label; value.textContent = amount; summary.append(term, value);
    }
    const history = element('history-picker'); history.replaceChildren();
    for (const part of currentSession().history) {
        const option = document.createElement('option'); option.value = part.id;
        option.textContent = `版本 ${part.state.revision} · ${part.label}${part.parent ? `（接续 ${part.parent}）` : ''}`; history.append(option);
    }
    history.value = currentSession().current;
    for (const [id, update] of [['model-update', activeCase.updates[0]], ['model-expand', activeCase.updates[1]]]) {
        const control = element(id); control.textContent = update.label;
        control.disabled = !state.initialized || update.ops.some(op => op.op === 'create' && [...state.entities, ...state.groups, ...state.fields].some(part => part.id === op.definition.id));
    }
    element('repeat-update').disabled = !lastReply;
    const instructions = element('instructions'); if (!instructions.hidden) instructions.textContent = buildFrameworkInstructions(state);
}
function message(value) { const narrator = element('narration'); narrator.replaceChildren(); const label = document.createElement('small'); label.textContent = '合成模型回复'; narrator.append(label, document.createTextNode(value)); }
function commit(result, label, replyText) {
    state = result.state;
    if (!result.duplicate) {
        const session = currentSession(), id = `node_${++serial}`;
        session.history.push({ id, parent: session.current, label, state: cloneFramework(state), replyText: replyText ?? activeCase.narration });
        session.current = id;
        if (session.history.length > 24) session.history.splice(1, 1);
        persist();
    }
    if (replyText) message(replyText);
    draw();
    report(result.duplicate ? '上次事务已保存，重复提交没有再次执行。' : `已保存 · 版本 ${state.revision}${result.changes.length ? '' : ' · 数值保持不变'}`);
    const changes = element('changes'); changes.replaceChildren();
    for (const change of result.changes) {
        const tag = document.createElement('span');
        tag.textContent = change.kind === 'value' ? `${change.label}：${panel.format(change.before)} → ${panel.format(change.after)}` : `${change.label} · ${{ init: '初始化', create: '新增', definition: '已调整', archive: '已归档/恢复', lock: '锁已调整' }[change.kind]}`;
        changes.append(tag);
    }
}
function applyModel(raw) {
    try {
        const result = applyFrameworkReply(raw, state);
        if (!result.accepted) { report('没有找到有效的框架事务，面板保持原记录。', true); return; }
        lastReply = raw; commit(result, '模型更新', result.visibleText);
    } catch (error) { report(`未保存：${error.message}。原数据保持不变。`, true); }
}
function pickSample(game) {
    activeCase = game; panel.entityId = null; panel.selected.clear(); panel.opened.clear(); panel.scrollPositions.clear(); panel.renderedGroup = null; lastReply = null;
    if (!sessions.has(game.id)) {
        const baseline = emptyFramework(), result = applyFrameworkReply(`${game.narration}\n<rpg-framework>${JSON.stringify(previewInitialization(game))}</rpg-framework>`, baseline);
        sessions.set(game.id, { current: 'initial', history: [{ id: 'empty', parent: null, label: '未初始化', state: baseline, replyText: '尚未开始游戏。' }, { id: 'initial', parent: 'empty', label: '模型初始化', state: result.state, replyText: game.narration }] });
        persist();
    }
    const snapshot = currentSession().history.find(part => part.id === currentSession().current);
    state = cloneFramework(snapshot.state); message(snapshot.replyText);
    element('model-output').value = `<rpg-framework>${JSON.stringify(previewInitialization(game), null, 2)}</rpg-framework>`;
    element('changes').replaceChildren(); draw(); report(state.initialized ? '合成模型定义已载入；可点数值编辑，或测试模型更新。' : '等待模型初始化。');
}
for (const game of PREVIEW_CASES) { const option = document.createElement('option'); option.value = game.id; option.textContent = game.label; element('sample-picker').append(option); }
element('sample-picker').addEventListener('change', event => pickSample(PREVIEW_CASES.find(game => game.id === event.target.value)));
element('history-picker').addEventListener('change', event => {
    const session = currentSession(), snapshot = session.history.find(part => part.id === event.target.value);
    session.current = snapshot.id; state = cloneFramework(snapshot.state); lastReply = null; message(snapshot.replyText); persist(); element('changes').replaceChildren(); draw(); report('已恢复当时的结构与数值；新更新将建立独立分支。');
});
for (const [id, index] of [['model-update', 0], ['model-expand', 1]]) element(id).addEventListener('click', () => {
    const update = activeCase.updates[index], raw = `场景继续发展，${update.label.replace('模型更新：', '').replace('模型新增：', '')}。\n<rpg-framework>${JSON.stringify(envelope(update.ops))}</rpg-framework>`;
    element('model-output').value = raw; applyModel(raw);
});
element('repeat-update').addEventListener('click', () => { if (lastReply) applyModel(lastReply); });
element('apply-output').addEventListener('click', () => applyModel(element('model-output').value));
element('empty-session').addEventListener('click', () => {
    const result = { state: emptyFramework(), duplicate: false, changes: [] };
    lastReply = null; commit(result, '独立初始化分支', '尚未开始游戏，等待模型建立数据。');
    element('model-output').value = `<rpg-framework>${JSON.stringify(previewInitialization(activeCase), null, 2)}</rpg-framework>`;
    report('已进入独立空分支；应用下方初始化输出即可生成分类，原分支可在历史中恢复。');
});
element('show-instructions').addEventListener('click', () => { const instructions = element('instructions'); instructions.hidden = !instructions.hidden; if (!instructions.hidden) instructions.textContent = buildFrameworkInstructions(state); });
element('export-state').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([exportFramework(state)], { type: 'application/json' })), link = document.createElement('a');
    link.href = url; link.download = 'rpg-preview-state.json'; link.click(); URL.revokeObjectURL(url);
});
for (const [id, selector, open, closed] of [['left-drawer', '.demo-scene', '‹', '›'], ['right-drawer', '.demo-player', '›', '‹']]) element(id).addEventListener('click', () => {
    const collapsed = document.querySelector(selector).classList.toggle('is-collapsed'); element(id).textContent = collapsed ? closed : open; element(id).setAttribute('aria-expanded', String(!collapsed));
});
pickSample(activeCase);
