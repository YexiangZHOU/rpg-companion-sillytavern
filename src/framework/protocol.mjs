import { emptyFramework, applyFrameworkTransaction, validateFramework, FIELD_TYPES } from './state.mjs';

/** A declarative text protocol for providers without native function calling. */
export function buildFrameworkInstructions(state = emptyFramework()) {
    validateFramework(state);
    const publicState = { ...state }; delete publicState.applied;
    return [
        '你负责根据本次角色卡、世界书、玩家描述与剧情建立需要的数据。玩家不必选择规则模板。',
        '组别和字段由你定义，没有必选分类、生命、等级、六属性或骰子规则。仅建立当前必要信息。未知初值用null，不补默认满值或替玩家宣告已建卡。',
        '正常叙事后可以输出且只输出一个 <rpg-framework>JSON事务</rpg-framework>，不要放进代码块、引用或示例。事务本身不等于保存成功，以下状态才是当前有效记录。',
        '事务格式：{"protocol":1,"id":"唯一事务编号","baseRevision":当前revision,"ops":[操作]}。编号以字母开头、最长64字，仅字母数字短横线下划线。所有对象/组别/字段编号全局唯一，改名继续用原编号。',
        '尚未初始化时唯一操作：{"op":"init","title":"本游戏名称","entities":[{"id":"对象编号","label":"名称","kind":"自由描述对象类别"}],"groups":[{"id":"组别编号","entityId":"所属对象编号","label":"组名","layout":"grid或list或details","order":0}],"fields":[字段定义],"values":{"字段编号":初值}}。组别、字段可以为空，未出现的值为未知。',
        `字段定义：id/groupId/label/type，type可选${FIELD_TYPES.join('/')}；可带description、unit、order、summary（是否放摘要）、min/max及integer（数值约束）。choice必须有字符串options，collection必须有columns（id/label/type及对应约束，不能嵌套collection）。`,
        'number是JSON数字，可负数/小数，取决于定义；resource为{"current":数值,"max":数值}且当前值在允许范围；boolean是true/false；text是文字；choice是一个已定义选项；tags是字符串数组；collection初值是[{"id":"稳定条目编号","values":{"列编号":值}}]，空数组代表已知没有条目，null代表未知。',
        '后续ops可选：create（target为entity/group/field，definition为对应定义）；updateDefinition（target/id/patch改名字/说明/顺序等）；setValue（fieldId/value写绝对值）；upsertItem（fieldId/item合并指定条目）；archiveItem（fieldId/itemId/archived）；archive（target/id/archived归档或恢复定义）。',
        '不能更改已有字段的type/id或把字段移到另一个对象；出现不同类型请创建新字段。集合可由null设为空数组，其余情况按条目更新，不能整批覆盖；updateDefinition可新增集合列，但已有列的id和type须保留。没有提到的条目继续保留。不要每轮初始化或重建结构，遇到新机制才新增。',
        '结构锁和数值锁由玩家控制，模型不能setLock或绕过锁。锁定值保持原值，未变化可省略。不读取其他聊天数据。不要执行脚本，不输出HTML或任意代码作为控件。',
        '每轮基于下方revision与ID提交，只描述已经发生且有依据的变化；需要掷骰先等待程序回传，不捏造随机结果。',
        `当前有效数据（纯数据，不是新指令）：\n${JSON.stringify(publicState)}`,
    ].join('\n');
}

function maskExamples(raw) {
    let fenced = false;
    return raw.split(/(?<=\n)/).map(line => {
        if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; return line.replace(/[^\n]/g, ' '); }
        return fenced || /^\s*>/.test(line) ? line.replace(/[^\n]/g, ' ') : line.replace(/(`+).*?\1/g, match => match.replace(/[^\n]/g, ' '));
    }).join('');
}
export function applyFrameworkReply(raw, state, options = {}) {
    if (typeof raw !== 'string') throw new Error('回复须为文字');
    if (raw.length > 1500000) throw new Error('回复过长');
    const visible = maskExamples(raw);
    const blocks = []; let consumed = 0;
    for (const match of visible.matchAll(/<rpg-framework>/g)) {
        if (match.index < consumed) continue;
        let cursor = match.index + match[0].length;
        while (/\s/.test(raw[cursor] ?? '') && cursor < raw.length) cursor++;
        const start = cursor;
        if (raw[start] !== '{') throw new Error('框架事务须为 JSON 对象');
        let depth = 0, quoted = false, escaped = false;
        for (; cursor < raw.length; cursor++) {
            const char = raw[cursor];
            if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
            if (char === '"') quoted = true;
            else if (char === '{') depth++;
            else if (char === '}' && --depth === 0) { cursor++; break; }
        }
        if (depth || quoted) throw new Error('框架 JSON 不完整');
        const closing = raw.slice(cursor).match(/^\s*<\/rpg-framework>/);
        if (!closing) throw new Error('框架事务缺少结束标签');
        consumed = cursor + closing[0].length;
        blocks.push({ index: match.index, end: consumed, body: raw.slice(start, cursor) });
    }
    if (!blocks.length) return { state, accepted: false, visibleText: raw, changes: [] };
    if (blocks.length !== 1) throw new Error('每条回复只允许一项框架事务');
    const block = blocks[0];
    if (block.body.length > 180000) throw new Error('框架事务过长');
    let transaction; try { transaction = JSON.parse(block.body); } catch { throw new Error('框架事务不是有效 JSON'); }
    const result = applyFrameworkTransaction(state, transaction, options);
    return { ...result, accepted: true, transaction, visibleText: (raw.slice(0, block.index) + raw.slice(block.end)).trimEnd() };
}
