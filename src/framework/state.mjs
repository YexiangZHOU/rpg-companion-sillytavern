/** Generic RPG data kernel. No game categories, network or account-global state. */
export class FrameworkError extends Error {
    constructor(code, message) { super(message); this.name = 'FrameworkError'; this.code = code; }
}
const fail = (code, message) => { throw new FrameworkError(code, message); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const FIELD_TYPES = Object.freeze(['number', 'text', 'boolean', 'choice', 'resource', 'tags', 'collection']);
export const FRAMEWORK_LIMITS = Object.freeze({ payload: 180000, state: 1500000, entities: 24, groups: 64, fields: 256, items: 128, columns: 16 });
const blockedKeys = new Set(['__proto__', 'constructor', 'prototype']);
export const cloneFramework = value => JSON.parse(JSON.stringify(value));

function input(value, maximum = FRAMEWORK_LIMITS.payload) {
    let count = 0;
    const visit = (part, depth) => {
        if (depth > 18 || ++count > 45000) fail('limit', '数据层级或条目过多');
        if (part === null || typeof part === 'string' || typeof part === 'boolean') return;
        if (typeof part === 'number' && Number.isFinite(part)) return;
        if (typeof part !== 'object') fail('type', '仅接受 JSON 数据');
        if (!Array.isArray(part) && ![Object.prototype, null].includes(Object.getPrototypeOf(part))) fail('type', '仅接受普通数据对象');
        for (const [key, child] of Object.entries(part)) {
            if (blockedKeys.has(key)) fail('key', '字段标识不合法');
            visit(child, depth + 1);
        }
    };
    visit(value, 0);
    if (JSON.stringify(value).length > maximum) fail('limit', '数据超过保存上限');
    return value;
}
function keys(value, allowed) {
    if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('shape', '存在不支持的数据字段');
}
function identifier(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) || blockedKeys.has(value)) fail('id', '编号须为稳定的字母、数字、短横线或下划线');
    return value;
}
function string(value, max = 160, allowEmpty = false) {
    if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) fail('text', '名称或文字为空、过长');
    return value;
}
function bool(value) { if (typeof value !== 'boolean') fail('type', '开关须为布尔值'); return value; }
function finite(value) { if (typeof value !== 'number' || !Number.isFinite(value)) fail('number', '数值须为有限的 JSON 数字'); return value; }
function sequence(value, maximum) { if (!Array.isArray(value) || value.length > maximum) fail('limit', '列表格式或长度不合法'); return value; }
function order(value) { if (!Number.isInteger(value) || value < 0 || value > 10000) fail('order', '排序值不合法'); return value; }
function unique(values) { if (new Set(values).size !== values.length) fail('duplicate', '存在重复编号或选项'); }

