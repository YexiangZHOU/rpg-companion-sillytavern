import { activeFrameworkGroups, activeFrameworkFields, isFrameworkLocked } from './state.mjs';

const panelStrings = {
    zh: { empty: '游戏数据尚未初始化', emptyHint: '开始游戏后，模型会按当前设定建立需要记录的信息。', unknown: '未记录', emptyValue: '（空）', yes: '是', no: '否', items: '项', archive: '归档', archived: '已归档', restore: '恢复', edit: '编辑', settings: '字段设置', save: '保存', cancel: '取消', label: '名称', description: '说明', unit: '单位', summary: '显示在摘要', value: '值', maximum: '上限', add: '添加条目', rename: '重命名', struct: '结构锁', lock: '数值锁', lockedHint: '锁定后模型不能修改；玩家仍可手动编辑', restoreHint: '本组没有可见字段', details: '详情', actor: '查看对象' },
    en: { empty: 'Game data has not been initialized', emptyHint: 'The model will create the data structure for this game.', unknown: 'Not recorded', emptyValue: '(empty)', yes: 'Yes', no: 'No', items: 'items', archive: 'Archive', archived: 'Archived', restore: 'Restore', edit: 'Edit', settings: 'Field settings', save: 'Save', cancel: 'Cancel', label: 'Name', description: 'Description', unit: 'Unit', summary: 'Show in summary', value: 'Value', maximum: 'Maximum', add: 'Add item', rename: 'Rename', struct: 'Structure lock', lock: 'Value lock', lockedHint: 'Locks prevent model updates. Manual edits remain available.', restoreHint: 'This group has no visible fields', details: 'Details', actor: 'View entity' },
};
const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
};
const button = (label, callback, className = 'uf-button') => {
    const element = node('button', className, label); element.type = 'button'; element.addEventListener('click', async event => {
        try { await callback(event); } catch (failure) {
            const root=element.closest('.uf-panel');if(!root)return;
            root.querySelector('.uf-operation-error')?.remove();const error=node('p','uf-operation-error',failure.message);error.setAttribute('role','alert');root.append(error);
        }
    }); return element;
};

