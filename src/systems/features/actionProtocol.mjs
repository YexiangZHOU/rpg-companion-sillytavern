import { protocolVisibleText } from './diceEngine.mjs';
const object=x=>x && typeof x==='object' && !Array.isArray(x);
const clone=x=>JSON.parse(JSON.stringify(x));
function keys(x,allowed) {if(!object(x)||Object.keys(x).some(k=>!allowed.includes(k)))throw Error('协议字段无效');}
function text(x,max=500) {if(typeof x!=='string'||!x.trim()||x.length>max)throw Error('协议文字为空或过长');return x.trim();}
function id(x) {x=text(x,64);if(!/^[a-zA-Z0-9_-]+$/.test(x)||['__proto__','prototype','constructor'].includes(x))throw Error('编号无效');return x;}
function integer(x,min,max) {if(!Number.isInteger(x)||x<min||x>max)throw Error('战斗数值超出范围');return x;}
export function validateResources(x) {
    keys(x,['hp','ac','spellSlots','concentration','conditions']);const out={};
    if('hp' in x) {if(x.hp===null)out.hp=null;else {keys(x.hp,['current','max']);const max=integer(x.hp.max,1,100000);out.hp={current:integer(x.hp.current,0,max),max};}}
    if('ac' in x)out.ac=x.ac===null?null:integer(x.ac,0,100);
    if('spellSlots' in x) {keys(x.spellSlots,['1','2','3','4','5','6','7','8','9']);out.spellSlots={};for(const [k,v] of Object.entries(x.spellSlots)){keys(v,['current','max']);const max=integer(v.max,0,100);out.spellSlots[k]={current:integer(v.current,0,max),max};}}
    if('concentration' in x)out.concentration=x.concentration===null?null:text(x.concentration,120);
    if('conditions' in x) {if(!Array.isArray(x.conditions)||x.conditions.length>12)throw Error('异常状态列表无效');out.conditions=x.conditions.map(v=>text(v,80));}
    return out;
}
export function validatePlayer(x) {
    keys(x,['id','name','appearance','confirmed','resources']);
    if(x.confirmed!==true)throw Error('玩家身份/外观尚未确认');
    return {id:id(x.id),name:text(x.name,120),appearance:text(x.appearance,1600),confirmed:true,...('resources' in x?{resources:validateResources(x.resources)}:{})};
}
export function validateEncounter(x) {
    keys(x,['id','op','reason','participants','round','turn','rolls','result','summary','initiative','playerActions']);
    const out={id:id(x.id),op:x.op};
    if(!['begin','update','end'].includes(x.op))throw Error('遭遇操作无效');
    if(x.op==='begin')out.reason=text(x.reason);
    else if('reason' in x)throw Error('更新/结束不能重写遭遇起因');
    if('participants' in x) {
        if(!Array.isArray(x.participants)||!x.participants.length||x.participants.length>20)throw Error('参战者数量无效');
        out.participants=x.participants.map(p=>{
            keys(p,['id','name','actorType','side','resources']);
            const out={id:id(p.id),resources:validateResources(p.resources??{})};
            if(x.op==='begin'||'name' in p)out.name=text(p.name,120);
            if(x.op==='begin'||'actorType' in p){if(!['player','npc'].includes(p.actorType))throw Error('参战者类型无效');out.actorType=p.actorType;}
            if(x.op==='begin'||'side' in p){if(!['ally','enemy','neutral'].includes(p.side))throw Error('参战者阵营无效');out.side=p.side;}
            return out;
        });
        const names=out.participants.filter(p=>p.name).map(p=>p.name);
        if(new Set(out.participants.map(p=>p.id)).size!==out.participants.length || new Set(names).size!==names.length || out.participants.filter(p=>p.actorType==='player').length>1)throw Error('参战者编号/姓名重复或多个玩家');
    }
    if('initiative' in x){
        if(x.op==='begin'||!Array.isArray(x.initiative)||x.initiative.length>20)throw Error('先攻仅可回显现有程序结果');
        out.initiative=x.initiative.map(p=>{keys(p,['id','total']);return {id:id(p.id),total:integer(p.total,-100,1000)};});
        if(new Set(out.initiative.map(p=>p.id)).size!==out.initiative.length)throw Error('先攻回显重复');
    }
    if('playerActions' in x){keys(x.playerActions,['attacks','items']);out.playerActions={};
        if(x.playerActions.attacks){if(!Array.isArray(x.playerActions.attacks)||x.playerActions.attacks.length>20)throw Error('行动列表无效');out.playerActions.attacks=x.playerActions.attacks.map(a=>{keys(a,['name','type']);if(!['single-target','AoE','both'].includes(a.type))throw Error('攻击类型无效');return {name:text(a.name,120),type:a.type};});}
        if(x.playerActions.items){if(!Array.isArray(x.playerActions.items)||x.playerActions.items.length>20)throw Error('物品列表无效');out.playerActions.items=x.playerActions.items.map(a=>text(a,120));}
    }
    if(x.op==='begin'&&!out.participants)throw Error('开始遭遇需要参战者');
    if('round' in x)out.round=integer(x.round,1,10000);
    if('turn' in x)out.turn=x.turn===null?null:id(x.turn);
    if('rolls' in x) {
        if(!Array.isArray(x.rolls)||x.rolls.length>4)throw Error('遭遇检定数量无效');
        out.rolls=x.rolls.map(r=>{keys(r,['participantId','requestId','kind']);if(!['initiative','attack','damage','save','check'].includes(r.kind))throw Error('检定用途无效');return {participantId:id(r.participantId),requestId:id(r.requestId),kind:r.kind};});
        if(new Set(out.rolls.map(r=>r.requestId)).size!==out.rolls.length)throw Error('重复遭遇检定编号');
    }
    if(x.op==='end') {if(!['victory','defeat','fled','resolved'].includes(x.result))throw Error('遭遇结果无效');out.result=x.result;out.summary=text(x.summary,1500);}
    else if('result' in x||'summary' in x)throw Error('进行中遭遇不能提前宣告结束');
    return out;
}
export function scanActionBlocks(raw,{encounterId=null}={}) {
    const visible=protocolVisibleText(raw).replace(/^\s*>[^\n]*/gm,m=>' '.repeat(m.length)),entries=[];
    for(const m of visible.matchAll(/<rpg-(player|encounter)>\s*([\s\S]*?)\s*<\/rpg-\1>/g)) {
        const value=JSON.parse(m[2]);entries.push({type:m[1],value:m[1]==='player'?validatePlayer(value):validateEncounter(value),start:m.index,end:m.index+m[0].length});
    }
    // A model may omit an end/update wrapper, even directly after narration.
    // Recover only a final top-level object bound to an already active encounter.
    // Mask registered wrappers so their inner objects cannot become bare entries.
    if(encounterId) {
        const chars=visible.split('');
        for(const m of visible.matchAll(/<rpg-(player|encounter|roll)>[\s\S]*?<\/rpg-\1>/g))for(let i=m.index;i<m.index+m[0].length;i++)chars[i]=' ';
        const plain=chars.join('');let depth=0,start=-1,quoted=false,escape=false;const spans=[];
        for(let i=0;i<plain.length;i++) {
            const c=plain[i];
            if(depth && quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue;}
            if(depth && c==='"'){quoted=true;continue;}
            if(c==='{'){if(depth++===0)start=i;}
            else if(c==='}' && depth && --depth===0)spans.push({start,end:i+1});
        }
        const span=spans.at(-1);
        if(span && !String(raw).slice(span.end).trim()) {
            // An unmatched protocol tag is an invalid wrapper, not bare JSON.
            const prefix=plain.slice(0,span.start);
            if(!/<\/?rpg-(?:player|encounter|roll)\b/.test(prefix)) {
                let candidate;try{candidate=JSON.parse(String(raw).slice(span.start,span.end));}catch{}
                if(object(candidate) && candidate.id===encounterId && ['update','end'].includes(candidate.op)) {
                    // Encounter validation rejects unknown keys, bounds and result injection.
                    entries.push({type:'encounter',value:validateEncounter(candidate),...span,source:'bare'});
                }
            }
        }
    }
    if(entries.filter(e=>e.type==='player').length>1||entries.filter(e=>e.type==='encounter').length>1)throw Error('每轮最多一项玩家与一项遭遇更新');
    return entries;
}
export function hideActionBlocks(raw,entries) {let out=String(raw);for(const e of [...entries].sort((a,b)=>b.start-a.start))out=out.slice(0,e.start)+out.slice(e.end);return out.trimEnd();}
export const emptyActions=()=>({player:null,resources:{},encounter:null});
/** One transaction: any invalid/locked update leaves the entire previous state. */
export function reduceActions(previous,entries,records,{encounterMode='manual',locks={}}={}) {
    const next=clone(previous??emptyActions());
    const merge=(pid,incoming)=>{
        const old=next.resources[pid]??{};
        for(const k of Object.keys(incoming)) {
            if(locks[pid]===true||locks[pid]?.[k]===true) {
                if(JSON.stringify(old[k])!==JSON.stringify(incoming[k]))throw Error('战斗资源已锁定，未结算');
            }
            // Unknown is not a command to erase known resources.
            if(incoming[k]!==null)old[k]=k==='spellSlots'?{...old[k],...incoming[k]}:clone(incoming[k]);
        }
        next.resources[pid]=old;
    };
    const prior=next.encounter;
    const settling=entries.some(e=>e.type==='encounter' && e.value.op!=='begin');
    if(settling && prior?.pending?.some(p=>{const r=records.find(r=>r.key===p.key);return !r||r.status!=='resolved'||!r.delivered;}))throw Error('检定尚未全部回传，不能结算或结束');
    for(const e of entries) {
        if(e.type==='player') {
            if(prior&&!['ended','proposed'].includes(prior.phase) && next.player && next.player.id!==e.value.id)throw Error('活动遭遇中不能更换玩家');
            if(prior&&prior.phase!=='ended'&&next.player&&next.player.name!==e.value.name)throw Error('活动遭遇中不能更换玩家姓名');
            if(prior?.pending?.some(p=>{const r=records.find(r=>r.key===p.key);return !r||r.status!=='resolved'||!r.delivered;})&&e.value.resources)throw Error('检定等待中不能先更新玩家资源');
            next.player={id:e.value.id,name:e.value.name,appearance:e.value.appearance,confirmed:true};
            if(e.value.resources)merge(e.value.id,e.value.resources);
            continue;
        }
        const x=e.value;
        if(x.op==='begin') {
            if(prior && prior.id===x.id)throw Error('同一遭遇已存在，不能重新开始');
            if(prior && prior.phase!=='ended')throw Error('已有未结束遭遇');
            if(encounterMode==='manual')throw Error('当前模式仅手动启动遭遇');
            next.encounter={id:x.id,reason:x.reason,participants:x.participants.map(({resources,...p})=>p),phase:encounterMode==='auto'?'active':'proposed',round:1,turn:null,pending:[],initiative:[],result:null,summary:null};
        } else if(!prior||prior.id!==x.id||['ended','proposed'].includes(prior.phase))throw Error('没有对应的活动遭遇');
        const battle=next.encounter;
        for(const p of x.participants??[]) {
            const member=battle.participants.find(m=>m.id===p.id);
            if(!member||['name','actorType','side'].some(k=>k in p&&member[k]!==p[k]))throw Error('结算不能更换参战者身份');
            if(member.actorType==='player') {
                if(!next.player||next.player.id!==p.id||next.player.name!==member.name) {
                    if(Object.keys(p.resources).length)throw Error('玩家资源需先建立已确认人物记录');
                } else if(x.op==='begin') {
                    // Beginning an encounter cannot invent/overwrite player resources.
                    for(const [k,v] of Object.entries(p.resources))if(v!==null&&JSON.stringify(next.resources[p.id]?.[k])!==JSON.stringify(v))throw Error('初始玩家资源与已确认人物不一致');
                } else merge(p.id,p.resources);
            } else merge(p.id,p.resources);
        }
        if(x.initiative && x.initiative.some(p=>!battle.initiative.some(i=>i.id===p.id&&i.total===p.total)))throw Error('先攻回显与程序结果不符');
        if(x.playerActions)battle.playerActions={...battle.playerActions,...x.playerActions};
        if(x.round!==undefined){if(x.round<battle.round||x.round>battle.round+1)throw Error('轮次必须顺序推进');battle.round=x.round;}
        if('turn' in x){if(x.turn!==null&&!battle.participants.some(p=>p.id===x.turn))throw Error('当前行动者不在遭遇中');battle.turn=x.turn;}
        const bound=(x.rolls??[]).map(ref=>{
            const participant=battle.participants.find(p=>p.id===ref.participantId);
            const matching=records.filter(r=>r.request.id===ref.requestId && r.fresh===true);
            if(!participant||matching.length!==1)throw Error('遭遇检定未对应本轮有效骰子请求');
            const record=matching[0];
            if(record.request.actor!==participant.name||record.request.actorType!==participant.actorType)throw Error('检定主体与参战者不一致');
            if(ref.kind==='initiative'&&(record.request.count!==1||record.request.sides!==20||record.request.dc!==null))throw Error('先攻需要1d20且无DC');
            return {...ref,key:record.key};
        });
        if(x.op==='end') {if(bound.length)throw Error('结束时不能发起新检定');battle.phase='ended';battle.result=x.result;battle.summary=x.summary;battle.pending=[];}
        else {
            if(bound.some(r=>r.kind==='initiative') && bound.some(r=>r.kind!=='initiative'))throw Error('先攻不能混合其他行动结算');
            battle.pending=bound;
            if(battle.phase!=='proposed')battle.phase=bound.length?(bound.some(r=>r.kind==='initiative')?'awaiting_initiative':'awaiting_roll'):'active';
        }
    }
    return next;
}
export function reconcileEncounter(state,records,dexterity={}) {
    const battle=state.encounter;if(!battle||!['awaiting_initiative','awaiting_roll'].includes(battle.phase)||!battle.pending?.length)return false;
    if(battle.pending.some(p=>records.find(r=>r.key===p.key)?.status!=='resolved'))return false;
    if(battle.phase==='awaiting_initiative') {
        const scores=battle.pending.map(p=>({id:p.participantId,total:records.find(r=>r.key===p.key).result.total,dexterity:dexterity[p.participantId]??0}));
        battle.initiative=[...battle.initiative.filter(p=>!scores.some(s=>s.id===p.id)),...scores].sort((a,b)=>b.total-a.total||b.dexterity-a.dexterity||a.id.localeCompare(b.id));
        battle.turn=battle.initiative.length===battle.participants.length?(battle.initiative[0]?.id??null):null;
    }
    // Keep references until a model settlement; delivered flags gate that transaction.
    battle.phase='awaiting_settlement';return true;
}
/** Conditions share the existing tracker display; absolute HP remains separate. */
export function projectConditions(state,userRaw,npcRaw,conditionName='Conditions') {
    const parse=raw=>{try{return typeof raw==='string'?JSON.parse(raw):clone(raw);}catch{return null;}};
    const user=parse(userRaw),npc=parse(npcRaw),conditions=state.player?state.resources[state.player.id]?.conditions:undefined;
    let userConditions;
    if(conditions) {
        userConditions=conditions.join('、')||'None';
        if(object(user)){user.status??={};user.status.conditions=userConditions;}
    }
    const chars=Array.isArray(npc)?npc:npc?.characters;
    if(Array.isArray(chars))for(const participant of state.encounter?.participants??[]) {
        if(participant.actorType==='player')continue;
        const conditions=state.resources[participant.id]?.conditions,character=chars.find(c=>c.name===participant.name);
        if(!conditions||!character)continue;
        character.details??={};const value=conditions.join('、')||'None';
        character.details[conditionName]=value;
        const snake=conditionName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'_').replace(/^_+|_+$/g,'');
        character.details[snake]=value;
    }
    return {userConditions,userRaw:object(user)?JSON.stringify(user):userRaw,npcRaw:(object(npc)||Array.isArray(npc))?JSON.stringify(npc):npcRaw};
}