const definitionKeys = ['id', 'label', 'description', 'type', 'unit', 'min', 'max', 'integer', 'options', 'columns', 'summary', 'order', 'groupId', 'archived'];
function fieldDefinition(raw, column = false) {
    keys(raw, column ? ['id', 'label', 'description', 'type', 'unit', 'min', 'max', 'integer', 'options'] : definitionKeys);
    const result = { id: identifier(raw.id), label: string(raw.label), type: raw.type };
    if (!FIELD_TYPES.includes(raw.type) || (column && raw.type === 'collection')) fail('type', '字段类型不支持');
    if (!column) {
        result.groupId = identifier(raw.groupId);
        result.order = order(raw.order ?? 0);
        result.summary = bool(raw.summary ?? false);
        result.archived = bool(raw.archived ?? false);
    }
    if (own(raw, 'description')) result.description = string(raw.description, 2000, true);
    if (own(raw, 'unit')) result.unit = string(raw.unit, 40, true);
    for (const name of ['min', 'max']) if (own(raw, name)) {
        if (!['number', 'resource'].includes(raw.type)) fail('type', '只有数值类型可以定义数值范围');
        result[name] = finite(raw[name]);
    }
    if (own(raw, 'integer')) {
        if (!['number', 'resource'].includes(raw.type)) fail('type', '整数约束仅适用于数值');
        result.integer = bool(raw.integer);
    }
    if (own(result, 'min') && own(result, 'max') && result.min > result.max) fail('range', '最小值不能大于最大值');
    if (raw.type === 'choice') {
        result.options = sequence(raw.options, 32).map(option => string(option, 100));
        if (!result.options.length) fail('choice', '选项不能为空');
        unique(result.options);
    } else if (own(raw, 'options')) fail('type', '选项仅适用于选择字段');
    if (raw.type === 'collection') {
        result.columns = sequence(raw.columns, FRAMEWORK_LIMITS.columns).map(column => fieldDefinition(column, true));
        if (!result.columns.length) fail('columns', '条目须有至少一个字段');
        unique(result.columns.map(column => column.id));
    } else if (own(raw, 'columns')) fail('type', '条目定义仅适用于集合');
    return result;
}
function entityDefinition(raw) {
    keys(raw, ['id', 'label', 'description', 'kind', 'archived']);
    const result = { id: identifier(raw.id), label: string(raw.label), archived: bool(raw.archived ?? false) };
    if (own(raw, 'kind')) result.kind = string(raw.kind, 80);
    if (own(raw, 'description')) result.description = string(raw.description, 2000, true);
    return result;
}
function groupDefinition(raw) {
    keys(raw, ['id', 'entityId', 'label', 'description', 'layout', 'order', 'archived']);
    const result = { id: identifier(raw.id), entityId: identifier(raw.entityId), label: string(raw.label), layout: raw.layout ?? 'grid', order: order(raw.order ?? 0), archived: bool(raw.archived ?? false) };
    if (!['grid', 'list', 'details'].includes(result.layout)) fail('layout', '展示方式不支持');
    if (own(raw, 'description')) result.description = string(raw.description, 2000, true);
    return result;
}
function validateNumber(value, definition) {
    finite(value);
    if (definition.integer && !Number.isInteger(value)) fail('integer', `${definition.label}须为整数`);
    if ((own(definition, 'min') && value < definition.min) || (own(definition, 'max') && value > definition.max)) fail('range', `${definition.label}超出已定义范围`);
}
export function validateFieldValue(value, definition) {
    if (value === null) return; // Unknown is distinct from zero and an empty collection.
    switch (definition.type) {
        case 'number': validateNumber(value, definition); break;
        case 'text': string(value, 4000, true); break;
        case 'boolean': bool(value); break;
        case 'choice': if (!definition.options.includes(value)) fail('choice', `${definition.label}不是有效选项`); break;
        case 'resource': {
            keys(value, ['current', 'max']);
            validateNumber(value.current, definition); validateNumber(value.max, definition);
            if (value.max <= (definition.min ?? 0) || value.current < (definition.min ?? 0) || value.current > value.max) fail('range', `${definition.label}的当前值或上限不合法`);
            break;
        }
        // Labels carry no identity. Preserve repeated entries and their quantity.
        case 'tags': sequence(value, 32).forEach(tag => string(tag, 160)); break;
        case 'collection': {
            sequence(value, FRAMEWORK_LIMITS.items);
            unique(value.map(item => identifier(item.id)));
            for (const item of value) {
                keys(item, ['id', 'values', 'archived']);
                if (own(item, 'archived')) bool(item.archived);
                if (!object(item.values) || Object.keys(item.values).some(key => !definition.columns.some(column => column.id === key))) fail('column', '条目引用了未定义字段');
                for (const column of definition.columns) validateFieldValue(item.values[column.id] ?? null, column);
            }
            break;
        }
        default: fail('type', '字段类型不支持');
    }
}