export class FrameworkPanel {
    constructor(root, { onOperation, language = 'zh', getPortrait, presentation = 'editor', onPortrait, onPortraitLock, isPortraitLocked, hasGeneratedPortrait } = {}) {
        Object.assign(this, { root, onOperation, getPortrait, presentation, onPortrait, onPortraitLock, isPortraitLocked, hasGeneratedPortrait }); this.strings = panelStrings[language] ?? panelStrings.zh;
        this.entityId = null; this.selected = new Map(); this.opened = new Map(); this.scrollPositions = new Map(); this.renderedGroup = null; this.serial = 0;
        root.classList.add('uf-panel');
    }
    format(value) {
        const t = this.strings;
        if (value === null || value === undefined) return t.unknown;
        if (typeof value === 'boolean') return value ? t.yes : t.no;
        if (Array.isArray(value)) return value.length && typeof value[0] === 'object' ? `${value.filter(item => !item.archived).length} ${t.items}` : value.join(' · ') || t.emptyValue;
        if (typeof value === 'object') return `${value.current} / ${value.max}`;
        return String(value) || t.emptyValue;
    }
    details(key, label) {
        const element = node('details', 'uf-details');
        element.open = this.opened.get(key) ?? false;
        element.append(node('summary', '', label));
        element.addEventListener('toggle', () => { if (element.isConnected) this.opened.set(key, element.open); });
        return element;
    }
    render(state) {
        if (this.presentation === 'game') return this.renderGame(state);
        const oldScroll = this.root.querySelector('.uf-content')?.scrollTop ?? 0;
        if (this.renderedGroup) this.scrollPositions.set(this.renderedGroup, oldScroll);
        const oldNavScroll = this.root.querySelector('.uf-nav')?.scrollTop ?? 0;
        const focusKey = this.root.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
        this.root.querySelectorAll('details[data-detail]').forEach(part => this.opened.set(part.dataset.detail, part.open));
        this.state = state;
        const t = this.strings;
        this.root.replaceChildren();
        if (!state.initialized) {
            const empty = node('section', 'uf-empty'); empty.append(node('h2', '', t.empty), node('p', '', t.emptyHint)); this.root.append(empty); return;
        }
        const entities = state.entities.filter(entity => !entity.archived);
        if (!entities.some(entity => entity.id === this.entityId)) this.entityId = entities[0]?.id ?? null;
        const entity = entities.find(part => part.id === this.entityId);
        const header = node('header', 'uf-header');
        const identity = node('div', 'uf-identity');
        const portrait = node('div', 'uf-avatar', entity?.label.slice(0, 1) ?? '◇'); portrait.setAttribute('aria-hidden', 'true');
        const portraitUrl = entity && this.getPortrait?.(entity);
        if (portraitUrl) { const img = node('img', 'uf-avatar-image'); img.src = portraitUrl; img.alt = entity.label; img.addEventListener('error', () => img.remove(), { once: true }); portrait.append(img); }
        const names = node('div', 'uf-names'); names.append(node('h2', '', entity?.label ?? state.title));
        if (entity?.kind) names.append(node('p', '', ({ zh:{player:'玩家',npc:'角色',scene:'场景',encounter:'遭遇'},en:{player:'Player',npc:'Character',scene:'Scene',encounter:'Encounter'} }[t === panelStrings.zh ? 'zh':'en'][entity.kind]) ?? entity.kind));
        if (entities.length > 1) {
            const label = node('label', 'uf-entity-label', t.actor);
            const select = node('select', 'uf-select'); select.setAttribute('aria-label', t.actor); select.dataset.focus = 'entity';
            for (const part of entities) { const option = node('option', '', part.label); option.value = part.id; select.append(option); }
            select.value = this.entityId;
            select.addEventListener('change', () => { this.entityId = select.value; this.render(this.state); });
            label.append(select); names.append(label);
        }
        identity.append(portrait, names); header.append(identity);
        if(entity?.description){const detail=this.details(`entity_${entity.id}`,t.description);detail.dataset.detail=`entity_${entity.id}`;detail.append(node('p','',entity.description));header.append(detail);}
        const groups = activeFrameworkGroups(state, this.entityId);
        const allFields = groups.flatMap(group => activeFrameworkFields(state, group.id));
        const summaries = node('div', 'uf-summaries');
        for (const field of allFields.filter(field => field.summary).slice(0, 6)) summaries.append(this.fieldView(field, true));
        header.append(summaries); this.root.append(header);
        let groupId = this.selected.get(this.entityId);
        if (!groups.some(group => group.id === groupId)) groupId = groups[0]?.id;
        this.selected.set(this.entityId, groupId);
        const nav = node('nav', 'uf-nav'); nav.setAttribute('aria-label', '组别 / Groups');
        for (const group of groups) {
            const tab = button(group.label, () => { this.selected.set(this.entityId, group.id); this.render(this.state); }, `uf-tab${group.id === groupId ? ' is-active' : ''}`);
            tab.dataset.focus = `group_${group.id}`; tab.setAttribute('aria-pressed', String(group.id === groupId));
            nav.append(tab);
        }
        this.root.append(nav);
        const content = node('section', 'uf-content');
        const group = groups.find(part => part.id === groupId);
        if (group) {
            content.setAttribute('aria-label', group.label);
            const title = node('div', 'uf-group-heading'); title.append(node('h3', '', group.label));
            title.append(button(t.rename, () => this.renameGroup(group), 'uf-subtle'));
            content.append(title);
            if (group.description) content.append(node('p', 'uf-description', group.description));
            const toolbar = node('div', 'uf-locks');
            for (const mode of ['structure', 'value']) {
                const isLocked = isFrameworkLocked(state, 'group', group.id, mode);
                const control = button(`${isLocked ? '● ' : '○ '}${mode === 'structure' ? t.struct : t.lock}`, () => this.onOperation?.({ op: 'setLock', target: mode, id: group.id, locked: !state.locks[mode].includes(group.id) }), `uf-subtle${isLocked ? ' is-locked' : ''}`);
                control.title = t.lockedHint; control.dataset.focus = `lock_${mode}_${group.id}`; control.setAttribute('aria-pressed', String(isLocked)); toolbar.append(control);
            }
            content.append(toolbar);
            const fields = activeFrameworkFields(state, group.id);
            const grid = node('div', `uf-fields uf-layout-${group.layout}`);
            for (const field of fields) grid.append(this.fieldView(field));
            if(group.layout==='details'){const detail=this.details(`group_${group.id}`,t.details);detail.dataset.detail=`group_${group.id}`;detail.append(grid);content.append(detail);}else content.append(grid);
            if (!fields.length) content.append(node('p', 'uf-description', t.restoreHint));
        }
        this.root.append(content);
        nav.scrollTop = oldNavScroll;
        content.scrollTop = this.scrollPositions.get(groupId) ?? 0;
        this.renderedGroup = groupId;
        if (focusKey) [...this.root.querySelectorAll('[data-focus]')].find(part => part.dataset.focus === focusKey)?.focus({ preventScroll: true });
    }
    renderGame(state) {
        const t = this.strings, zh = t === panelStrings.zh;
        const focusKey = this.root.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
        this.root.querySelectorAll('details[data-detail]').forEach(part => this.opened.set(part.dataset.detail, part.open));
        this.state = state;
        this.root.replaceChildren(); this.root.classList.add('uf-game'); this.root.classList.toggle('is-editing', !!this.editing);
        const entity = state.entities.find(e => !e.archived);
        this.entityId = entity?.id ?? null;
        if (!entity) return;
        const header = node('header', 'uf-header');
        const identity = node('div', 'uf-identity');
        if (entity.kind !== 'scene' && entity.kind !== 'encounter') {
            const portrait = node('div', 'uf-avatar', entity.label.slice(0, 1));
            const url = this.getPortrait?.(entity);
            if (url) { const img = node('img', 'uf-avatar-image'); img.src = url; img.alt = entity.label; img.addEventListener('error', () => img.remove(), { once: true }); portrait.append(img); }
            identity.append(portrait);
        }
        const names = node('div', 'uf-names'); names.append(node('h2', '', entity.label));
        const actions = node('div', 'uf-entity-actions');
        const editing = button(zh ? '编辑' : 'Edit', () => { this.editing = !this.editing; this.render(this.state); }, 'uf-subtle');
        editing.dataset.focus = `edit_${entity.id}`; editing.setAttribute('aria-pressed', String(!!this.editing)); actions.append(editing);
        if (this.onPortrait && entity.kind !== 'scene' && entity.kind !== 'encounter') {
            actions.append(button(zh ? '生成头像' : 'Portrait', () => this.onPortrait(entity.id), 'uf-subtle'));
            if (this.hasGeneratedPortrait?.(entity.id)) {
                const locked = !!this.isPortraitLocked?.(entity.id);
                const lock = button(zh ? (locked ? '头像已锁定' : '锁定头像') : (locked ? 'Portrait locked' : 'Lock portrait'), () => this.onPortraitLock?.(entity.id), 'uf-subtle');
                lock.setAttribute('aria-pressed', String(locked)); actions.append(lock);
            }
        }
        names.append(actions); identity.append(names); header.append(identity);
        // Public description stays above appearance; it is not an inferred thought.
        if (entity.description) header.append(node('p', 'uf-description uf-entity-description', entity.description));
        this.root.append(header);
        const groups = activeFrameworkGroups(state, entity.id);
        const appearance = groups.flatMap(g => activeFrameworkFields(state, g.id)).filter(f => f.type === 'text' && /^(?:外观|相貌|外貌|appearance)$/i.test(f.label.trim()));
        if (appearance.length) { const section = node('div', 'uf-appearance'); for (const field of appearance) section.append(this.fieldView(field)); this.root.append(section); }
        const summaryFields = entity.kind === 'npc' ? [] : groups.flatMap(g => activeFrameworkFields(state, g.id)).filter(f => f.summary && !appearance.includes(f)).slice(0,6);
        if (summaryFields.length) { const summaries = node('div','uf-game-summaries'); summaryFields.forEach(f => summaries.append(this.fieldView(f, true))); this.root.append(summaries); }
        const content = node('section', 'uf-content');
        let parent = content;
        if (entity.kind === 'npc') {
            const status = this.details(`status_${entity.id}`, zh ? '状态' : 'Status'); status.dataset.detail = `status_${entity.id}`;
            if (this.editing) status.open = true;
            content.append(status); parent = status;
        }
        for (const [index, group] of groups.entries()) {
            const fields = activeFrameworkFields(state, group.id).filter(f => !appearance.includes(f) && (this.editing || !summaryFields.includes(f)));
            if (!fields.length && !this.editing) continue;
            const section = this.details(`game_group_${group.id}`, group.label); section.classList.add('uf-group'); section.dataset.detail = `game_group_${group.id}`;
            section.open = this.opened.get(section.dataset.detail) ?? (index === 0 || entity.kind === 'npc' || entity.kind === 'scene');
            if (group.description) section.append(node('p', 'uf-description', group.description));
            const tools = node('div', 'uf-group-tools'); tools.append(button(t.rename, () => this.renameGroup(group), 'uf-subtle'));
            for (const mode of ['structure', 'value']) {
                const locked = isFrameworkLocked(state, 'group', group.id, mode);
                const control = button(`${locked ? '● ' : '○ '}${mode === 'structure' ? t.struct : t.lock}`, () => this.onOperation?.({ op: 'setLock', target: mode, id: group.id, locked: !state.locks[mode].includes(group.id) }), 'uf-subtle');
                control.title = t.lockedHint; control.dataset.focus = `lock_${mode}_${group.id}`; control.setAttribute('aria-pressed', String(locked)); tools.append(control);
            }
            section.append(tools);
            const grid = node('div', `uf-fields uf-layout-${group.layout}`);
            fields.forEach(field => grid.append(this.fieldView(field))); section.append(grid); parent.append(section);
        }
        this.root.append(content);
        if (focusKey) [...this.root.querySelectorAll('[data-focus]')].find(part => part.dataset.focus === focusKey)?.focus({ preventScroll: true });
    }
    fieldView(field, compact = false) {
        const t = this.strings, value = this.state.values[field.id] ?? null;
        const wrapper = node('div', `uf-field uf-type-${field.type}${compact ? ' is-summary' : ''}`);
        const label = node('div', 'uf-field-label', field.label);
        if (isFrameworkLocked(this.state, 'field', field.id, 'value')) { const lock = node('span', 'uf-lock-indicator', '●'); lock.title = t.lockedHint; label.append(lock); }
        wrapper.append(label);
        if (!compact && field.type === 'collection' && value !== null) {
            const list = node('div', 'uf-list');
            for (const item of value.filter(item => !item.archived)) {
                const first = field.columns[0];
                const detail = this.details(`item_${field.id}_${item.id}`, this.format(item.values[first.id])); detail.dataset.detail = `item_${field.id}_${item.id}`;
                const cells = node('dl', 'uf-item-values');
                for (const column of field.columns) { cells.append(node('dt', '', column.label), node('dd', '', this.format(item.values[column.id]) + (column.unit ? ` ${column.unit}` : ''))); }
                detail.append(cells, button(t.edit, () => this.editItem(field, item), 'uf-subtle'));
                detail.append(button(t.archive, () => this.onOperation?.({ op: 'archiveItem', fieldId: field.id, itemId: item.id, archived: true }), 'uf-subtle'));
                list.append(detail);
            }
            if (!value.filter(item => !item.archived).length) list.append(node('p', 'uf-description', `0 ${t.items}`));
            wrapper.append(list, button(t.add, () => this.editItem(field), 'uf-subtle'));
            const archived = value.filter(item => item.archived);
            if (archived.length) {
                const detail = this.details(`archived_${field.id}`, `${t.archived} · ${archived.length}`); detail.dataset.detail = `archived_${field.id}`;
                for (const item of archived) {
                    const row = node('div', 'uf-archived-row'); row.append(node('span', '', this.format(item.values[field.columns[0].id])));
                    row.append(button(t.restore, () => this.onOperation?.({ op: 'archiveItem', fieldId: field.id, itemId: item.id, archived: false }), 'uf-subtle')); detail.append(row);
                }
                wrapper.append(detail);
            }
        } else {
            const edit = button(this.format(value) + (field.unit && value !== null ? ` ${field.unit}` : ''), () => field.type === 'collection' ? this.editItem(field) : this.editValue(field), 'uf-value');
            edit.title = t.edit; edit.setAttribute('aria-label', `${t.edit} ${field.label}`); edit.dataset.focus = `field_${field.id}`;
            if (value === null) edit.classList.add('is-unknown');
            wrapper.append(edit);
            if (field.type === 'resource' && value !== null) {
                const track = node('div', 'uf-track'); track.setAttribute('role', 'meter'); track.setAttribute('aria-label', field.label);
                track.setAttribute('aria-valuemin', String(field.min ?? 0)); track.setAttribute('aria-valuemax', String(value.max)); track.setAttribute('aria-valuenow', String(value.current));
                const fill = node('div', 'uf-fill'); fill.style.width = `${100 * (value.current - (field.min ?? 0)) / (value.max - (field.min ?? 0))}%`; track.append(fill); wrapper.append(track);
            }
        }
        if (!compact) {
            if (field.description) { const desc = this.details(`desc_${field.id}`, t.details); desc.dataset.detail = `desc_${field.id}`; desc.append(node('p', '', field.description)); wrapper.append(desc); }
            const settings = button('⋯', () => this.editDefinition(field), 'uf-field-settings'); settings.title = t.settings; settings.setAttribute('aria-label', `${t.settings} ${field.label}`); wrapper.append(settings);
        }
        return wrapper;
    }
    dialog(title, populate, submit) {
        const t = this.strings;
        const activeKey = document.activeElement?.dataset.focus;
        const dialog = node('dialog', 'uf-dialog'), form = node('form', 'uf-form');
        form.append(node('h3', '', title)); const read = populate(form);
        const error = node('p', 'uf-form-error'); error.setAttribute('role', 'alert'); form.append(error);
        const actions = node('div', 'uf-form-actions'); actions.append(button(t.cancel, () => dialog.close()));
        const save = node('button', 'uf-button uf-primary', t.save); save.type = 'submit'; actions.append(save); form.append(actions);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            save.disabled = true;
            try { await submit(read()); dialog.close(); } catch (failure) { error.textContent = failure.message; } finally { save.disabled = false; }
        });
        dialog.append(form); document.body.append(dialog);
        dialog.addEventListener('close', () => { dialog.remove(); if (activeKey) [...this.root.querySelectorAll('[data-focus]')].find(part => part.dataset.focus === activeKey)?.focus({ preventScroll: true }); });
        dialog.showModal();
    }
    editor(form, field, value) {
        const t = this.strings;
        const section = node('fieldset', 'uf-editor'); section.append(node('legend', '', field.label));
        const unknownLabel = node('label', 'uf-unknown-control');
        const unknown = node('input'); unknown.type = 'checkbox'; unknown.checked = value === null; unknownLabel.append(unknown, document.createTextNode(t.unknown)); section.append(unknownLabel);
        const controls = node('div', 'uf-editor-controls');
        let read;
        const inputFor = (label, type, initial) => {
            const holder = node('label', 'uf-input-label', label), control = node(type === 'textarea' ? 'textarea' : 'input', 'uf-input');
            if (type !== 'textarea') control.type = type;
            if (type === 'number') { control.step = field.integer ? '1' : 'any'; if (field.min !== undefined) control.min = field.min; if (field.max !== undefined) control.max = field.max; }
            control.value = initial ?? ''; holder.append(control); controls.append(holder); return control;
        };
        if (field.type === 'number') { const control = inputFor(t.value, 'number', value); read = () => { if (!control.value.trim()) throw new Error(t.unknown); return Number(control.value); }; }
        else if (field.type === 'resource') {
            const current = inputFor(t.value, 'number', value?.current), max = inputFor(t.maximum, 'number', value?.max);
            read = () => { if (!current.value.trim() || !max.value.trim()) throw new Error(t.unknown); return { current: Number(current.value), max: Number(max.value) }; };
        } else if (field.type === 'boolean') { const control = inputFor(t.value, 'checkbox', ''); control.checked = value === true; read = () => control.checked; }
        else if (field.type === 'choice') {
            const control = node('select', 'uf-input'); control.setAttribute('aria-label', field.label);
            for (const option of field.options) { const element = node('option', '', option); element.value = option; control.append(element); }
            if (value !== null) control.value = value; controls.append(control); read = () => control.value;
        } else {
            const control = inputFor(t.value, 'textarea', field.type === 'tags' ? value?.join('\n') : value);
            read = () => field.type === 'tags' ? control.value.split('\n').map(part => part.trim()).filter(Boolean) : control.value;
        }
        const disable = () => controls.querySelectorAll('input,select,textarea').forEach(control => { control.disabled = unknown.checked; });
        unknown.addEventListener('change', disable); disable(); section.append(controls); form.append(section);
        return () => unknown.checked ? null : read();
    }
    editValue(field) { this.dialog(field.label, form => this.editor(form, field, this.state.values[field.id] ?? null), value => this.onOperation?.({ op: 'setValue', fieldId: field.id, value })); }
    editItem(field, item) {
        this.dialog(`${field.label} · ${item ? this.strings.edit : this.strings.add}`, form => {
            const reads = field.columns.map(column => [column.id, this.editor(form, column, item?.values[column.id] ?? null)]);
            return () => Object.fromEntries(reads.map(([id, read]) => [id, read()]));
        }, values => this.onOperation?.({ op: 'upsertItem', fieldId: field.id, item: { id: item?.id ?? `entry_${Date.now()}_${++this.serial}`, values } }));
    }
    nameEditor(form, label, initial) {
        const holder = node('label', 'uf-input-label', label), control = node('input', 'uf-input'); control.value = initial; control.required = true; control.maxLength = 160;
        holder.append(control); form.append(holder); return () => control.value;
    }
    renameGroup(group) { this.dialog(this.strings.rename, form => this.nameEditor(form, this.strings.label, group.label), label => this.onOperation?.({ op: 'updateDefinition', target: 'group', id: group.id, patch: { label } })); }
    editDefinition(field) {
        const t = this.strings;
        this.dialog(`${t.settings} · ${field.label}`, form => {
            const readLabel = this.nameEditor(form, t.label, field.label);
            const unitHolder = node('label', 'uf-input-label', t.unit), unit = node('input', 'uf-input'); unit.value = field.unit ?? ''; unit.maxLength = 40; unitHolder.append(unit); form.append(unitHolder);
            const summaryHolder = node('label', 'uf-unknown-control'), summary = node('input'); summary.type = 'checkbox'; summary.checked = field.summary; summaryHolder.append(summary, document.createTextNode(t.summary)); form.append(summaryHolder);
            return () => ({ label: readLabel(), unit: unit.value, summary: summary.checked });
        }, patch => this.onOperation?.({ op: 'updateDefinition', target: 'field', id: field.id, patch }));
    }
}

