/** Synthetic model replies for a preview. These are not built-in game presets. */
const field = (id, groupId, label, type, extras = {}) => ({ id, groupId, label, type, ...extras });
const entity = (id, label, kind) => ({ id, label, kind });
const group = (id, entityId, label, layout = 'grid', order = 0) => ({ id, entityId, label, layout, order });
const number = (id, label, extras = {}) => ({ id, label, type: 'number', ...extras });
const text = (id, label) => ({ id, label, type: 'text' });
const item = (id, values) => ({ id, values });

export const PREVIEW_CASES = [
    {
        id: 'cultivation', label: '修仙样例', note: '修为、功法、法宝与宗门关系；分类来自样例中的模型定义。',
        narration: '雨后的山门笼在薄雾中。你收起玉简，察觉丹田中的灵力还未完全恢复。执事递来一枚木牌，邀你参加明日的试炼。',
        title: '青岚山的初秋',
        entities: [entity('traveler', '沈砚', '修行者')],
        groups: [group('cultivation', 'traveler', '修为'), group('arts', 'traveler', '功法', 'list', 1), group('treasures', 'traveler', '法宝', 'list', 2), group('relations', 'traveler', '宗门关系', 'details', 3)],
        fields: [field('realm', 'cultivation', '境界', 'choice', { options: ['炼气初期', '炼气中期', '炼气后期'], summary: true }), field('spirit', 'cultivation', '灵力', 'resource', { integer: true, min: 0, unit: '点', summary: true }), field('awareness', 'cultivation', '神识', 'number', { min: 0, order: 1 }), field('omens', 'cultivation', '气机', 'tags', { order: 2 }), field('learned', 'arts', '已习功法', 'collection', { columns: [text('name', '功法'), text('stage', '层次'), number('mastery', '熟练度', { min: 0, max: 100 })] }), field('carried', 'treasures', '随身法宝', 'collection', { columns: [text('name', '名称'), text('quality', '品阶'), text('effect', '效果')] }), field('sect', 'relations', '所属宗门', 'text'), field('contribution', 'relations', '宗门贡献', 'number', { min: 0 }), field('reputation', 'relations', '长老印象', 'text')],
        values: { realm: '炼气中期', spirit: { current: 38, max: 60 }, awareness: 12.5, omens: ['灵力未复', '气息平稳'], learned: [item('mist_art', { name: '引雾诀', stage: '第二层', mastery: 42 })], carried: [item('jade', { name: '温玉佩', quality: '凡阶', effect: '静心养神' })], sect: '青岚宗', contribution: 0, reputation: null },
        updates: [{ label: '模型更新：完成一次调息', ops: [{ op: 'setValue', fieldId: 'spirit', value: { current: 49, max: 60 } }, { op: 'setValue', fieldId: 'omens', value: ['气息平稳'] }] }, { label: '模型新增：试炼安排', ops: [{ op: 'create', target: 'group', definition: group('trial', 'traveler', '试炼', 'details', 4) }, { op: 'create', target: 'field', definition: field('trial_goal', 'trial', '当前安排', 'text') }, { op: 'setValue', fieldId: 'trial_goal', value: '明日辰时，在北峰集合。' }] }],
    },
    {
        id: 'space', label: '太空样例', note: '多个对象独立拥有数据，飞船资源无需借用人物生命。',
        narration: '警报在舱壁间回荡。你把最后一个接口插入控制台，“候鸟”号重新接上动力。导航灯亮起，窗外的碎石正从船身两侧掠过。',
        title: '航道外的候鸟',
        entities: [entity('pilot', '黎遥', '领航员'), entity('ship', '候鸟号', '轻型运输船')],
        groups: [group('body', 'pilot', '身体状况'), group('implants', 'pilot', '植入体', 'details', 1), group('contracts', 'pilot', '合约', 'list', 2), group('systems', 'ship', '舰载系统'), group('cargo', 'ship', '货舱', 'list', 1)],
        fields: [field('oxygen', 'body', '供氧储量', 'resource', { unit: '分钟', summary: true }), field('neural', 'body', '神经负荷', 'number', { min: 0, max: 100 }), field('chip', 'implants', '导航接口', 'text'), field('contract_items', 'contracts', '有效合约', 'collection', { columns: [text('name', '合约'), text('goal', '条件'), number('reward', '报酬')] }), field('shield', 'systems', '护盾', 'resource', { summary: true }), field('fuel', 'systems', '燃料', 'resource', { unit: '吨', summary: true }), field('hull', 'systems', '船体状况', 'tags'), field('cargo_items', 'cargo', '货物', 'collection', { columns: [text('name', '货物'), number('quantity', '数量', { min: 0 }), text('destination', '目的地')] })],
        values: { oxygen: { current: 82, max: 120 }, neural: 26, chip: '标准型接口，正在运行', contract_items: [item('medicine', { name: '医药急送', goal: '抵达木卫二补给站', reward: 1800 })], shield: { current: 47, max: 90 }, fuel: { current: 6.25, max: 10 }, hull: ['左侧外壳擦伤'], cargo_items: [item('box', { name: '密封医药箱', quantity: 12, destination: '木卫二' })] },
        updates: [{ label: '模型更新：护盾吸收碰撞', ops: [{ op: 'setValue', fieldId: 'shield', value: { current: 31, max: 90 } }, { op: 'setValue', fieldId: 'fuel', value: { current: 5.9, max: 10 } }] }, { label: '模型新增：航道信息', ops: [{ op: 'create', target: 'group', definition: group('navigation', 'ship', '航道', 'details', 2) }, { op: 'create', target: 'field', definition: field('route', 'navigation', '下一站', 'text') }, { op: 'setValue', fieldId: 'route', value: '先经过静默区，再向补给站转向。' }] }],
    },
    {
        id: 'shop', label: '经营样例', note: '资金可为负数，库存按条目更新，没有等级或战斗属性。',
        narration: '午后的客人渐渐散去。你核对柜台上的账单，发现今天卖出了不少茶叶。店员把新订单递过来：镇上的旅馆需要一批夜间点心。',
        title: '街角的茶铺', entities: [entity('store', '春日茶铺', '店铺')],
        groups: [group('business', 'store', '经营'), group('stock', 'store', '仓库', 'list', 1), group('staff', 'store', '员工', 'list', 2), group('orders', 'store', '订单', 'list', 3)],
        fields: [field('funds', 'business', '账面资金', 'number', { unit: '金币', summary: true }), field('rating', 'business', '口碑', 'number', { min: 0, max: 5, summary: true }), field('open', 'business', '正在营业', 'boolean'), field('stock_items', 'stock', '库存', 'collection', { columns: [text('name', '商品'), number('quantity', '数量', { min: 0, integer: true }), number('price', '售价', { min: 0 })] }), field('staff_items', 'staff', '当班员工', 'collection', { columns: [text('name', '姓名'), text('role', '岗位'), { id: 'mood', label: '状态', type: 'tags' }] }), field('order_items', 'orders', '待交付', 'collection', { columns: [text('name', '订单'), text('deadline', '交付时间'), { id: 'progress', label: '进度', type: 'resource', min: 0, integer: true }] })],
        values: { funds: -12.5, rating: 4.2, open: true, stock_items: [item('tea', { name: '青叶茶', quantity: 18, price: 2.5 }), item('cakes', { name: '米糕', quantity: 0, price: 1 })], staff_items: [item('lin', { name: '小林', role: '柜台', mood: ['熟练', '有些疲倦'] })], order_items: [item('inn', { name: '旅馆点心', deadline: '明晚之前', progress: { current: 8, max: 24 } })] },
        updates: [{ label: '模型更新：售出两份茶叶', ops: [{ op: 'setValue', fieldId: 'funds', value: -7.5 }, { op: 'upsertItem', fieldId: 'stock_items', item: item('tea', { quantity: 16 }) }] }, { label: '模型新增：供应商', ops: [{ op: 'create', target: 'group', definition: group('suppliers', 'store', '供应商', 'details', 4) }, { op: 'create', target: 'field', definition: field('supplier', 'suppliers', '合作商', 'text') }, { op: 'setValue', fieldId: 'supplier', value: '河边粮行 · 每周三送货' }] }],
    },
    {
        id: 'story', label: '叙事样例', note: '只有文字与线索；框架不会额外补生命、等级或数值。',
        narration: '旧书店的门铃响了一声。柜台上留着一封没有署名的信，信封里夹着半张褪色的照片。店主说，寄信的人昨晚来过。',
        title: '未署名的来信', entities: [entity('visitor', '许知', '来访者')],
        groups: [group('clues', 'visitor', '线索', 'details'), group('relationships', 'visitor', '人物关系', 'details', 1)],
        fields: [field('letter', 'clues', '来信', 'text', { summary: true }), field('photo', 'clues', '照片', 'text'), field('owner', 'relationships', '书店主人', 'text')],
        values: { letter: '信封没有署名，邮戳模糊。', photo: null, owner: '愿意帮忙，但记不清来访者的面容。' },
        updates: [{ label: '模型更新：认出照片地点', ops: [{ op: 'setValue', fieldId: 'photo', value: '照片拍摄于旧码头，背景有一座已经拆除的钟楼。' }] }, { label: '模型新增：待核实事项', ops: [{ op: 'create', target: 'group', definition: group('leads', 'visitor', '待核实事项', 'list', 2) }, { op: 'create', target: 'field', definition: field('next_leads', 'leads', '调查方向', 'tags') }, { op: 'setValue', fieldId: 'next_leads', value: ['寻找码头旧照', '询问昨夜值班的人'] }] }],
    },
];

export function previewInitialization(game) {
    return { protocol: 1, id: `init_${game.id}`, baseRevision: 0, ops: [{ op: 'init', title: game.title, entities: game.entities, groups: game.groups, fields: game.fields, values: game.values }] };
}
