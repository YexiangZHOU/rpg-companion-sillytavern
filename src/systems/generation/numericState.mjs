// Numeric tracker protocol. No browser, network, or account-global state.
export const ATTRIBUTES = Object.freeze(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const safeId = id => typeof id === 'string' && !['__proto__', 'constructor', 'prototype'].includes(id);
const integer = (n, max) => Number.isInteger(n) && n >= 1 && n <= max;
export const syncMode = mode => ['generic', 'dnd5e'].includes(mode) ? mode : 'off';
export const emptySheet = () => ({ confirmed: false, level: null, attributes: {}, customAttributes: {}, source: 'unknown' });

export function readPayload(text) {
    if (object(text)) return text;
    try { const value = JSON.parse(text); return object(value) ? value : {}; }
    catch { return {}; }
}

// Stored values use the extension's general ranges; switching to D&D never
// destroys existing values. The stricter range applies to new model changes.
export function readSheet(value) {
    const out = emptySheet();
    if (!object(value)) return out;
    if (integer(value.level, 100)) out.level = value.level;
    for (const id of ATTRIBUTES) {
        if (own(value.attributes, id) && integer(value.attributes[id], 999)) out.attributes[id] = value.attributes[id];
    }
    for (const [id, number] of Object.entries(value.customAttributes || {})) {
        if (safeId(id) && !ATTRIBUTES.includes(id) && integer(number, 999)) out.customAttributes[id] = number;
    }
    out.confirmed = value.confirmed === true && (out.level !== null || Object.keys(out.attributes).length > 0);
    out.source = ['manual', 'model', 'legacy'].includes(value.source) ? value.source : (out.confirmed ? 'model' : 'unknown');
    return out;
}

export function legacySheet(saved) {
    return readSheet({ confirmed: false, level: saved?.level, attributes: saved?.classicStats, customAttributes: saved?.classicStats, source: 'legacy' });
}

export function mergeSheet(incoming, previous, mode) {
    const out = readSheet(previous);
    if (syncMode(mode) === 'off' || !object(incoming) || incoming.confirmed !== true) return out;
    const maxAttr = mode === 'dnd5e' ? 30 : 999;
    const maxLevel = mode === 'dnd5e' ? 20 : 100;
    let changed = false;
    if (integer(incoming.level, maxLevel)) { out.level = incoming.level; changed = true; }
    for (const id of ATTRIBUTES) {
        if (own(incoming.attributes, id) && integer(incoming.attributes[id], maxAttr)) {
            out.attributes[id] = incoming.attributes[id];
            changed = true;
        }
    }
    if (changed) { out.confirmed = true; out.source = 'model'; }
    return out;
}

function statConfigs(settings) {
    return (settings.trackerConfig?.userStats?.customStats || []).filter(s => s && s.enabled && s.name && safeId(s.id));
}
function maximum(settings, stat) {
    const max = stat.maxValue;
    return settings.trackerConfig?.userStats?.statsDisplayMode === 'number' && Number.isFinite(max) && max > 0 ? max : 100;
}
function validStat(n, max) { return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max; }
function statMap(value) {
    const map = new Map();
    if (!Array.isArray(value)) return map;
    for (const raw of value) {
        // Recover old locks shaped as {value:{id,name,value},locked:true}.
        const item = object(raw?.value) && !raw.id ? raw.value : raw;
        if (object(item) && safeId(item.id) && !map.has(item.id)) map.set(item.id, item.value);
    }
    return map;
}

export function normalizeNumericPayload(incoming, previous, settings) {
    const data = readPayload(incoming);
    const prior = readPayload(previous);
    const old = statMap(prior.stats);
    const next = statMap(data.stats);
    const locks = settings.lockedItems?.userStats?.stats;
    const stats = statConfigs(settings).map(stat => {
        const max = maximum(settings, stat);
        const fallback = stat.id === 'arousal' ? 0 : Math.min(100, max);
        const priorValue = validStat(old.get(stat.id), max) ? old.get(stat.id) : fallback;
        const locked = locks === true || (object(locks) && (locks[stat.id] === true || locks[stat.name] === true));
        const value = !locked && validStat(next.get(stat.id), max) ? next.get(stat.id) : priorValue;
        return { id: stat.id, name: stat.name, value };
    });
    return {
        ...prior,
        ...data,
        stats,
        characterSheet: mergeSheet(data.characterSheet, prior.characterSheet || settings.numericBaseline, settings.sheetSyncMode),
    };
}

// Replaying a historical snapshot must not apply today's locks or merge values
// from a sibling reply. Missing fields go to the chat's baseline, not global state.
export function restoreNumericPayload(data, settings) {
    data = readPayload(data);
    const values = statMap(data.stats);
    settings.userStats ||= {};
    for (const stat of statConfigs(settings)) {
        const max = maximum(settings, stat);
        const value = values.get(stat.id);
        settings.userStats[stat.id] = validStat(value, max) ? value : (stat.id === 'arousal' ? 0 : Math.min(100, max));
    }
    const sheet = readSheet(data.characterSheet || settings.numericBaseline);
    settings.characterSheetState = sheet;
    settings.classicStats = { ...sheet.customAttributes, ...Object.fromEntries(ATTRIBUTES.map(id => [id, sheet.attributes[id] ?? 10])) };
    settings.level = sheet.level ?? 1;
}

export function manualSheetEdit(current, field, value, customIds = []) {
    const next = readSheet(current);
    if (field === 'level' && integer(value, 100)) next.level = value;
    else if (ATTRIBUTES.includes(field) && integer(value, 999)) next.attributes[field] = value;
    else if (safeId(field) && customIds.includes(field) && integer(value, 999)) next.customAttributes[field] = value;
    else return next;
    next.confirmed = true;
    next.source = 'manual';
    return next;
}

export function numericInstructions(settings, previous) {
    let text = '\n数值更新规则：stats 中保留模板的 id，value 必须是范围内的 JSON 数字，不写百分号或字符串。根据本轮已经发生的行动、时间和后果输出更新后的绝对值；不是增减量。明确给出的数值变化必须反映到对应字段；没有变化则保留上轮值，不能每轮重置为100。只更新玩家的状态，不把NPC的受伤或休息算给玩家。锁定项保持原值。通用百分比状态不等于D&D生命值。\n';
    const mode = syncMode(settings.sheetSyncMode);
    if (mode === 'off') return text;
    const sheet = readSheet(readPayload(previous).characterSheet || settings.numericBaseline);
    text += `人物表同步：${mode === 'dnd5e' ? 'D&D 5e，六属性1–30，等级1–20' : '通用，六属性1–999，等级1–100'}，只接受整数。输出 userStats.characterSheet，含 confirmed、level、attributes（str/dex/con/int/wis/cha）。只在玩家已明确确定的人物数值、已发生升级或明确属性变化时填 confirmed:true；待选推荐方案填 confirmed:false，未知字段省略或填null。模板中的null代表未知，不是0或默认10；已确定字段必须替换为实际整数。检定结果、伤害、疲劳不改变基础属性。每次输出完整的已知人物表绝对值，不复制模板占位数值。confirmed只是模型的结构化声明，不是用户批准凭证。当前记录：${JSON.stringify(sheet)}。\n`;
    return text;
}
