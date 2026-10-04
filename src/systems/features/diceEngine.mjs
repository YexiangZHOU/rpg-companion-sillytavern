/** No model-supplied results, eval, or non-cryptographic randomness. */
export function validateRoll(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('检定参数必须是对象');
    const allowed = ['id','actor','actorType','reason','count','sides','modifier','advantage','dc'];
    if (Object.keys(input).some(k => !allowed.includes(k))) throw Error('检定包含不支持的参数（不能指定骰点）');
    const integer = (v,min,max,label) => {
        if (!Number.isInteger(v) || v < min || v > max) throw Error(`${label}超出允许范围`);
        return v;
    };
    const count = integer(input.count ?? 1,1,20,'骰子数量');
    const sides = integer(input.sides ?? 20,2,1000,'骰子面数');
    const modifier = integer(input.modifier ?? 0,-1000,1000,'调整值');
    const advantage = input.advantage ?? 'normal';
    if (!['normal','advantage','disadvantage'].includes(advantage)) throw Error('优势模式无效');
    if (advantage !== 'normal' && (count !== 1 || sides !== 20)) throw Error('优势/劣势仅适用于1d20');
    const dc = input.dc == null ? null : integer(input.dc,0,2000,'难度');
    const text = (v,max,label) => {
        if (typeof v !== 'string' || !v.trim() || v.length > max) throw Error(`${label}无效或过长`);
        return v.trim();
    };
    const id = text(input.id,64,'请求编号');
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw Error('请求编号仅允许字母、数字、下划线和横线');
    const actorType = input.actorType ?? 'unknown';
    if (!['player','npc','unknown'].includes(actorType)) throw Error('行动主体类型无效');
    return {id,actor:text(input.actor,120,'主体'),actorType,reason:text(input.reason,500,'原因'),count,sides,modifier,advantage,dc};
}
export function formula(r) {
    return `${r.count}d${r.sides}${r.modifier > 0 ? '+' : ''}${r.modifier || ''}${r.advantage === 'normal' ? '' : r.advantage === 'advantage' ? '（优势）' : '（劣势）'}`;
}
export function uniformFace(sides, nextWord = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
    const bound = Math.floor(0x100000000 / sides) * sides;
    for (let tries=0; tries<1024; tries++) {
        const word = nextWord();
        if (!Number.isInteger(word) || word < 0 || word > 0xffffffff) throw Error('随机数源无效');
        if (word < bound) return word % sides + 1;
    }
    throw Error('随机数源未能提供有效取样');
}
export function calculateRoll(request, raw) {
    const r = validateRoll(request), expected = r.advantage === 'normal' ? r.count : 2;
    if (!Array.isArray(raw) || raw.length !== expected || raw.some(n => !Number.isInteger(n) || n < 1 || n > r.sides)) throw Error(`需要${expected}枚1至${r.sides}的原始骰点`);
    const kept = r.advantage === 'normal' ? [...raw] : [r.advantage === 'advantage' ? Math.max(...raw) : Math.min(...raw)];
    const rawTotal = kept.reduce((a,b)=>a+b,0);
    return { formula:formula(r),rolls:[...raw],kept,rawTotal,modifier:r.modifier,total:rawTotal+r.modifier };
}
export function performRoll(request, nextWord) {
    const r = validateRoll(request), count = r.advantage === 'normal' ? r.count : 2;
    return { ...calculateRoll(r,Array.from({length:count},()=>uniformFace(r.sides,nextWord))),source:'program',timestamp:Date.now() };
}
export function resultText(request,result) {
    return `${request.actor}：${request.reason}；${result.formula}；原始骰点 ${result.rolls.join(', ')}${request.advantage === 'normal' ? '' : `，保留 ${result.kept.join(', ')}`}；调整值 ${result.modifier>=0?'+':''}${result.modifier}；总计 ${result.total}${request.dc == null ? '' : `；DC ${request.dc}`}（${result.source === 'external' ? '玩家外部提供' : '程序投掷'}）`;
}
export function protocolVisibleText(text) {
    // Keep exact offsets, including incomplete code/thought blocks while streaming.
    return String(text).replace(/(```|~~~)[\s\S]*?\1|(```|~~~)[\s\S]*$|<(think|thinking)>[\s\S]*?(?:<\/\3>|$)|`[^`\n]*`/gi,m=>' '.repeat(m.length));
}
export function scanRollRequests(text) {
    const raw=String(text), visible=protocolVisibleText(raw), entries=[];
    for(const m of visible.matchAll(/<rpg-roll>\s*([\s\S]*?)\s*<\/rpg-roll>/g))
        entries.push({start:m.index,end:m.index+m[0].length,json:m[1],source:'tag'});
    // Only complete, standalone JSON objects at the end of the actual reply.
    // Scan braces without descending into nested tracker objects or JSON strings.
    const objects=[];let start=-1,depth=0,string=false,escape=false;
    for(let i=0;i<visible.length;i++) {
        const c=visible[i];
        if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue;}
        if(c==='"' && depth){string=true;continue;}
        if(c==='{'){if(!depth)start=i;depth++;}
        if(c==='}' && depth && --depth===0)objects.push({start,end:i+1});
    }
    let tail=raw.length;
    for(const span of objects.reverse()) {
        if(raw.slice(span.end,tail).trim())break;
        const lineStart=raw.lastIndexOf('\n',span.start-1)+1;
        if(raw.slice(lineStart,span.start).trim())break;
        const json=raw.slice(span.start,span.end);let parsed;
        try {parsed=JSON.parse(json);}catch{break;}
        if(!parsed?.id || !('actor' in parsed) || !('reason' in parsed))break;
        entries.push({...span,json,source:'bare'});tail=span.start;
    }
    entries.sort((a,b)=>a.start-b.start);
    const errors=[];
    for(const e of entries) {
        try {
            const input=JSON.parse(e.json);
            if(e.source==='bare' && ['id','actor','actorType','reason','count','sides','modifier','advantage','dc'].some(k=>!Object.hasOwn(input,k)))throw Error('裸检定缺少完整参数');
            e.request=validateRoll(input);
        } catch(error){errors.push(error.message);}
    }
    if(entries.length>4)errors.push('每条回复最多4个检定');
    const ids=entries.filter(e=>e.request).map(e=>e.request.id);
    if(new Set(ids).size!==ids.length)errors.push('同一回复检定编号重复');
    return {entries,errors};
}
export function parseRollBlocks(text) {
    const {entries,errors}=scanRollRequests(text);
    if(errors.length)throw Error(errors.join('；'));
    return entries.map(e=>e.request);
}
export function stripRollBlocks(text) {
    const {entries,errors}=scanRollRequests(text);
    if(errors.length)return String(text); // An invalid batch is neither executed nor hidden.
    let display=String(text);
    for(const e of entries.reverse())display=display.slice(0,e.start)+display.slice(e.end);
    return display.trimEnd();
}
export function shouldAuto(mode, request) { return mode === 'auto' || mode === 'mixed' && request.actorType === 'npc'; }
/** Synchronous commit precedes every async send: double clicks cannot re-roll. */
export function resolveRecord(record, external, nextWord) {
    if (record.status === 'resolved') return record.result;
    if (record.status !== 'pending') throw Error('检定已取消');
    record.result = external == null ? performRoll(record.request,nextWord) : { ...calculateRoll(record.request,external),source:'external',timestamp:Date.now() };
    record.status = 'resolved';
    return record.result;
}
