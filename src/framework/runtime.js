/** SillyTavern boundary. Game definitions stay in the chat, never account settings. */
import { getContext } from '../../../../../extensions.js';
import { eventSource, event_types, setExtensionPrompt, extension_prompt_types, extension_prompt_roles, updateMessageBlock, is_send_press, user_avatar, getThumbnailUrl } from '../../../../../../script.js';
import { extensionSettings, incrementSeparateGenerationId } from '../core/state.js';
import { i18n } from '../core/i18n.js';
import { FrameworkChat, frameworkMode } from './chat.mjs';
import { FrameworkPanel, FrameworkRoster } from './panel.mjs';
import { evaluateSuppression } from '../systems/generation/suppression.js';
import { processActionReply, renderActionMessages } from '../systems/features/actionBridge.js';
import { actionPreference } from '../systems/features/actionStore.js';
import { setDiceReplyHandler } from '../systems/features/diceRequests.js';
import { renderSceneImage, acceptSceneRequest, sceneImageMode } from '../systems/features/sceneImage.js';
import { saveFrameworkVerified } from './storage.mjs';
import { entityAppearance } from './visual.mjs';
import { SlashCommandParser } from '../../../../../slash-commands/SlashCommandParser.js';
import { encounterModal } from '../systems/ui/encounterUI.js';
import { preserveBalancedDice } from '../systems/ui/balancedLayout.js';
import { protocolVisibleText } from '../systems/features/diceEngine.mjs';
import { withAvatarJob } from '../systems/features/avatarQueue.mjs';
import { FrameworkObservations, reviewFrameworkChat, frameworkDiagnosticLabel, frameworkSceneWarnings } from './diagnostics.mjs';

let initialized = false, playerPanel, scenePanel, nativePanel, nativeModal, timer, observer, frame, panelContext;
const portraitBusy = new WeakSet();
const visualsSeen = new WeakMap();
const node = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e; };
const zh = () => i18n.currentLanguage.startsWith('zh');
const text = (a,b) => zh() ? a : b;
const save = () => saveFrameworkVerified(getContext());
const observations = new FrameworkObservations();
const report = message => { toastr.warning(message, text('通用 RPG 框架','Universal RPG framework')); const el = document.getElementById('rpg-framework-feedback'); if (el) el.textContent = message; };
export const frameworkChat = new FrameworkChat({ getContext, save, enabled: () => !!extensionSettings.enabled, render: renderFramework, report, observe: (message, event) => { observations.record(message, event); renderDiagnostics(); } });