export const emptyFramework = () => ({ protocol: 1, revision: 0, initialized: false, title: '', entities: [], groups: [], fields: [], values: {}, locks: { structure: [], value: [] }, applied: [] });
export function validateFramework(state) {
    input(state, FRAMEWORK_LIMITS.state);
    keys(state, ['protocol', 'revision', 'initialized', 'title', 'entities', 'groups', 'fields', 'values', 'locks', 'applied']);
    if (state.protocol !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0) fail('version', '状态版本不支持');
    bool(state.initialized); string(state.title, 160, true);
    sequence(state.entities, FRAMEWORK_LIMITS.entities).forEach(entityDefinition);
    sequence(state.groups, FRAMEWORK_LIMITS.groups).forEach(groupDefinition);
    sequence(state.fields, FRAMEWORK_LIMITS.fields).forEach(field => fieldDefinition(field));
    const allIds = [...state.entities, ...state.groups, ...state.fields].map(part => part.id);
    unique(allIds);
    for (const group of state.groups) if (!state.entities.some(entity => entity.id === group.entityId)) fail('reference', '组别所属对象不存在');
    for (const field of state.fields) if (!state.groups.some(group => group.id === field.groupId)) fail('reference', '字段所属组别不存在');
    if (!object(state.values) || Object.keys(state.values).some(key => !state.fields.some(field => field.id === key))) fail('reference', '数值引用了未定义字段');
    for (const field of state.fields) validateFieldValue(state.values[field.id] ?? null, field);
    keys(state.locks, ['structure', 'value']);
    for (const target of ['structure', 'value']) {
        sequence(state.locks[target], FRAMEWORK_LIMITS.fields + FRAMEWORK_LIMITS.groups + FRAMEWORK_LIMITS.entities);
        unique(state.locks[target]);
        for (const id of state.locks[target]) if (!allIds.includes(id)) fail('reference', '锁引用了不存在的定义');
    }
    sequence(state.applied, 32).forEach(entry => { keys(entry, ['id', 'payload']); identifier(entry.id); string(entry.payload, FRAMEWORK_LIMITS.payload); });
    unique(state.applied.map(entry => entry.id));
    if (!state.initialized && (state.entities.length || state.groups.length || state.fields.length || state.revision)) fail('state', '未初始化状态不应包含游戏数据');
    return state;
}
const canonical = value => object(value)
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : JSON.stringify(value);
const locate = (state, target, id) => {
    const table = { entity: state.entities, group: state.groups, field: state.fields }[target];
    if (!table) fail('target', '定义对象类型不支持');
    const result = table.find(part => part.id === id);
    if (!result) fail('reference', '引用的定义不存在');
    return result;
};
function ancestry(state, target, id) {
    const part = locate(state, target, id);
    if (target === 'entity') return [part];
    if (target === 'group') return [part, locate(state, 'entity', part.entityId)];
    return [part, ...ancestry(state, 'group', part.groupId)];
}
function available(state, target, id) {
    if (ancestry(state, target, id).some(part => part.archived)) fail('archived', '对象已归档，请先恢复');
}
function unlocked(state, target, id, mode, actor) {
    if (actor === 'manual') return;
    if (ancestry(state, target, id).some(part => state.locks[mode].includes(part.id))) fail('locked', '内容已由玩家锁定');
}
export function isFrameworkLocked(state, target, id, mode = 'value') {
    return ancestry(state, target, id).some(part => state.locks[mode].includes(part.id));
}
function addDefinition(state, target, raw, actor) {
    const normalize = { entity: entityDefinition, group: groupDefinition, field: fieldDefinition }[target];
    const result = normalize(raw);
    if ([...state.entities, ...state.groups, ...state.fields].some(part => part.id === result.id)) fail('duplicate', '编号已存在，改名请更新原定义');
    if (target !== 'entity') {
        const parentType = target === 'group' ? 'entity' : 'group';
        const parentId = target === 'group' ? result.entityId : result.groupId;
        available(state, parentType, parentId); unlocked(state, parentType, parentId, 'structure', actor);
    }
    ({ entity: state.entities, group: state.groups, field: state.fields })[target].push(result);
    if (target === 'field') state.values[result.id] = null;
}

