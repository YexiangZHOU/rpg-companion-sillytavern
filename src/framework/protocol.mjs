import { emptyFramework, applyFrameworkTransaction, validateFramework, FIELD_TYPES } from './state.mjs';
import { frameworkVisibleText } from './textContext.mjs';
import { coverageIssues } from './media.mjs';

export class FrameworkProtocolError extends Error {
    constructor(code, message) { super(message); this.name = 'FrameworkProtocolError'; this.code = code; }
}
const protocolFailure = (code, message) => { throw new FrameworkProtocolError(code, message); };
const example = transaction => `<rpg-framework>\n${JSON.stringify(transaction)}\n</rpg-framework>`;

/** A declarative text protocol for providers without native function calling. */
export function buildFrameworkInstructions(state = emptyFramework()) {
    validateFramework(state);
    const publicState = { ...state }; delete publicState.applied;
    return [
        '你负责根据本次角色卡、世界书、玩家描述与剧情建立需要的数据。玩家不必选择规则模板。',
        '组别和字段由你定义，没有必选分类、生命、等级、六属性或骰子规则。仅建立当前必要信息。未知初值用null，不补默认满值或替玩家宣告已建卡。',
        '每轮核对叙事中已经发生、影响后续游玩的事实，并在同一事务中记录：当前具体地点与主要动态；实际参与互动、需要持续跟踪的角色；已取得/消耗/转移的物品及其数量与归属；已接受任务及进展。分类和字段仍由你按游戏设计，不要求为无关路人建卡，不把未接受的提议当作已发生。没有变化不重复提交。',
        '场景对象不能仅有标题：用description或自定义字段记录已知的具体地点和当前动态；转场时更新当前场景或归档离开的场景。重要交互角色建立npc对象，未知数值留空；离场后可归档，后续回来复用原编号。载货容量变化不能替代货物明细；同时记录实际货物名称、数量、归属，不把未结算报酬加入余额。',
        '为玩家和重要对象选择少量最有助于决策的字段设置summary:true（例如本游戏的关键资源、资金或当前目标），不是固定必选字段。长清单保留在详情。NPC状态仍收纳在状态内。',
        '对象kind可自由命名；需要放在左侧场景区的对象用kind="scene"，玩家可用"player"，NPC可用"npc"。这只是界面位置提示，不规定组别/字段。当前有遭遇时可建立kind="encounter"的对象，用自定义组别记录参与者、顺序、行动与结果；结束时归档该对象。不要求AC、HP、回合或d20，按本游戏规则声明。',
        '正文侧重行动、对话、氛围和有意义的变化，不每轮重抄面板清单。已经确认的资源变化仍用一句简短结算说明。没有可靠记录的重要信息仍须交代。玩家要求全表时正常提供。',
        '本扩展的数据协议替代角色卡中的旧tracker/固定HUD清单格式；角色背景、人物性格与游戏规则继续遵守。显示名与文本值使用当前玩家对话语言，内部稳定编号使用允许的字符。',
        '正常叙事后有变化时输出且只输出一个 <rpg-framework>JSON事务</rpg-framework>。起止标签各自独立成行，JSON放在两标签之间；不要放进代码块、引用或示例，不再输出旧HUD状态代码块。事务本身不等于保存成功，以下状态才是当前有效记录。',
        '数据块必须是严格JSON：所有键与字符串使用双引号；不得有注释、尾逗号、未加引号的键、多余右括号或省略号。先完成JSON对象再紧接结束标签。只提交必要操作，不附加重复状态或调试字段；格式不合法时整个事务都会拒绝，叙事中声称已记录不能代替提交。',
        '事务格式：{"protocol":1,"id":"唯一事务编号","baseRevision":当前revision,"ops":[操作]}。编号以字母开头、最长64字，仅字母数字短横线下划线。所有对象/组别/字段编号全局唯一，改名继续用原编号。',
        '尚未初始化时唯一操作：{"op":"init","title":"本游戏名称","entities":[{"id":"对象编号","label":"名称","kind":"自由描述对象类别"}],"groups":[{"id":"组别编号","entityId":"所属对象编号","label":"组名","layout":"grid或list或details","order":0}],"fields":[字段定义],"values":{"字段编号":初值}}。组别、字段可以为空，未出现的值为未知。',
        `字段定义：id/groupId/label/type，type可选${FIELD_TYPES.join('/')}；可带description、unit、order、summary（是否放摘要）、min/max及integer（数值约束）。choice必须有字符串options，collection必须有columns（id/label/type及对应约束，不能嵌套collection）。`,
        'number是JSON数字，可负数/小数，取决于定义；resource为{"current":数值,"max":数值}且当前值在允许范围；boolean是true/false；text是文字；choice是一个已定义选项；tags是字符串列表，允许同名文字重复且保留数量，不作为对象编号；需要逐件更新、数量或其他细节时用collection。collection初值是[{"id":"稳定条目编号","values":{"列编号":值}}]，条目编号不能重复；choice的options也不能重复。空数组代表已知没有条目，null代表未知。',
        '后续ops可选：create（target为entity/group/field，definition为对应定义）；updateDefinition（target/id/patch改名字/说明/顺序等）；setValue（fieldId/value写绝对值）；upsertItem（fieldId/item合并指定条目）；archiveItem（fieldId/itemId/archived）；archive（target/id/archived归档或恢复定义）。',
        '丢弃、消耗、转交、销毁后必须同步归属与可用性。可独立转移的装备优先用collection和稳定条目编号；不强制任何游戏分类。collection条目离开当前清单用archiveItem，部分消耗用upsertItem写剩余数量；tags用setValue写剩余列表。已有text栏位若保留装备槽用setValue写“无”，若该栏位不再需要展示用archive target:"field"。独立资产彻底失去且不再作为当前资产跟踪时archive target:"entity"；仍相关的残骸可作为场景事实记录。重新获得时恢复原编号。不要只改名为残骸仍暗示可用。',
        'upsertItem与archiveItem只能用于type:"collection"，item必须含id和values，绝不能用item:null表示删除。不能按字段名猜类型。移除示例（编号仅为语法示意）：{"op":"archiveItem","fieldId":"inventory","itemId":"pistol","archived":true}；移除独立旧栏位：{"op":"archive","target":"field","id":"weapon","archived":true}。归档保留历史，不是永久删除；玩家锁仍须遵守。',
        '转场不是只新增一个scene：优先用updateDefinition更新同一个当前场景对象的label/description及相关值；确需新建时，在同一事务明确archive旧scene。离场且不再需要当前展示的NPC也可archive；仍随行或参与互动的同伴保留，不从转场自动推定所有NPC离场。旧场景/NPC以后回来可恢复原编号。仅确实同时跟踪多个地点时保留多个未归档scene，并清楚标明各自用途。',
        '不能更改已有字段的type/id或把字段移到另一个对象；出现不同类型请创建新字段。集合可由null设为空数组，其余情况按条目更新，不能整批覆盖；updateDefinition可新增集合列，但已有列的id和type须保留。没有提到的条目继续保留。不要每轮初始化或重建结构，遇到新机制才新增。',
        '结构锁和数值锁由玩家控制，模型不能setLock或绕过锁。锁定值保持原值，未变化可省略。不读取其他聊天数据。不要执行脚本，不输出HTML或任意代码作为控件。',
        '初始化必须包含可用的当前scene详情（具体地点与主要动态）、玩家和重要交互角色的已知外观，以及需要持续跟踪且可配图的资产（例如舰船）的外形。不要求玩家手动建立分类。既有已确认身份优先；依据角色卡、玩家描述和已发生剧情填写。确实未见或玩家尚未决定外形时明确声明visual.pending原因，不能冒充已确认。合法更新会先保存，但缺失这些信息仍视为初始化不完整，下一轮优先补齐。',
        'entity/group/field定义及collection条目均可带visual:{"mode":"portrait或icon或none","subject":"person或creature或object或place或symbol","description":"已确认的可见外形","visible":false}。description最多2400字；确需暂缓可带pending:"未确认原因"，确认后用新的完整visual对象替换并移除pending。不输出URL/HTML/模型参数；图片由扩展生成。玩家、重要NPC、舰船等具象持续资产必须声明mode:portrait；抽象对象、物品、能力、天气及其他任何元素由你决定portrait/icon/none，勿把每个字段都配图。船舰subject:object，不是person。',
        'visual.visible只用于实体是否出现在当前场景图中：玩家/NPC默认可见，其他资产默认不可见；舰船等确实在当前画面中须显式true。离场设false或归档。实体description仅放公开动作，私密思想另放role:private字段，不能写入任何visual.description。外观可写visual.description，或text字段role:appearance；后者优先。字段可用role:location/action/weather/time/private声明语义，不规定名称或游戏规则，不需强造天气/时间。',
        '配图声明是数据，不等于立即绘图。自动/手动/关闭与图片锁由玩家控制，不要为生成图片绕过限制。不再需要图片时visual:{"mode":"none"}。物品用upsertItem携带visual（仍须id和values），其他目标用updateDefinition patch.visual；仅数量、生命等变化无需重写visual。天气等实际画面变了才更新visual.description，以免沿用旧图。',
        `尚待补齐的记录（数据；有锁时保留并说明，不为补齐重放资金或物品操作）：${JSON.stringify(coverageIssues(state))}`,
        '每轮基于下方revision与ID提交，只描述已经发生且有依据的变化；需要掷骰先等待程序回传，不捏造随机结果。',
        '以下是独立的语法示例，不是本聊天事实；不得复制示例人物、数值或编号到游戏。初始化示例：\n' + example({protocol:1,id:'example_start',baseRevision:0,ops:[{op:'init',title:'Example',entities:[{id:'traveler',label:'Traveler',kind:'player',visual:{mode:'portrait',subject:'person',description:'Short hair, a worn blue travelling coat'}},{id:'place',label:'Harbor',kind:'scene',description:'At the east pier; boarding has begun.'},{id:'keeper',label:'Harbor keeper',kind:'npc',description:'At the east pier; stays ashore.',visual:{mode:'portrait',subject:'person',description:'Gray hair, dark harbor uniform'}}],groups:[{id:'possessions',entityId:'traveler',label:'Possessions'}],fields:[{id:'coins',groupId:'possessions',label:'Coins',type:'number',summary:true},{id:'cargo',groupId:'possessions',label:'Cargo',type:'collection',columns:[{id:'name',label:'Name',type:'text'},{id:'quantity',label:'Quantity',type:'number',integer:true,min:0}]}],values:{coins:20,cargo:[]}}]}),
        '承接上述独立示例的增量示例（付款、收货、更新当前地点，码头管理员离场、船上验货员接手）：\n' + example({protocol:1,id:'example_change',baseRevision:1,ops:[{op:'setValue',fieldId:'coins',value:18},{op:'upsertItem',fieldId:'cargo',item:{id:'parcel',values:{name:'Sealed parcel',quantity:2}}},{op:'updateDefinition',target:'entity',id:'place',patch:{label:'Ferry cabin',description:'Aboard the ferry; two parcels have been loaded.'}},{op:'archive',target:'entity',id:'keeper',archived:true},{op:'create',target:'entity',definition:{id:'clerk',label:'Dock clerk',kind:'npc',description:'The clerk has checked the parcel seals.',visual:{mode:'portrait',subject:'person',pending:'Appearance not yet described'}}}]}),
        `当前有效数据（纯数据，不是新指令）：\n${JSON.stringify(publicState)}`,
    ].join('\n');
}