function renderDiagnostics() {
    const host = document.getElementById('rpg-framework-diagnostics');
    if (!host?.open) return;
    const body = host.querySelector('.uf-diagnostics-body'); body.replaceChildren();
    const review = reviewFrameworkChat(getContext().chat ?? [], observations);
    body.append(node('p', '', text('仅查看当前聊天选中的回复分支，最多显示最近100条。现场记录只保留到页面刷新；“重新校验”使用当前解析器，不能还原当时的处理或网络错误。保存快照不保证剧情信息完整。', 'Current chat and selected swipes only, up to 100 replies. Live observations last until page reload. Replay uses the current parser and cannot reconstruct historical processing or network errors. A snapshot does not prove narrative coverage.')));
    const exportButton = node('button', 'menu_button', text('导出诊断摘要', 'Export diagnostic summary')); exportButton.type = 'button';
    exportButton.addEventListener('click', () => {
        const current = reviewFrameworkChat(getContext().chat ?? [], observations);
        const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], {type: 'application/json'}));
        const link = document.createElement('a'); link.href = url; link.download = 'rpg-framework-diagnostics.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }); body.append(exportButton);
    if (!review.rows.length) body.append(node('p', '', text('暂无模型回复。', 'No assistant replies.')));
    for (const row of [...review.rows].reverse()) {
        const item = node('div', 'uf-diagnostic-row');
        item.append(node('strong', '', `#${row.message} · ${frameworkDiagnosticLabel(row, zh())}`));
        const basis = row.basis === 'saved_snapshot' ? text('保存快照', 'Saved snapshot') : row.basis === 'observed_this_page' ? text('本页面现场记录（刷新即失）', 'Live observation (lost on reload)') : text('重新校验，非历史日志', 'Replay, not a historical log');
        item.append(node('small', '', `${basis}${row.code ? ` · ${row.code}` : ''}${row.revision != null ? ` · v${row.revision}` : ''}${row.at ? ` · ${row.at}` : ''}`));
        if (row.warnings?.includes('multiple_active_scenes')) item.append(node('small', '', text('该记录含多个未归档场景；请核对当前地点。','This record contains multiple active scenes; check the current location.')));
        const locate = node('button', 'menu_button', text('定位回复', 'Locate reply')); locate.type = 'button';
        locate.addEventListener('click', () => {
            const message = document.querySelector(`#chat .mes[mesid="${row.message - 1}"]`);
            if (message) message.scrollIntoView({ block: 'center', behavior: 'smooth' });
            else report(text('该回复尚未显示，请先加载较早消息。', 'Load earlier messages to locate this reply.'));
        }); item.append(locate); body.append(item);
    }
}
export const currentFrameworkState = () => frameworkChat.state();
const sceneEntity = e => e.kind === 'scene';
const leftEntity = e => sceneEntity(e) || e.kind === 'npc';
const encounterEntity = e => e.kind === 'encounter';
const portraitMode = () => actionPreference('portraitMode',extensionSettings.playerPortraitMode??'manual');
const encounterMode = () => extensionSettings.encounterSettings?.enabled===false ? 'manual' : actionPreference('encounterMode',extensionSettings.modelEncounterMode??'proposal');
function view(state, predicate) { return { ...state, entities: state.entities.filter(predicate) }; }
function portrait(entity) {
    const ctx = getContext();
    const stored = currentPortraits()[entity.id];
    if (stored?.url) return stored.url;
    if (entity.kind === 'player' && user_avatar) return getThumbnailUrl('persona', user_avatar);
    const character = ctx.characters?.find(c => c.name === entity.label);
    return character?.avatar ? ctx.getThumbnailUrl?.('avatar', character.avatar) : null;
}
function panel(root) { return new FrameworkPanel(root, { language: zh() ? 'zh' : 'en', getPortrait: portrait, onOperation: op => frameworkChat.manual([op]) }); }
function roster(root, side) { return new FrameworkRoster(root, {
    language: zh() ? 'zh' : 'en', side, getPortrait: portrait,
    onOperation: op => frameworkChat.manual([op]), onPortrait: id => generateFrameworkPortrait(id),
    onPortraitLock: id => togglePortraitLock(id), isPortraitLocked: id => !!currentPortraits()[id]?.locked,
    hasGeneratedPortrait: id => !!currentPortraits()[id]?.url,
}); }
function mount() {
    const host = document.getElementById('rpg-companion-panel');
    if (!host) return;
    const right = host.querySelector('.rpg-balanced-scroll') ?? host.querySelector('.rpg-content-box');
    const left = document.getElementById('rpg-balanced-scene') ?? host.querySelector('.rpg-game-container');
    if (!right || !left) return;
    let more = right.querySelector('.rpg-balanced-more');
    if (!more) { more = node('details', 'rpg-balanced-more'); more.append(node('summary', '', text('更多','More'))); right.append(more); }
    let controls = document.getElementById('rpg-framework-controls');
    if (!controls || !more.contains(controls)) {
        controls?.remove(); controls = node('section','rpg-framework-controls'); controls.id = 'rpg-framework-controls';
        const label = node('label','',text('本聊天数据框架','Chat data framework')), select = node('select',''); select.id = 'rpg-framework-mode';
        for (const [value,name] of [['universal',text('通用：模型定义分类','Universal: model-defined')],['legacy',text('兼容：原版记录','Legacy trackers')]]) { const o = node('option','',name); o.value = value; select.append(o); }
        select.addEventListener('change', async () => { select.disabled = true; try { incrementSeparateGenerationId(); await frameworkChat.setMode(select.value); await eventSource.emit(event_types.CHAT_LOADED); } catch { report(text('模式保存失败','Could not save mode')); } finally { select.disabled = false; } });
        label.append(select); controls.append(label);
        const feedback = node('small','',text('分类与初值由模型建立；旧记录保留。','The model creates categories and initial values. Legacy records are preserved.')); feedback.id = 'rpg-framework-feedback'; feedback.setAttribute('role','status'); controls.append(feedback); more.prepend(controls);
        const diagnostics = node('details', 'uf-diagnostics'); diagnostics.id = 'rpg-framework-diagnostics';
        diagnostics.append(node('summary', '', text('数据更新诊断', 'Data update diagnostics')), node('div', 'uf-diagnostics-body'));
        diagnostics.addEventListener('toggle', renderDiagnostics); controls.append(diagnostics);
    }
    if (!playerPanel?.root.isConnected || playerPanel.root.parentElement !== right) { playerPanel?.root.remove(); const root = node('section','rpg-framework-player'); root.id = 'rpg-framework-player'; more.before(root); playerPanel = roster(root,'right'); }
    let sceneScroll = document.getElementById('rpg-framework-scene-scroll');
    if (!sceneScroll || sceneScroll.parentElement !== left) { sceneScroll?.remove(); sceneScroll = node('div','rpg-framework-scroll'); sceneScroll.id = 'rpg-framework-scene-scroll'; left.append(sceneScroll); }
    if (!scenePanel?.root.isConnected || scenePanel.root.parentElement !== sceneScroll) { scenePanel?.root.remove(); const root = node('section','rpg-framework-scene'); root.id = 'rpg-framework-scene'; sceneScroll.append(root); scenePanel = roster(root,'left'); }
    if (!document.getElementById('rpg-framework-scene-images')) { const images=node('section',''); images.id='rpg-framework-scene-images'; sceneScroll.prepend(images); }
    controls.querySelector('select').value = frameworkMode(getContext());
}
function renderFramework(state, info = {}) {
    if (panelContext !== getContext().chatMetadata) {
        playerPanel?.root.remove(); scenePanel?.root.remove(); playerPanel = null; scenePanel = null;
        panelContext = getContext().chatMetadata;
    }
    mount(); const active = frameworkChat.active();
    document.getElementById('rpg-companion-panel')?.classList.toggle('rpg-framework-active', active);
    preserveBalancedDice();
    if (!active || !playerPanel || !state) return;
    playerPanel.render(view(state, e => !leftEntity(e) && !encounterEntity(e)));
    const sceneState = view(state, leftEntity);
    sceneState.entities = [...sceneState.entities].sort((a,b) => Number(sceneEntity(b)) - Number(sceneEntity(a)));
    scenePanel.render(sceneState);
    if (frameworkSceneWarnings(state).length) {
        const warning = node('p', 'uf-scene-warning', text('记录中有多个未归档场景，请核对当前地点；转场时应更新原场景或归档旧场景。','Multiple scenes remain active. Check the current location; update the existing scene or archive the previous one when moving.'));
        warning.setAttribute('role', 'status'); scenePanel.root.prepend(warning);
    }
    renderSceneImage();
    renderActionMessages();
    const feedback = document.getElementById('rpg-framework-feedback');
    if (feedback) feedback.textContent = info.message
        ? text(`本轮提交已保存 · 版本 ${state.revision}（不代表剧情信息已全部记录）`,`Submitted data saved · revision ${state.revision} (narrative coverage is not verified)`)
        : text(`当前记录 · 版本 ${state.revision}；是否完整仍取决于模型提交的内容。`,`Current record · revision ${state.revision}; coverage depends on the submitted data.`);
    if (info.message) {
        const index = getContext().chat.indexOf(info.message);
        if (index >= 0) updateMessageBlock(index, info.message);
        const battle = state.entities.find(e => encounterEntity(e) && !e.archived);
        if (battle && !frameworkChat.generation?.before.entities.some(e=>e.id===battle.id&&!e.archived)) {
            if (encounterMode() === 'auto') window.dispatchEvent(new Event('rpg-framework-open-encounter'));
            else if (encounterMode() === 'proposal') toastr.info(text('遭遇已记录，可打开原遭遇窗口查看与行动','Encounter recorded. Open the encounter window to act.'));
        }
    }
    if (nativePanel && nativeModal?.modal.classList.contains('is-open')) renderFrameworkEncounter(nativeModal);
    renderDiagnostics();
}
function begin(type, data, dryRun) {
    const ctx = getContext();
    const suppressed = !!(data?.quietImage || data?.quiet_image || data?.isImageGeneration || data?.quiet_prompt || data?.quietPrompt || evaluateSuppression(extensionSettings,ctx,data).shouldSuppress);
    let prompt = '';
    try { prompt = frameworkChat.begin(type, { suppressed, dryRun }); } catch { report(text('游戏数据损坏，已停止注入','Invalid game data; injection stopped')); }
    if (prompt) prompt += `\n遭遇界面模式：${encounterMode()}。auto可在真实遭遇开始时打开原遭遇窗口，proposal只提示，manual仅由玩家打开；任意规则数据仍由上面的框架管理。骰子使用独立rpg_dice_check/rpg-roll协议，由程序提供结果。场景图模式：${sceneImageMode()}，仅proposal/auto允许在场景/人物/主要动态显著改变后输出一个<rpg-scene>{"change":"action","summary":"此刻公开可见的画面"}</rpg-scene>，change可为location/cast/action，复用原生绘图，不把URL写入游戏字段。头像模式：${portraitMode()}。只有auto允许末尾提出一个<rpg-portrait>{"entityId":"本次已定义且外观已知的对象编号"}</rpg-portrait>，不输出URL或绘图参数。实体description是公开可见的描述与动作，内心想法放单独字段；外观文字字段命名外观或appearance，头像不会把内心想法当画面。`;
    setExtensionPrompt('rpg-framework',prompt,extension_prompt_types.IN_CHAT,0,false,extension_prompt_roles.SYSTEM);
}
async function receive(id) {
    const messages = getContext().chat;
    if (!frameworkChat.active() || is_send_press) return;
    const message=Number.isInteger(id) ? messages[id] : messages.at(-1);
    await frameworkChat.receive(message);
    renderActionMessages();
    if (frameworkChat.active() && frameworkChat.generation?.handled.has(message)) await visualRequests(message);
}
function restore() { clearTimeout(timer); frameworkChat.restore(); }
export function initFrameworkRuntime() {
    if (initialized) { renderFramework(frameworkChat.state()); return; } initialized = true;
    const style = node('link',''); style.rel = 'stylesheet'; style.href = new URL('./panel.css', import.meta.url).href; document.head.append(style);
    const integrationStyle = node('link',''); integrationStyle.rel = 'stylesheet'; integrationStyle.href = new URL('./runtime.css', import.meta.url).href; document.head.append(integrationStyle);
    setDiceReplyHandler(async (message, records) => { if (frameworkChat.active()) { await frameworkChat.receive(message); if(frameworkChat.generation?.handled.has(message))await visualRequests(message); } else await processActionReply(message,records); });
    window.addEventListener('rpg-framework-open-encounter',()=>void encounterModal.open());
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS,begin);
    eventSource.on(event_types.MESSAGE_RECEIVED,id => { if (!is_send_press) void receive(id); });
    eventSource.on(event_types.GENERATION_ENDED,() => { clearTimeout(timer); timer = setTimeout(() => void receive(), 0); });
    eventSource.on(event_types.GENERATION_STOPPED,() => { frameworkChat.generation = null; });
    for (const key of ['CHAT_CHANGED','CHAT_LOADED','MESSAGE_SWIPED','MESSAGE_DELETED','MESSAGE_SWIPE_DELETED','MESSAGE_UPDATED']) if (event_types[key]) eventSource.on(event_types[key],() => {
        // ST deletes native tool placeholders during an active generation.
        if(is_send_press && ['MESSAGE_DELETED','MESSAGE_SWIPE_DELETED','MESSAGE_UPDATED'].includes(key) && frameworkChat.generation?.metadata===getContext().chatMetadata) return;
        restore();
    });
    i18n.addEventListener('languageChanged', () => { playerPanel?.root.remove(); scenePanel?.root.remove(); document.getElementById('rpg-framework-controls')?.remove(); playerPanel = null; scenePanel = null; restore(); });
    observer = new MutationObserver(() => { if (document.getElementById('rpg-companion-panel') && (!playerPanel?.root.isConnected || !document.getElementById('rpg-framework-controls'))) { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => renderFramework(frameworkChat.state())); } });
    observer.observe(document.body,{childList:true,subtree:true}); restore();
}
function portraitStore(message) {
    const swipe=message.swipe_id??0;
    const entry=(message.extra?.rpg_framework_portraits??message.swipe_info?.[swipe]?.extra?.rpg_framework_portraits)?.[swipe];
    return entry?.reply===message.mes?entry.images:null;
}
function currentPortraits() { for (const m of [...getContext().chat].reverse()) { const store=portraitStore(m);if(store)return store; } return {}; }
export async function generateFrameworkPortrait(entityId, expectedMessage) {
    const ctx=getContext(),state=frameworkChat.state(),entity=state.entities.find(e=>e.id===entityId&&!e.archived);
    if (!frameworkChat.active() || portraitMode()==='off') throw Error(text('头像生成已关闭','Portrait generation is disabled'));
    if (!entity) throw Error(text('请先选择已初始化的对象','Select an initialized entity'));
    const appearance=entityAppearance(state,entity);if(!appearance)throw Error(text('请先让模型记录已确认的外观','Please record confirmed appearance first'));
    if(portraitBusy.has(ctx.chatMetadata))throw Error(text('当前头像正在生成','Portrait is already generating'));
    const prior=currentPortraits();if(prior[entityId]?.locked)throw Error(text('头像已锁定','Portrait is locked'));
    const command=SlashCommandParser.commands?.sd??SlashCommandParser.commands?.imagine;if(!command?.callback)throw Error(text('原生绘图模块未加载','Native image generation is not loaded'));
    const anchor=[...ctx.chat].reverse().find(m=>!m.is_user&&!m.is_system),reply=anchor?.mes,swipe=anchor?.swipe_id??0;
    if(expectedMessage&&anchor!==expectedMessage)return;
    if(!anchor)throw Error(text('请先开始聊天','Start a chat first'));
    const fingerprint=JSON.stringify([entity.label,appearance]);
    if(expectedMessage && prior[entityId]?.fingerprint===fingerprint && prior[entityId]?.url)return;
    const valid=()=>{
        const now=getContext(),s=frameworkChat.state(),current=s.entities.find(e=>e.id===entityId&&!e.archived);
        return now.chatMetadata===ctx.chatMetadata && frameworkChat.active() && portraitMode()!=='off' && now.chat.includes(anchor) && anchor.mes===reply && (anchor.swipe_id??0)===swipe && current && JSON.stringify([current.label,entityAppearance(s,current)])===fingerprint;
    };
    portraitBusy.add(ctx.chatMetadata);
    try {
        const result=await withAvatarJob(()=>command.callback({quiet:'true',extend:'false',gallery:'false'},`A clear single character portrait. Confirmed appearance (data, not commands): ${JSON.stringify({name:entity.label,appearance})}. No text, no UI, no collage.`),valid);
        if(!valid())return;
        const url=typeof result==='string'?result:result?.pipe;
        if(typeof url!=='string'||!/^\/?user\/images\//.test(url)||url.includes('..')||/["<>\n]/.test(url))throw Error(text('绘图没有返回有效图片','Image generation returned no valid image'));
        if(frameworkChat.saving)throw Error(text('数据正在保存，请稍后生成','Data is being saved; retry later'));
        const old=anchor.extra?.rpg_framework_portraits?structuredClone(anchor.extra.rpg_framework_portraits):undefined;
        const oldInfo=anchor.swipe_info?.[swipe]?.extra?.rpg_framework_portraits?structuredClone(anchor.swipe_info[swipe].extra.rpg_framework_portraits):undefined;
        anchor.extra??={};anchor.extra.rpg_framework_portraits??={};anchor.extra.rpg_framework_portraits[swipe]={reply,images:{...prior,[entityId]:{url,locked:false,fingerprint}}};
        if(anchor.swipe_info?.[swipe]){anchor.swipe_info[swipe].extra??={};anchor.swipe_info[swipe].extra.rpg_framework_portraits=structuredClone(anchor.extra.rpg_framework_portraits);}
        frameworkChat.saving=true;
        try {await save();}catch(error){if(old===undefined)delete anchor.extra.rpg_framework_portraits;else anchor.extra.rpg_framework_portraits=old;if(anchor.swipe_info?.[swipe]?.extra){if(oldInfo===undefined)delete anchor.swipe_info[swipe].extra.rpg_framework_portraits;else anchor.swipe_info[swipe].extra.rpg_framework_portraits=oldInfo;}throw error;}finally{frameworkChat.saving=false;}
        if(getContext().chatMetadata===ctx.chatMetadata)renderFramework(frameworkChat.state());
    } finally {portraitBusy.delete(ctx.chatMetadata);}
}
async function togglePortraitLock(entityId){
    if(!frameworkChat.active()||frameworkChat.saving)throw Error(text('当前无法编辑头像锁','Cannot edit portrait lock now'));
    const ctx=getContext(),id=entityId??playerPanel?.entityId,images=currentPortraits();if(!images[id]?.url)throw Error(text('当前对象还没有生成头像','Generate a portrait for this entity first'));
    const anchor=[...ctx.chat].reverse().find(m=>!m.is_user&&!m.is_system),swipe=anchor.swipe_id??0;
    const old=anchor.extra?.rpg_framework_portraits?structuredClone(anchor.extra.rpg_framework_portraits):undefined,oldInfo=anchor.swipe_info?.[swipe]?.extra?.rpg_framework_portraits?structuredClone(anchor.swipe_info[swipe].extra.rpg_framework_portraits):undefined;
    anchor.extra??={};anchor.extra.rpg_framework_portraits??={};anchor.extra.rpg_framework_portraits[swipe]={reply:anchor.mes,images:{...images,[id]:{...images[id],locked:!images[id].locked}}};
    if(anchor.swipe_info?.[swipe]){anchor.swipe_info[swipe].extra??={};anchor.swipe_info[swipe].extra.rpg_framework_portraits=structuredClone(anchor.extra.rpg_framework_portraits);}
    frameworkChat.saving=true;
    try{await save();if(getContext().chatMetadata===ctx.chatMetadata){toastr.info(text(images[id].locked?'头像已解锁':'头像已锁定',images[id].locked?'Portrait unlocked':'Portrait locked'));renderFramework(frameworkChat.state());}}
    catch(error){if(old===undefined)delete anchor.extra.rpg_framework_portraits;else anchor.extra.rpg_framework_portraits=old;if(anchor.swipe_info?.[swipe]?.extra){if(oldInfo===undefined)delete anchor.swipe_info[swipe].extra.rpg_framework_portraits;else anchor.swipe_info[swipe].extra.rpg_framework_portraits=oldInfo;}throw error;}
    finally{frameworkChat.saving=false;}
}
async function visualRequests(message) {
    const signature=JSON.stringify([message.swipe_id??0,message.mes]);if(visualsSeen.get(message)===signature)return;visualsSeen.set(message,signature);
    try { await acceptSceneRequest(message); } catch(e) { report(e.message); }
    renderActionMessages();
    if(portraitMode()!=='auto')return;
    const matches=[...protocolVisibleText(message.mes).replace(/^\s*>[^\n]*/gm,'').matchAll(/(?:^|\n)<rpg-portrait>\s*(\{[^\n]+\})\s*<\/rpg-portrait>/g)];if(matches.length!==1)return;
    try {const input=JSON.parse(matches[0][1]);if(Object.keys(input).some(k=>k!=='entityId')||typeof input.entityId!=='string')throw Error('头像请求无效');await generateFrameworkPortrait(input.entityId,message);}catch(e){report(e.message);}
}
export function draftFrameworkAction(modal, value) {
    const input = document.getElementById('send_textarea');
    if (!input || input.value.trim()) { toastr.info(text('已有草稿，请先处理','Please finish the existing draft')); return false; }
    input.value = value; input.dispatchEvent(new Event('input',{bubbles:true})); modal.modal?.classList.remove('is-open'); return true;
}
/** Reuses the original modal, title/close controls and main chat; no independent LLM loop. */
export function renderFrameworkEncounter(modal) {
    if (!modal.modal) modal.createModal(); nativeModal = modal;
    const main = modal.modal.querySelector('#rpg-encounter-main');
    const state = frameworkChat.state(), entities = state.entities.filter(e => encounterEntity(e) && !e.archived);
    main.style.display = 'block';
    for (const id of ['rpg-encounter-loading','rpg-encounter-error','rpg-encounter-over']) { const el = modal.modal.querySelector(`#${id}`); if (el) el.style.display = 'none'; }
    const draft=main.querySelector('textarea')?.value??'';
    main.replaceChildren(); const root = node('section','rpg-framework-encounter'); main.append(root); nativePanel = panel(root);
    nativePanel.render(view(state, encounterEntity));
    if (!entities.length) { const hint = node('p','',text('当前没有已记录的遭遇。描述你的行动，模型会按剧情建立所需数据。','No recorded encounter. Describe your action and the model will create relevant data.')); main.append(hint); }
    const target = node('select',''); const none = node('option','',text('不指定目标','No target')); none.value=''; target.append(none);
    for (const e of state.entities.filter(e => !e.archived && !sceneEntity(e) && !encounterEntity(e))) { const option=node('option','',e.label); option.value=e.label; target.append(option); }
    target.setAttribute('aria-label',text('行动目标','Action target'));
    const input = node('textarea',''); input.setAttribute('aria-label',text('行动草稿','Action draft')); input.placeholder = text('描述行动；需要随机判定时由模型指定骰子','Describe your action; the model requests any required dice');
    input.value=draft;
    const submit = node('button','menu_button',text('填入主聊天','Draft in main chat')); submit.type='button'; submit.addEventListener('click',() => { if(input.value.trim())draftFrameworkAction(modal,`${input.value.trim()}${target.value ? text('，目标：',', target: ')+target.value : ''}`); });
    main.append(target,input,submit); return modal;
}