/** Applies one atomic transaction to a clone. The caller persists only on success. */
export function applyFrameworkTransaction(previous, raw, { actor = 'model' } = {}) {
    if (!['model', 'manual'].includes(actor)) fail('actor', '操作来源不支持');
    validateFramework(previous); input(raw);
    keys(raw, ['protocol', 'id', 'baseRevision', 'ops']);
    if (raw.protocol !== 1) fail('version', '事务协议版本不支持');
    identifier(raw.id); sequence(raw.ops, 256);
    if (!raw.ops.length) fail('empty', '更新操作不能为空');
    const payload = canonical(raw);
    const applied = previous.applied.find(entry => entry.id === raw.id);
    if (applied) {
        if (applied.payload !== payload) fail('duplicate', '同一事务编号的内容发生变化');
        return { state: cloneFramework(previous), duplicate: true, changes: [] };
    }
    if (raw.baseRevision !== previous.revision) fail('conflict', '状态已变化，请基于最新记录重新更新');
    const state = cloneFramework(previous), changes = [];
    for (const op of raw.ops) {
        if (!object(op)) fail('operation', '更新操作不合法');
        if (op.op === 'init') {
            keys(op, ['op', 'title', 'entities', 'groups', 'fields', 'values']);
            if (state.initialized || raw.ops.length !== 1) fail('init', '游戏只能初始化一次，后续使用增量更新');
            state.title = string(op.title); state.initialized = true;
            sequence(op.entities, FRAMEWORK_LIMITS.entities).forEach(part => addDefinition(state, 'entity', part, actor));
            sequence(op.groups, FRAMEWORK_LIMITS.groups).forEach(part => addDefinition(state, 'group', part, actor));
            sequence(op.fields, FRAMEWORK_LIMITS.fields).forEach(part => addDefinition(state, 'field', part, actor));
            if (!object(op.values)) fail('shape', '初值须为对象');
            for (const [id, value] of Object.entries(op.values)) { locate(state, 'field', id); state.values[id] = cloneFramework(value); }
            changes.push({ kind: 'init', label: state.title });
            continue;
        }
        if (!state.initialized) fail('init', '请先初始化本游戏的数据结构');
        if (op.op === 'create') {
            keys(op, ['op', 'target', 'definition']);
            if (!['entity', 'group', 'field'].includes(op.target)) fail('target', '创建对象类型不支持');
            addDefinition(state, op.target, op.definition, actor);
            changes.push({ kind: 'create', label: op.definition.label });
        } else if (op.op === 'updateDefinition') {
            keys(op, ['op', 'target', 'id', 'patch']); identifier(op.id);
            const old = locate(state, op.target, op.id);
            available(state, op.target, op.id); unlocked(state, op.target, op.id, 'structure', actor);
            const allowed = { entity: ['label', 'kind', 'description'], group: ['label', 'description', 'layout', 'order'], field: ['label', 'description', 'groupId', 'unit', 'min', 'max', 'integer', 'options', 'columns', 'summary', 'order'] }[op.target];
            keys(op.patch, allowed);
            if (op.target === 'field' && own(op.patch, 'columns')) {
                if (old.type !== 'collection') fail('type', '只有集合可以定义条目字段');
                sequence(op.patch.columns, FRAMEWORK_LIMITS.columns);
                for (const column of old.columns) {
                    const next = op.patch.columns.find(part => part.id === column.id);
                    if (!next || next.type !== column.type) fail('columns', '已有条目字段须保留编号和类型');
                }
            }
            if (op.target === 'field' && own(op.patch, 'groupId')) {
                const from = locate(state, 'group', old.groupId), to = locate(state, 'group', op.patch.groupId);
                if (from.entityId !== to.entityId) fail('owner', '移组不能改变字段所属对象');
                available(state, 'group', to.id); unlocked(state, 'group', to.id, 'structure', actor);
            }
            Object.assign(old, cloneFramework(op.patch));
            changes.push({ kind: 'definition', label: old.label });
        } else if (op.op === 'archive') {
            keys(op, ['op', 'target', 'id', 'archived']); identifier(op.id); bool(op.archived);
            const part = locate(state, op.target, op.id);
            unlocked(state, op.target, op.id, 'structure', actor);
            // A parent archive must respect all descendant structure/value locks.
            if (actor === 'model') {
                const descendants = [...state.entities.map(p => ['entity', p.id]), ...state.groups.map(p => ['group', p.id]), ...state.fields.map(p => ['field', p.id])];
                for (const [target, id] of descendants) if (ancestry(state, target, id).some(p => p.id === part.id)) {
                    unlocked(state, target, id, 'structure', actor); unlocked(state, target, id, 'value', actor);
                }
            }
            part.archived = op.archived;
            changes.push({ kind: 'archive', label: part.label });
        } else if (op.op === 'setLock') {
            keys(op, ['op', 'target', 'id', 'locked']); identifier(op.id); bool(op.locked);
            if (actor !== 'manual') fail('permission', '模型不能更改玩家的锁');
            if (!['structure', 'value'].includes(op.target)) fail('target', '锁类型不支持');
            if (![...state.entities, ...state.groups, ...state.fields].some(part => part.id === op.id)) fail('reference', '锁定对象不存在');
            state.locks[op.target] = state.locks[op.target].filter(id => id !== op.id);
            if (op.locked) state.locks[op.target].push(op.id);
            changes.push({ kind: 'lock', label: op.id });
        } else if (['setValue', 'upsertItem', 'archiveItem'].includes(op.op)) {
            keys(op, op.op === 'setValue' ? ['op', 'fieldId', 'value'] : op.op === 'upsertItem' ? ['op', 'fieldId', 'item'] : ['op', 'fieldId', 'itemId', 'archived']);
            identifier(op.fieldId);
            const field = locate(state, 'field', op.fieldId);
            available(state, 'field', field.id); unlocked(state, 'field', field.id, 'value', actor);
            const before = cloneFramework(state.values[field.id] ?? null);
            if (op.op === 'setValue') {
                // Collections use stable item IDs; omitted items are never deleted.
                if (field.type === 'collection' && !(before === null && Array.isArray(op.value) && op.value.length === 0)) fail('collection', '集合须按条目更新，不能整批覆盖');
                validateFieldValue(op.value, field); state.values[field.id] = cloneFramework(op.value);
            } else {
                if (field.type !== 'collection') fail('collection', '此字段不是集合');
                state.values[field.id] ??= [];
                if (op.op === 'upsertItem') {
                    keys(op.item, ['id', 'values']); identifier(op.item.id);
                    if (!object(op.item.values)) fail('shape', '条目值须为对象');
                    const old = state.values[field.id].find(item => item.id === op.item.id);
                    if (old?.archived) fail('archived', '条目已归档，请先恢复');
                    const item = { id: op.item.id, values: { ...(old?.values ?? {}), ...cloneFramework(op.item.values) } };
                    if (old) Object.assign(old, item); else state.values[field.id].push(item);
                } else {
                    identifier(op.itemId); bool(op.archived);
                    const item = state.values[field.id].find(item => item.id === op.itemId);
                    if (!item) fail('reference', '条目不存在');
                    item.archived = op.archived;
                }
                validateFieldValue(state.values[field.id], field);
            }
            if (canonical(before) !== canonical(state.values[field.id])) changes.push({ kind: 'value', fieldId: field.id, label: field.label, before, after: cloneFramework(state.values[field.id]) });
        } else fail('operation', '更新操作不支持');
    }
    state.revision += 1;
    state.applied = [...state.applied, { id: raw.id, payload }].slice(-32);
    validateFramework(state);
    return { state, duplicate: false, changes };
}

export function activeFrameworkGroups(state, entityId) {
    return state.groups.filter(group => group.entityId === entityId && !ancestry(state, 'group', group.id).some(part => part.archived)).sort((a, b) => a.order - b.order);
}
export function activeFrameworkFields(state, groupId) {
    return state.fields.filter(field => field.groupId === groupId && !ancestry(state, 'field', field.id).some(part => part.archived)).sort((a, b) => a.order - b.order);
}
export function exportFramework(state) { validateFramework(state); return JSON.stringify(state); }
export function importFramework(raw) {
    if (typeof raw !== 'string' || raw.length > FRAMEWORK_LIMITS.state) fail('limit', '保存数据过长');
    let value; try { value = JSON.parse(raw); } catch { fail('json', '保存数据不是有效 JSON'); }
    validateFramework(value); return cloneFramework(value);
}