/** One content-sized card per entity, retaining editor state without a global selector. */
export class FrameworkRoster {
    constructor(root, options = {}) { this.root = root; this.options = options; this.panels = new Map(); this.folds = new Map(); this.entityId = null; }
    render(state) {
        this.root.querySelectorAll('details[data-entity]').forEach(e => this.folds.set(e.dataset.entity, e.open));
        this.root.replaceChildren();
        if (!state.initialized) {
            const t = panelStrings[this.options.language] ?? panelStrings.zh;
            const empty = node('div', 'uf-empty'); empty.append(node('p', '', t.emptyHint)); this.root.append(empty); return;
        }
        const entities = state.entities.filter(e => !e.archived);
        this.entityId = entities.find(e => e.kind === 'player')?.id ?? entities[0]?.id ?? null;
        const active = new Set();
        let npcHeading = false;
        for (const entity of entities) {
            if (this.options.side === 'left' && entity.kind === 'npc' && !npcHeading) { this.root.append(node('h3','uf-roster-heading',this.options.language === 'en' ? 'Other characters' : '其他角色')); npcHeading = true; }
            active.add(entity.id);
            let panel = this.panels.get(entity.id);
            if (!panel) { panel = new FrameworkPanel(node('section', 'uf-entity-card'), { ...this.options, presentation: 'game' }); this.panels.set(entity.id, panel); }
            panel.render({ ...state, entities: [entity] });
            if (!['player', 'scene', 'npc'].includes(entity.kind) && !(entity.id === this.entityId && !entities.some(e => e.kind === 'player'))) {
                const fold = node('details', 'uf-object-fold'); fold.dataset.entity = entity.id; fold.open = this.folds.get(entity.id) ?? false;
                fold.append(node('summary', '', entity.label), panel.root); this.root.append(fold);
            } else this.root.append(panel.root);
        }
        for (const id of this.panels.keys()) if (!active.has(id)) this.panels.delete(id);
    }
}