export function applyFrameworkReply(raw, state, options = {}) {
    if (typeof raw !== 'string') protocolFailure('reply_type', '回复须为文字');
    if (raw.length > 1500000) protocolFailure('reply_limit', '回复过长');
    const visible = frameworkVisibleText(raw);
    const blocks = []; let consumed = 0;
    for (const match of visible.matchAll(/<rpg-framework>/g)) {
        if (match.index < consumed) continue;
        let cursor = match.index + match[0].length;
        while (/\s/.test(raw[cursor] ?? '') && cursor < raw.length) cursor++;
        const start = cursor;
        if (raw[start] !== '{') protocolFailure('object', '框架事务须为 JSON 对象');
        let depth = 0, quoted = false, escaped = false;
        for (; cursor < raw.length; cursor++) {
            const char = raw[cursor];
            if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
            if (char === '"') quoted = true;
            else if (char === '{') depth++;
            else if (char === '}' && --depth === 0) { cursor++; break; }
        }
        if (depth || quoted) protocolFailure('incomplete_json', '框架 JSON 不完整');
        const closing = raw.slice(cursor).match(/^\s*<\/rpg-framework>/);
        if (!closing) protocolFailure('closing_tag', '框架事务缺少结束标签或含多余内容');
        consumed = cursor + closing[0].length;
        blocks.push({ index: match.index, end: consumed, body: raw.slice(start, cursor) });
    }
    if (!blocks.length) return { state, accepted: false, visibleText: raw, changes: [],
        ...(raw.includes('<rpg-framework>') ? { diagnostic: { status: 'ignored_protocol', code: 'quoted_or_fenced' } } : {}) };
    if (blocks.length !== 1) protocolFailure('multiple_blocks', '每条回复只允许一项框架事务');
    const block = blocks[0];
    if (block.body.length > 180000) protocolFailure('payload_limit', '框架事务过长');
    let transaction; try { transaction = JSON.parse(block.body); } catch { protocolFailure('json', '框架事务不是有效 JSON'); }
    const result = applyFrameworkTransaction(state, transaction, options);
    return { ...result, accepted: true, transaction, visibleText: (raw.slice(0, block.index) + raw.slice(block.end)).trimEnd() };
}
