import { encounterModal } from '../ui/encounterUI.js';
import { isUniversalFramework } from '../../framework/mode.js';
import { setNativeStartHandler,refreshNativeEncounter,hideNativeEncounter } from './encounterAdapter.js';
import { acceptSceneRequest,renderSceneImage,restoreSceneBranch,sceneImageMode } from './sceneImage.js';
/** Original encounter UI backed by main-chat dice, snapshots and resources. */
import { getContext } from '../../../../../../extensions.js';
import { ToolManager } from '../../../../../../tool-calling.js';
import { eventSource,event_types,setExtensionPrompt,extension_prompt_types,extension_prompt_roles,is_send_press,messageFormatting,saveChatDebounced } from '../../../../../../../script.js';
import { extensionSettings,lastGeneratedData,committedTrackerData,FALLBACK_AVATAR_DATA_URI } from '../../core/state.js';
import { saveSettings,saveChatData,updateMessageSwipeData } from '../../core/persistence.js';
import { isItemLocked } from '../generation/lockManager.js';
import { npcStatusConfig } from '../../utils/npcStatus.mjs';
import { showPortraitPreview } from '../ui/portraitPreview.js';
import { evaluateSuppression } from '../generation/suppression.js';
import { renderUserStats } from '../rendering/userStats.js';
import { renderThoughts } from '../rendering/thoughts.js';
import { resolvePresentCharacterPortrait } from '../../utils/presentCharacters.js';
import { getSafeThumbnailUrl } from '../../utils/avatars.js';
import { user_avatar } from '../../../../../../../script.js';
import { readSheet } from '../generation/numericState.mjs';
import { currentDiceData } from './dice.js';
import { setDiceReplyHandler,renderDiceRequests,resumeEncounterRolls } from './diceRequests.js';
import { stripRollBlocks } from './diceEngine.mjs';
import { scanActionBlocks,reduceActions,reconcileEncounter,validatePlayer,projectConditions } from './actionProtocol.mjs';
import { actionData,actionState,actionPreference,saveActionSnapshot,restoreActionBranch,latestActionMessage,replyRevision,stripAcceptedActions,portraitData,activePortrait,cloneAction } from './actionStore.js';
import { generatePlayerPortrait,canAutoPortrait,uploadPlayerPortrait,playerPortraitMode } from './playerPortrait.js';
import { node,actionButton,resourcesPanel,decorateNpcResources,decoratePlayerPortrait,tr,setPlayerToolsRenderer } from './actionPanels.js';
let initialized=false,generation=null;
const displays=new WeakMap();
const seen=new WeakMap();
const records=()=>currentDiceData()?.records??[];
export function encounterMode() {return actionPreference('encounterMode',extensionSettings.modelEncounterMode??'proposal');}
function notify(error) {toastr.warning(error.message);}
function activeBattle() {return actionState().encounter && actionState().encounter.phase!=='ended';}
function refresh() {
    renderUserStats();renderThoughts();decoratePlayerPortrait();decorateNpcResources();renderPlayerTools();renderSceneImage();renderActionMessages();renderDiceRequests();refreshNativeEncounter();renderSceneImage();setupActionPreferences();
}
export function renderActionMessages() {
    const ctx=getContext();
    for(const [index,message] of ctx.chat.entries()) {
        if(message.is_user||message.is_system)continue;
        const raw=message.extra?.display_text??message.mes;
        // Same transformation as dice renderer; never replace the stored message.
        const acceptedRoll=records().some(r=>r.channel==='block'&&r.owner.id===(message.extra?.rpg_dice_owner??message.swipe_info?.[message.swipe_id??0]?.extra?.rpg_dice_owner)&&r.owner.swipe===(message.swipe_id??0)&&r.owner.revision===replyRevision(message.mes));
        const actionDisplay=stripAcceptedActions(raw,message);
        const display=acceptedRoll?stripRollBlocks(actionDisplay):actionDisplay;
        if(display===raw)continue;
        const body=document.querySelector(`.mes[mesid="${index}"] .mes_text`);if(!body)continue;
        const old=displays.get(body);
        if(old?.raw===raw&&old?.display===display&&old?.html===body.innerHTML)continue;
        const formatted=messageFormatting(display,message.name,message.is_system,message.is_user,index,{},false);
        if(body.innerHTML!==formatted)body.innerHTML=formatted;
        displays.set(body,{raw,display,html:body.innerHTML});
    }
}
function persistReconciliation() {
    if (isUniversalFramework()) return;
    const state=cloneAction(actionState()),player=state.player;
    const dex=player?{[player.id]:readSheet(extensionSettings.characterSheetState).attributes.dex??0}:{};
    if(reconcileEncounter(state,records(),dex))saveActionSnapshot(latestActionMessage(),state);
    refresh();
}
export function beginActionGeneration(type,data,dryRun) {
    if (isUniversalFramework()) { generation = null; setExtensionPrompt('rpg-actions','',extension_prompt_types.IN_CHAT,0,false); return; }
    const ctx=getContext();
    const normal=extensionSettings.enabled&&!dryRun&&!['quiet','impersonate','continue'].includes(type)&&!data?.quietImage&&!data?.quiet_image&&!data?.isImageGeneration&&!evaluateSuppression(extensionSettings,ctx,data).shouldSuppress;
    let prompt='';
    if(normal && ctx.chat.length) {
        const anchor=[...ctx.chat].reverse().find(m=>m.is_user&&!m.is_system)??ctx.chat.at(-1);
        generation={meta:ctx.chatMetadata,anchor,anchorRevision:replyRevision(anchor.mes),started:Date.now(),startLength:ctx.chat.length,diceCompatibility:(currentDiceData()?.mode??extensionSettings.diceMode??'player')!=='off'&&!ToolManager.canPerformToolCalls(type),handled:new WeakSet()};
        const mode=encounterMode(),state=actionState();
        prompt=`[RPG玩家与遭遇协议]\n这些是可选更新，不要每轮重复发送。正常主回复末尾输出完整标签，不能放进代码块、think或tracker JSON。保持正文叙事和短资源结算。模型不能替玩家决定行动或编造骰点。玩家记录仅在用户确认身份/相貌后建立；未提供的外观先询问，不能将种族/职业当作完整外观。\n玩家记录格式：<rpg-player>{"id":"player_1","name":"已确认姓名","appearance":"已确认具体外观","confirmed":true,"resources":{"hp":{"current":8,"max":8},"ac":12,"spellSlots":{"1":{"current":2,"max":2}},"concentration":null,"conditions":[]}}</rpg-player>。这是格式示例，非当前事实。resources可省略；未知资源省略或null；只用已确认绝对值，百分比Health不是HP。稳定player id，不随升级/换装改变。\n当前遭遇模式：${mode}；manual不自动发起；proposal仅提议；auto可在真实进入交战时发起。骰子独立模式，关闭时不得提出随机结算。遭遇格式：<rpg-encounter>{"id":"battle_1","op":"begin","reason":"实际交战原因","participants":[{"id":"player_1","name":"已确认姓名","actorType":"player","side":"ally","resources":{}},{"id":"enemy_1","name":"敌人名字","actorType":"npc","side":"enemy","resources":{"hp":{"current":8,"max":8},"ac":12}}],"round":1,"turn":null,"rolls":[{"participantId":"player_1","requestId":"initiative_player","kind":"initiative"},{"participantId":"enemy_1","requestId":"initiative_enemy","kind":"initiative"}]}</rpg-encounter>。rolls引用同轮rpg-roll或rpg_dice_check的id，骰子主体/类型必须与参战者一致。先攻1d20/DC null；每轮最多4个检定，人数更多分批提出。先攻、攻击、伤害、豁免用程序骰子，先请求→等待回传→结算；不能编造随机数。kind为initiative/attack/damage/save/check。\n后续op:update必须复用遭遇id，participants可省略或只含已存在成员，resources只写变化字段；轮次只增1，不改参战者身份。攻击检定未回传不能预扣HP；伤害需要骰子时先提出damage，下一回复才扣HP。已确认伤害/治疗/消耗结算要同步写绝对hp、法术位、专注及conditions并在正文短句交代；没有依据先问，不自行按百分比推算。所有待检定须全部回传再结算。结束op:end，result为victory/defeat/fled/resolved，summary简短；仍需participants写本轮资源变化。关闭窗口不是结束。用用户保存叙事风格：${JSON.stringify(extensionSettings.encounterSettings?.combatNarrative??{})}。\n当前权威聊天状态（仅已知资源）：${JSON.stringify(state)}。资源锁：${JSON.stringify(actionData()?.locks??{})}。检定结果：${JSON.stringify(records().filter(r=>state.encounter?.pending?.some(p=>p.key===r.key)).map(r=>({id:r.request.id,status:r.status,delivered:r.delivered,result:r.result??null})))}。\n[/RPG玩家与遭遇协议]`;
        prompt+='\n结算输出检查：update与end也必须带完整<rpg-encounter>和</rpg-encounter>，不能只输出裸JSON。结束格式示例（非当前事实）：<rpg-encounter>{"id":"battle_1","op":"end","result":"resolved","summary":"双方停止交战"}</rpg-encounter>。实际id复用当前遭遇；有资源变化时还要提供对应participants及resources；标签单独一行，不能紧贴正文。';
    } // A nested quiet avatar prompt must not discard the pending normal reply.
    if(prompt){prompt+=`
原版战斗界面已连接主聊天。可在begin或update提供playerActions:{"attacks":[{"name":"已知攻击/法术名称","type":"single-target"}],"items":["已知物品名称"]}，仅列玩家已有装备/能力，不新增虚构技能。界面负责目标选择，按钮只填入主聊天草稿。不要额外生成party/enemies初始化或独立战斗摘要。update/end参与者资源补丁可仅提供id/resources，其余身份继承既有成员；提供的身份不得改变。initiative由程序计算，不主动输出initiative字段；若回显必须与程序结果一致。
场景绘图模式：${sceneImageMode()}。仅proposal/auto模式允许模型请求刷新：地点切换、在场角色进出、主要动态显著改变（例如交战、逃跑、坍塌）。普通对话、数值微调、重复动作不要请求。末尾用完整<rpg-scene>{"change":"location","summary":"当前画面中可见角色的姿态、互动与主要动作，以及所处地点"}</rpg-scene>，change仅location/cast/action，无URL和绘图参数，每轮最多一个；summary描述此刻的画面，不是未来事件或内心思想。manual/off不发该标签。场景图只是视觉记录，不改变世界状态。`;}
    setExtensionPrompt('rpg-actions',prompt,extension_prompt_types.IN_CHAT,0,false,extension_prompt_roles.SYSTEM);
}
/** Called by dice compatibility BEFORE its automatic continuation starts. */
async function processActions(message,newRecords=[]) {
    const g=generation,ctx=getContext();if(!g||g.meta!==ctx.chatMetadata||!extensionSettings.enabled||!ctx.chat.includes(message)||!ctx.chat.includes(g.anchor)||replyRevision(g.anchor.mes)!==g.anchorRevision||ctx.chat.indexOf(message)<g.startLength-1||message.is_user||message.is_system||g.handled.has(message))return;
    const previous=actionState();
    const entries=scanActionBlocks(message.mes,{encounterId:previous.encounter && !['ended','proposed'].includes(previous.encounter.phase)?previous.encounter.id:null});if(!entries.length)return;
    const revision=replyRevision(message.mes),swipe=message.swipe_id??0;
    if(seen.get(message)===`${swipe}:${revision}`)return;
    const fresh=new Set(newRecords.map(r=>r.key));
    // Native dice tools belong to this generation's user anchor, not an older turn.
    const anchor=[...getContext().chat.slice(0,g.startLength)].reverse().find(m=>m.is_user&&!m.is_system);
    for(const r of records())if(r.channel==='tool'&&r.createdAt>=g.started&&anchor?.extra?.rpg_dice_owner===r.owner.id&&(anchor.swipe_id??0)===r.owner.swipe&&replyRevision(anchor.mes)===r.owner.revision)fresh.add(r.key);
    const all=records().map(r=>({...r,fresh:fresh.has(r.key)}));
    const data=actionData(true),mode=data.manualStartRequested?'auto':encounterMode();
    const locks=cloneAction(data.locks??{});
    const conditionName=npcStatusConfig(extensionSettings.trackerConfig?.presentCharacters,extensionSettings.npcStatusEnabled!==false).customFields?.find(f=>f.id==='npc_conditions'||f.name==='Conditions')?.name??'Conditions';
    for(const entry of entries)for(const p of entry.type==='player'?[{...entry.value,actorType:'player'}]:entry.value.participants??[]) {
        const member=entry.type==='player'?p:previous.encounter?.participants.find(m=>m.id===p.id)??p;
        const locked=member.actorType==='player'?isItemLocked('userStats','status'):isItemLocked('characters',`${member.name}.${conditionName}`);
        if(locked&&locks[p.id]!==true)locks[p.id]={...locks[p.id],conditions:true};
    }
    const state=reduceActions(previous,entries,all,{encounterMode:extensionSettings.encounterSettings?.enabled===false?'manual':mode,locks});
    if(state.encounter){state.encounter.log=[...(previous.encounter?.id===state.encounter.id?previous.encounter.log??[]:[])];const body=message.extra?.display_text??message.mes;const text=String(body).replace(/```[\s\S]*?```/g,'').replace(/<rpg-(player|encounter|roll|scene)>[\s\S]*?<\/rpg-\1>/g,'').slice(0,4000).trim();if(text)state.encounter.log.push({text});state.encounter.log=state.encounter.log.slice(-60);}
    const projectionState=cloneAction(state);
    if(state.player&&isItemLocked('userStats','status')&&projectionState.resources[state.player.id])delete projectionState.resources[state.player.id].conditions;
    for(const p of state.encounter?.participants??[])if(p.actorType==='npc'&&isItemLocked('characters',`${p.name}.${conditionName}`)&&projectionState.resources[p.id])delete projectionState.resources[p.id].conditions;
    const projected=projectConditions(projectionState,lastGeneratedData.userStats||committedTrackerData.userStats,lastGeneratedData.characterThoughts||committedTrackerData.characterThoughts,conditionName);
    if(projected.userConditions!==undefined)extensionSettings.userStats.conditions=projected.userConditions;
    lastGeneratedData.userStats=projected.userRaw;committedTrackerData.userStats=projected.userRaw;
    lastGeneratedData.characterThoughts=projected.npcRaw;committedTrackerData.characterThoughts=projected.npcRaw;
    saveActionSnapshot(message,state);delete data.manualStartRequested;
    updateMessageSwipeData();saveChatData();
    g.handled.add(message);seen.set(message,`${swipe}:${revision}`);
    persistReconciliation();
    const newlyStarted=state.encounter?.id!==previous.encounter?.id;
    if(newlyStarted && state.encounter.phase!=='proposed')openLinkedEncounter();
    if(newlyStarted && state.encounter.phase==='proposed')toastr.info(tr('proposed'));
    if(canAutoPortrait())void generatePlayerPortrait().catch(notify);
}
export async function processActionReply(message,newRecords=[]){
    const g=generation,ctx=getContext();
    if(!g||g.meta!==ctx.chatMetadata||!ctx.chat.includes(g.anchor)||replyRevision(g.anchor.mes)!==g.anchorRevision||!ctx.chat.includes(message)||ctx.chat.indexOf(message)<g.startLength-1||message.is_user||message.is_system)return;
    try{await processActions(message,newRecords);}catch(e){notify(e);}
    try{await acceptSceneRequest(message);}catch(e){notify(e);}
    renderActionMessages();renderDiceRequests();
}
async function finishWithoutDice(id,type) {
    const g=generation;if(!g||g.diceCompatibility||['quiet','continue','impersonate','first_message'].includes(type))return;
    const message=getContext().chat[id];if(!message||message.is_user||message.is_system)return;
    const swipe=message.swipe_id;
    for(let n=0;is_send_press&&n<1200&&generation===g;n++)await new Promise(r=>setTimeout(r,100));
    if(is_send_press||generation!==g||getContext().chatMetadata!==g.meta||!getContext().chat.includes(message)||message.swipe_id!==swipe)return;
    await new Promise(r=>setTimeout(r,0));
    try{await processActionReply(message);}catch(error){notify(error);}
}
function draft(text) {
    const input=document.getElementById('send_textarea');if(!input)throw Error('未找到聊天输入框');
    if(input.value.trim()){toastr.info(tr('draftPreserved'));return false;}
    input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));return true;
}
export function openLinkedEncounter(){encounterModal.open();}
function requestManualEncounter(){
    if(draft(tr('startRequest'))){actionData(true).manualStartRequested=true;saveChatDebounced();toastr.info(tr('draftReady'));}
}
function renderPlayerTools() {
    const parent=document.getElementById('rpg-user-stats');if(!parent)return;
    parent.querySelector('.rpg-player-tools')?.remove();
    const section=node('details','rpg-player-tools');section.append(node('summary','',tr('playerTools')));
    const player=actionState().player;
    if(player) {
        section.append(node('small','',player.name),node('div','',player.appearance));
        const resources=resourcesPanel(player.id);if(resources)section.append(resources);
        const portrait=activePortrait();if(portrait?.status)section.append(node('small','',tr('portrait_'+portrait.status)));
        section.append(actionButton(tr('generatePortrait'),()=>generatePlayerPortrait(true).catch(notify)),actionButton(portrait?.locked?tr('unlockPortrait'):tr('lockPortrait'),()=>{
            const data=portraitData(true);data.portraits[player.id]??={};data.portraits[player.id].locked=!data.portraits[player.id].locked;saveChatDebounced();refresh();
        }));
        const upload=node('input','');upload.type='file';upload.accept='image/png,image/jpeg,image/webp';upload.setAttribute('aria-label',tr('uploadPortrait'));upload.addEventListener('change',()=>void uploadPlayerPortrait(upload.files[0]).catch(notify));section.append(upload);
    }
    const editor=node('details','');editor.append(node('summary','',tr('editPlayer')));
    const name=node('input','');name.value=player?.name??getContext().name1??'';name.placeholder=tr('name');name.setAttribute('aria-label',tr('name'));
    const appearance=node('textarea','');appearance.value=player?.appearance??'';appearance.placeholder=tr('appearance');appearance.setAttribute('aria-label',tr('appearance'));
    editor.append(name,appearance,actionButton(tr('savePlayer'),()=>{
        try {
            if(activeBattle())throw Error('活动遭遇中不能手动重建人物，请先完成遭遇');
            const p=validatePlayer({id:player?.id??'player_'+crypto.randomUUID().replaceAll('-',''),name:name.value,appearance:appearance.value,confirmed:true});
            const state=cloneAction(actionState());state.player=p;const data=actionData(true);data.manual=cloneAction(state);saveActionSnapshot(latestActionMessage(),state);refresh();
        }catch(error){notify(error);}
    }));section.append(editor);parent.append(section);
}
export function setupActionPreferences() {
    const parent=document.querySelector('#rpg-settings-popup .rpg-settings-popup-body');if(!parent)return;
    let section=document.getElementById('rpg-action-preferences');
    if(!section){section=node('section','rpg-dice-preferences');section.id='rpg-action-preferences';parent.prepend(section);}
    section.replaceChildren();section.append(node('h4','',tr('settings')));
    const row=(title,values,names,current,callback)=>{
        const label=node('label','',title),select=node('select','');for(let i=0;i<values.length;i++){const option=node('option','',names[i]);option.value=values[i];select.append(option);}select.value=current;select.addEventListener('change',()=>callback(select.value));label.append(select);section.append(label);
    };
    row(tr('accountEncounter'),['manual','proposal','auto'],['manual','proposal','auto'].map(tr),extensionSettings.modelEncounterMode??'proposal',v=>{extensionSettings.modelEncounterMode=v;saveSettings();});
    row(tr('chatEncounter'),['inherit','manual','proposal','auto'],['inherit','manual','proposal','auto'].map(tr),actionData()?.preferences?.encounterMode??'inherit',v=>{const d=actionData(true);if(v==='inherit')delete d.preferences.encounterMode;else d.preferences.encounterMode=v;saveChatDebounced();});
    row(tr('accountScene'),['off','manual','proposal','auto'],['off','manualScene','proposalScene','autoScene'].map(tr),extensionSettings.sceneImageMode??'manual',v=>{extensionSettings.sceneImageMode=v;saveSettings();});
    row(tr('chatScene'),['inherit','off','manual','proposal','auto'],['inherit','off','manualScene','proposalScene','autoScene'].map(tr),actionData()?.preferences?.sceneMode??'inherit',v=>{const d=actionData(true);if(v==='inherit')delete d.preferences.sceneMode;else d.preferences.sceneMode=v;saveChatDebounced();renderSceneImage();});
    row(tr('accountPortrait'),['off','manual','auto'],['off','manualPortrait','autoPortrait'].map(tr),extensionSettings.playerPortraitMode??'manual',v=>{extensionSettings.playerPortraitMode=v;saveSettings();});
    row(tr('chatPortrait'),['inherit','off','manual','auto'],['inherit','off','manualPortrait','autoPortrait'].map(tr),actionData()?.preferences?.portraitMode??'inherit',v=>{const d=actionData(true);if(v==='inherit')delete d.preferences.portraitMode;else d.preferences.portraitMode=v;saveChatDebounced();});
    section.append(node('small','',tr('settingsHelp')));
}
export function initActionBridge() {
    if(initialized)return;initialized=true;
    setNativeStartHandler(requestManualEncounter);
    setPlayerToolsRenderer(renderPlayerTools);
    setDiceReplyHandler(processActionReply);
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS,beginActionGeneration);
    eventSource.on(event_types.MESSAGE_RECEIVED,(id,type)=>{void finishWithoutDice(id,type);});
    eventSource.on(event_types.GENERATION_STOPPED,()=>{generation=null;});
    for(const event of [event_types.CHAT_CHANGED,event_types.CHAT_LOADED,event_types.MESSAGE_SWIPED,event_types.MESSAGE_DELETED,event_types.MESSAGE_SWIPE_DELETED,event_types.MESSAGE_UPDATED])eventSource.on(event,()=>{
        // Native tool placeholders can be deleted during the still-active generation.
        if(!is_send_press||[event_types.CHAT_CHANGED,event_types.CHAT_LOADED,event_types.MESSAGE_SWIPED].includes(event))generation=null;
        hideNativeEncounter();restoreActionBranch();restoreSceneBranch();refresh();
    });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED,()=>{decorateNpcResources();renderPlayerTools();renderSceneImage();renderActionMessages();});
    window.addEventListener('rpg-dice-changed',persistReconciliation);
    window.addEventListener('rpg-actions-render',refresh);
    document.getElementById('rpg-open-settings')?.addEventListener('click',setupActionPreferences);
    const chat=document.getElementById('chat');if(chat)new MutationObserver(ms=>{
        if(ms.some(m=>{const body=(m.target.nodeType===1?m.target:m.target.parentElement)?.closest('.mes_text');return body&&displays.get(body)?.html!==body.innerHTML;}))renderActionMessages();
    }).observe(chat,{childList:true,subtree:true,characterData:true});
    restoreActionBranch();restoreSceneBranch();refresh();
}
