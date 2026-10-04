/** Model requests, native tools, chat-local persistence and real ST send flow. */
import { getContext } from '../../../../../../extensions.js';
import { ToolManager } from '../../../../../../tool-calling.js';
import { eventSource,event_types,saveChatDebounced,setExtensionPrompt,extension_prompt_types,extension_prompt_roles,is_send_press,messageFormatting } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { refreshBalancedLayout } from '../ui/balancedLayout.js';
import { renderThoughts } from '../rendering/thoughts.js';
import { evaluateSuppression } from '../generation/suppression.js';
import { currentDiceData,updateDiceDisplay } from './dice.js';
import { validateRoll,formula,parseRollBlocks,stripRollBlocks,shouldAuto,resolveRecord,resultText } from './diceEngine.mjs';
import { stripAcceptedActions } from './actionStore.js';
import { actionState } from './actionStore.js';

let generation=null, initialized=false, sendBusy=false;
let replyHandler=null;
export function setDiceReplyHandler(handler) { replyHandler=handler; }
export async function resumeEncounterRolls(keys) {
    if(!enabled())return;
    const selected=(currentDiceData()?.records??[]).filter(r=>keys.includes(r.key)&&ownerMessage(r)&&r.status!=='cancelled');
    const automatic=selected.filter(r=>shouldAuto(mode(),r.request));
    for(const r of automatic)if(r.status==='pending')commit(r);
    if(automatic.length&&extensionSettings.diceAutoContinue!==false)await deliver(automatic,true);
}
const displayCache=new WeakMap();
const modes=['off','player','auto','mixed'];
const modeNames=['关闭','玩家点击','自动投掷','混合：玩家点击 / NPC自动'];
const store=()=>currentDiceData(true);
const mode=()=>currentDiceData()?.mode ?? extensionSettings.diceMode ?? 'player';
const enabled=()=>extensionSettings.enabled && mode() !== 'off';
const metadata=()=>getContext().chatMetadata;
function fingerprint(text) { let n=2166136261; for(const c of String(text))n=Math.imul(n^c.charCodeAt(0),16777619); return (n>>>0).toString(16); }
function ownerFor(message) {
    message.extra ??= {};
    message.extra.rpg_dice_owner ??= crypto.randomUUID();
    const swipe=message.swipe_id ?? 0;
    // ST serializes swipe_info extras, not just active extras.
    if(message.swipe_info?.[swipe]) {
        message.swipe_info[swipe].extra ??= {};
        message.swipe_info[swipe].extra.rpg_dice_owner=message.extra.rpg_dice_owner;
    }
    return {id:message.extra.rpg_dice_owner,swipe,revision:fingerprint(message.mes)};
}
function ownerMessage(record) {
    return getContext().chat.find(m=>
        (m.extra?.rpg_dice_owner ?? m.swipe_info?.[m.swipe_id ?? 0]?.extra?.rpg_dice_owner) === record.owner.id &&
        (m.swipe_id ?? 0) === record.owner.swipe && fingerprint(m.mes) === record.owner.revision);
}
function valid(record, original) { return metadata()===original && store().records.includes(record) && !!ownerMessage(record); }
function addRequest(input,owner,channel) {
    const request=validateRoll(input), data=store(), key=`${owner.id}:${owner.swipe}:${owner.revision}:${request.id}`;
    data.records ??= [];
    const previous=data.records.find(r=>r.key===key);
    if(previous) {
        if(JSON.stringify(previous.request)!==JSON.stringify(request))throw Error('同一编号不能修改检定参数');
        return previous;
    }
    const count=data.records.filter(r=>r.owner.id===owner.id && r.owner.swipe===owner.swipe && r.owner.revision===owner.revision).length;
    if(count>=4)throw Error('每轮最多4个检定');
    const record={key,owner,request,channel,status:'pending',createdAt:Date.now(),delivered:false};
    data.records.push(record); saveChatDebounced(); return record;
}
function commit(record,external) {
    const result=resolveRecord(record,external);
    store().lastRoll=result; saveChatDebounced(); updateDiceDisplay(); renderDiceRequests();
    window.dispatchEvent(new Event('rpg-dice-changed'));
    return result;
}
/** Never overwrite a draft; program result is committed before any send attempt. */
async function deliver(records,send) {
    const original=metadata();
    if(sendBusy)throw Error('正在发送检定结果，请稍候');
    if(records.some(r=>!valid(r,original)||r.status!=='resolved'))throw Error('聊天或回复分支已改变');
    const undelivered=records.filter(r=>!r.delivered);
    if(!undelivered.length)return;
    const textarea=document.getElementById('send_textarea'), button=document.getElementById('send_but');
    if(!textarea)throw Error('未找到聊天输入框');
    const text=undelivered.map(r=>resultText(r.request,r.result)).join('\n');
    if(!send || textarea.value.trim()) {
        if(!send) { textarea.value += `${textarea.value ? '\n' : ''}${text}`; textarea.dispatchEvent(new Event('input',{bubbles:true})); }
        toastr.info(send?'已有草稿，检定结果已保存；请使用检定卡发送。':'检定结果已加入草稿；原草稿保留');
        return;
    }
    sendBusy=true;
    try {
        // Ended fires before ST has finished clearing its generating flag.
        for(let n=0;is_send_press && n<100;n++)await new Promise(r=>setTimeout(r,100));
        if(is_send_press || !button || button.disabled)throw Error('模型仍在生成或当前无法发送，请稍后重试');
        if(undelivered.some(r=>!valid(r,original)))throw Error('聊天或回复分支已改变');
        if(textarea.value.trim())throw Error('已有新草稿，未发送检定结果');
        // sendBusy prevents double clicks. Persist delivery only after acceptance.
        textarea.value=text; textarea.dispatchEvent(new Event('input',{bubbles:true}));
        const before=getContext().chat.length;
        const accepted=()=>getContext().chat.slice(before).some(m=>m.is_user && m.mes===text);
        // ST clears is_send_press before its send mutex releases. A click then
        // silently returns. Retry only our unchanged draft until a user message
        // confirms acceptance; never re-roll, replace a draft, or send twice.
        button.click();
        for(let n=0;n<150 && metadata()===original && !accepted();n++) {
            await new Promise(r=>setTimeout(r,100));
            if(accepted())break;
            if(undelivered.some(r=>!valid(r,original)) || textarea.value!==text || getContext().chat.slice(before).some(m=>m.is_user))break;
            if(n%3===2 && !is_send_press && !button.disabled)button.click();
        }
        if(metadata()===original && accepted()) { undelivered.forEach(r=>{r.delivered=true;});saveChatDebounced(); }
        // ST's send handler is asynchronous: confirm the actual user message, not an immediate DOM clear.
        if(metadata()===original && !getContext().chat.slice(before).some(m=>m.is_user && m.mes===text)) { undelivered.forEach(r=>{r.delivered=false;}); saveChatDebounced(); toastr.warning('结果已填入输入框，请点击发送继续'); }
    } finally { sendBusy=false; renderDiceRequests(); window.dispatchEvent(new Event('rpg-dice-changed')); }
}
async function act(record,kind,external) {
    try {
        if(!enabled() || !ownerMessage(record))throw Error('检定已失效或功能已关闭');
        if(actionState().encounter?.phase==='proposed'&&actionState().encounter.pending.some(p=>p.key===record.key))throw Error('请先接受模型提议的遭遇');
        if(kind==='cancel') { record.status='cancelled'; saveChatDebounced(); renderDiceRequests(); return; }
        if(record.status==='pending')commit(record,external);
        if(kind==='draft'||kind==='send')await deliver([record],kind==='send');
    } catch(e) { toastr.warning(e.message); }
}
function element(tag,cls,text) { const e=document.createElement(tag);e.className=cls;if(text)e.textContent=text;return e; }
function actionButton(text,callback) { const b=element('button','rpg-check-button',text);b.type='button';b.addEventListener('click',callback);return b; }
export function renderDiceRequests() {
    document.querySelectorAll('.rpg-check-card').forEach(e=>e.remove());
    const cleaned=new Set();
    for(const record of currentDiceData()?.records || []) {
        const message=ownerMessage(record);if(!message)continue;
        const index=getContext().chat.indexOf(message),target=document.querySelector(`.mes[mesid="${index}"]`);
        if(!target)continue;
        if(record.channel==='block' && !cleaned.has(message)) {
            cleaned.add(message);
            const raw=message.extra?.display_text ?? message.mes, display=stripRollBlocks(stripAcceptedActions(raw,message));
            const body=target.querySelector('.mes_text');
            const previous=body && displayCache.get(body);
            if(body && display!==raw && (previous?.raw!==raw || previous?.html!==body.innerHTML)) {
                body.innerHTML=messageFormatting(display,message.name,message.is_system,message.is_user,index,{},false);
                displayCache.set(body,{raw,html:body.innerHTML});
            }
        }
        if(!enabled())continue;
        const card=element('section','rpg-check-card');card.dataset.status=record.status;
        card.setAttribute('aria-label','骰子检定');
        card.append(element('strong','',`${record.request.actor} · ${record.request.reason}`));
        card.append(element('div','',`${formula(record.request)}${record.request.dc==null?'':` · DC ${record.request.dc}`}`));
        const actions=element('div','rpg-check-actions');
        if(record.status==='pending') {
            card.append(element('small','','等待投掷：类型由模型预设'));
            actions.append(actionButton('投掷并回复',()=>act(record,'send')),actionButton('投掷 / 填入草稿',()=>act(record,'draft')));
            const manual=element('details',''),summary=element('summary','','使用实体骰子');
            const input=element('input','');input.type='text';input.placeholder='原始骰点，逗号分隔';input.setAttribute('aria-label','实体骰子原始点数');
            manual.append(summary,input,actionButton('记录并回复',()=>{
                const raw=input.value.trim().split(/[,，\s]+/).map(Number);act(record,'send',raw);
            }));card.append(manual);
            actions.append(actionButton('取消',()=>act(record,'cancel')));
        } else if(record.status==='resolved') {
            card.append(element('p','rpg-check-result',resultText(record.request,record.result)));
            card.append(element('small','',record.delivered?'结果已发送':'结果已保存'));
            if(!record.delivered)actions.append(actionButton('发送结果继续',()=>act(record,'send')),actionButton('填入草稿',()=>act(record,'draft')));
        } else card.append(element('small','','检定已取消'));
        card.append(actions);(target.querySelector('.mes_block') || target).append(card);
        // Keep ST's message edit shortcuts outside the check UI.
        for(const type of ['click','mousedown','touchstart'])card.addEventListener(type,e=>e.stopPropagation());
    }
}
export function beginDiceGeneration(type,data,dryRun) {
    const ctx=getContext();
    const normal=!dryRun && !['quiet','impersonate','continue'].includes(type) && !data?.quietImage && !data?.quiet_image && !data?.isImageGeneration && !evaluateSuppression(extensionSettings,ctx,data).shouldSuppress;
    let prompt='';
    if(enabled() && normal && ctx.chat?.length) {
        generation={metadata:metadata(),owner:null,native:false,type,nativeChannel:ToolManager.canPerformToolCalls(type),toolsAllowed:true,startLength:ctx.chat.length};
        const native=generation.nativeChannel;
        prompt=`[RPG骰子协议，优先于角色卡的掷骰操作约定]\n当前模式：${modeNames[modes.indexOf(mode())]}。仅明确需要规则随机检定时才发起；普通对话不掷骰。需要随机检定时，你必须先固定主体、主体类型(player/npc/unknown)、原因、骰子数量、面数、整数调整值、优势/劣势及公开DC。不得自行编造骰点、预判成功、重复加值或为了成功重复投掷；同一行动使用相同id。获得程序结果再叙述。最多4项；不擅自改HP/金钱。`;
        prompt+=native?'\n只通过 rpg_dice_check 工具提出检定，不输出rpg-roll结构块。若工具返回pending，停止推进该行动，等待玩家点击；结果为resolved时使用返回总数。':
            '\n只在正常主回复末尾输出 <rpg-roll>{"id":"check_1","actor":"主体名字","actorType":"player","reason":"检定原因","count":1,"sides":20,"modifier":0,"advantage":"normal","dc":12}</rpg-roll>。多项先攻每项使用唯一id和完整起止标签，禁止裸JSON；advantage可为normal/advantage/disadvantage；未知DC为null。等待程序/玩家提供结果。不要在跟踪JSON、代码块、想法或背景摘要里输出检定。';
    }
    if(!normal && generation)generation.toolsAllowed=false;
    setExtensionPrompt('rpg-dice-check',prompt,extension_prompt_types.IN_CHAT,0,false,extension_prompt_roles.SYSTEM);
}
export async function invokeDiceTool(input) {
    if(!generation || !enabled() || generation.metadata!==metadata() || !generation.nativeChannel || !generation.toolsAllowed || !is_send_press)throw Error('骰子工具只允许当前正常主回复调用');
    if(!generation.owner) {
        const anchor=[...getContext().chat].reverse().find(m=>m.is_user && !m.is_system) || getContext().chat.at(-1);
        generation.owner=ownerFor(anchor);
    }
    if(!ownerMessage({owner:generation.owner}))throw Error('工具所属消息已改变或删除');
    const record=addRequest(input,generation.owner,'tool');generation.native=true;
    if(shouldAuto(mode(),record.request) && record.status==='pending') { commit(record); record.delivered=true; saveChatDebounced(); }
    renderDiceRequests();
    return JSON.stringify({status:record.status,request:record.request,result:record.result ?? null,instruction:record.status==='pending'?'等待玩家点击，不推进此行动':record.status==='resolved'?'使用本次固定结果；不能重掷或再次添加调整值':'玩家取消了检定'});
}
export async function finishDiceGeneration(messageId, type) {
    const active=generation;
    if(!active || !enabled() || active.metadata!==metadata())return;
    const messages=getContext().chat, message=Number.isInteger(messageId) ? messages[messageId] : messages.at(-1);
    if(!message || message.is_user || message.is_system || ['quiet','continue','impersonate','first_message'].includes(type))return;
    // Streaming emits MESSAGE_RECEIVED for tool intermediaries BEFORE invoking tools.
    // Leave their generation alive until ST invokes the tool and finishes its follow-up.
    if(active.nativeChannel) { renderDiceRequests(); return; }
    for(let n=0;is_send_press && n<1200 && generation===active;n++)await new Promise(r=>setTimeout(r,100));
    // Let existing tracker listeners normalize whitespace and update the visible message first.
    await new Promise(r=>setTimeout(r,0));
    if(generation!==active || active.metadata!==metadata() || !enabled())return;
    if(is_send_press) { toastr.warning('模型仍在生成，检定未执行；请稍后让模型重新发起'); return; }
    generation=null;
    try {
        if(!active.nativeChannel && !active.native) {
            const requests=parseRollBlocks(message.mes);
            const owner=ownerFor(message), records=requests.map(r=>addRequest(r,owner,'block'));
            if(replyHandler)await replyHandler(message,records);
            if(!requests.length)return;
            const automatic=records.filter(r=>shouldAuto(mode(),r.request)&&!(actionState().encounter?.phase==='proposed'&&actionState().encounter.pending.some(p=>p.key===r.key)));
            automatic.forEach(r=>{if(r.status==='pending')commit(r);});
            renderDiceRequests();
            if(automatic.length && extensionSettings.diceAutoContinue !== false)await deliver(automatic,true);
        } else renderDiceRequests();
    } catch(e) { toastr.warning('骰子检定未执行：'+e.message); }
}
function select(values,names,value,callback) {
    const e=element('select','');values.forEach((v,i)=>{const o=element('option','',names[i]);o.value=v;e.append(o);});e.value=value;e.addEventListener('change',()=>callback(e.value));return e;
}
export function setupDicePreferences() {
    const body=document.querySelector('#rpg-settings-popup .rpg-settings-popup-body');
    if(!body || document.getElementById('rpg-dice-preferences'))return;
    const section=element('section','rpg-dice-preferences');section.id='rpg-dice-preferences';
    section.append(element('h4','','头像、角色状态与骰子检定'));
    function labeled(text,control) { const row=element('label','',text);row.append(control);section.append(row); }
    const npc=element('input','');npc.type='checkbox';npc.checked=extensionSettings.npcStatusEnabled !== false;
    npc.addEventListener('change',()=>{extensionSettings.npcStatusEnabled=npc.checked;saveSettings();renderThoughts();});
    labeled('NPC基础状态：生命、精力、异常状态',npc);
    section.append(element('small','','开启时附加基础状态；关闭后沿用高级跟踪配置。生命与精力使用百分比，未知值不会自动补满。'));
    labeled('头像尺寸',select(['48','64','80'],['紧凑 48px','标准 64px','大图 80px'],String(extensionSettings.portraitSize || 64),v=>{extensionSettings.portraitSize=Number(v);saveSettings();refreshBalancedLayout();}));
    labeled('账号默认掷骰模式',select(modes,modeNames,extensionSettings.diceMode || 'player',v=>{extensionSettings.diceMode=v;saveSettings();renderDiceRequests();}));
    const chatSelect=select(['inherit',...modes],['沿用账号默认',...modeNames],currentDiceData()?.mode ?? 'inherit',v=>{
        if(!getContext().chat?.length){toastr.warning('请先打开一个聊天');return;}
        if(v==='inherit')delete store().mode;else store().mode=v;
        saveChatDebounced();renderDiceRequests();
    });chatSelect.id='rpg-chat-dice-mode';labeled('当前聊天掷骰模式',chatSelect);
    const checkbox=element('input','');checkbox.type='checkbox';checkbox.checked=extensionSettings.diceAutoContinue !== false;
    checkbox.addEventListener('change',()=>{extensionSettings.diceAutoContinue=checkbox.checked;saveSettings();});labeled('兼容通道自动发送结果并续写（额外模型请求）',checkbox);
    const status=element('small','');status.id='rpg-dice-tool-status';section.append(status);
    section.append(element('p','','模型始终预设检定类型。混合模式下，主体未知时等待玩家。关闭不删除记录。现有账号最后骰点不迁入新聊天。旧回复不会自动扫描；需要检定时让模型在新回复中发起。'));
    body.prepend(section); updatePreferenceStatus();
}
function updatePreferenceStatus() {
    const e=document.getElementById('rpg-dice-tool-status');
    if(e)e.textContent=ToolManager.isToolCallingSupported()?'ST工具调用已启用；实际模型兼容性需实测':'ST工具调用未启用或不支持，将使用结构块兼容通道';
    const select=document.getElementById('rpg-chat-dice-mode');if(select)select.value=currentDiceData()?.mode ?? 'inherit';
}
export function initDiceRequests() {
    if(initialized)return;initialized=true;setupDicePreferences();
    ToolManager.registerFunctionTool({name:'rpg_dice_check',displayName:'RPG骰子检定',description:'固定一次检定的类型，由程序或玩家投掷。不能指定结果。pending时停止并等待玩家。',
        parameters:{type:'object',additionalProperties:false,required:['id','actor','actorType','reason','count','sides','modifier','advantage','dc'],properties:{
            id:{type:'string',description:'同一行动固定且唯一编号'},actor:{type:'string'},actorType:{type:'string',enum:['player','npc','unknown']},reason:{type:'string'},count:{type:'integer',minimum:1,maximum:20},sides:{type:'integer',minimum:2,maximum:1000},modifier:{type:'integer',minimum:-1000,maximum:1000},advantage:{type:'string',enum:['normal','advantage','disadvantage']},dc:{type:['integer','null'],minimum:0,maximum:2000}}},
        action:invokeDiceTool,formatMessage:()=> 'RPG骰子检定',shouldRegister:()=>!!generation && enabled() && generation.metadata===metadata() && generation.nativeChannel && generation.toolsAllowed && is_send_press,stealth:false});
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS,beginDiceGeneration);
    eventSource.on(event_types.MESSAGE_RECEIVED,(id,type)=>{void finishDiceGeneration(id,type);});
    eventSource.on(event_types.GENERATION_ENDED,()=>{if(generation && !is_send_press)generation.toolsAllowed=false;});
    eventSource.on(event_types.GENERATION_STOPPED,()=>{generation=null;});
    for(const event of [event_types.CHAT_CHANGED,event_types.CHAT_LOADED,event_types.MESSAGE_DELETED,event_types.MESSAGE_SWIPE_DELETED,event_types.MESSAGE_SWIPED,event_types.MESSAGE_UPDATED]) {
        eventSource.on(event,()=>{if([event_types.CHAT_CHANGED,event_types.CHAT_LOADED,event_types.MESSAGE_SWIPED].includes(event))generation=null;renderDiceRequests();updateDiceDisplay();updatePreferenceStatus();});
    }
    eventSource.on(event_types.MESSAGE_SENT,id=>{
        const sent=getContext().chat[id];
        if(!sent?.is_user)return;
        const records=(currentDiceData()?.records || []).filter(r=>r.status==='resolved' && !r.delivered && ownerMessage(r));
        // Players may combine several saved check results into one draft/reply.
        const matching=records.filter(r=>(`\n${sent.mes}\n`).includes(`\n${resultText(r.request,r.result)}\n`));
        if(matching.length) { matching.forEach(r=>{r.delivered=true;});saveChatDebounced();renderDiceRequests();window.dispatchEvent(new Event('rpg-dice-changed')); }
    });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED,renderDiceRequests);
    const chat=document.getElementById('chat');
    if(chat)new MutationObserver(mutations=>{
        if(!(currentDiceData()?.records || []).some(r=>r.channel==='block'))return;
        if(mutations.some(m=>{
            const body=(m.target.nodeType===1?m.target:m.target.parentElement)?.closest('.mes_text');
            return body && displayCache.get(body)?.html!==body.innerHTML;
        }))renderDiceRequests();
    }).observe(chat,{childList:true,subtree:true,characterData:true});
    document.getElementById('rpg-open-settings')?.addEventListener('click',updatePreferenceStatus);
    renderDiceRequests();
}
