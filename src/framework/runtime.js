/** SillyTavern boundary. Game definitions stay in the chat, never account settings. */
import { getContext } from '../../../../../extensions.js';
import { eventSource, event_types, setExtensionPrompt, extension_prompt_types, extension_prompt_roles, updateMessageBlock, is_send_press, user_avatar, getThumbnailUrl, generateRaw } from '../../../../../../script.js';
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
import { SlashCommandParser } from '../../../../../slash-commands/SlashCommandParser.js';
import { encounterModal } from '../systems/ui/encounterUI.js';
import { preserveBalancedDice } from '../systems/ui/balancedLayout.js';
import { withAvatarJob } from '../systems/features/avatarQueue.mjs';
import { FrameworkObservations, reviewFrameworkChat, frameworkDiagnosticLabel, frameworkSceneWarnings } from './diagnostics.mjs';
import { readRepair } from './repair.mjs';
import { FrameworkMedia, mediaTargets, readMedia, safeMediaUrl, coverageIssues } from './media.mjs';

let initialized = false, playerPanel, scenePanel, nativePanel, nativeModal, timer, observer, frame, panelContext;
let mediaView = new Map();

const visualsSeen = new WeakMap();
const node = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e; };
const zh = () => i18n.currentLanguage.startsWith('zh');
const text = (a,b) => zh() ? a : b;
const save = () => saveFrameworkVerified(getContext());
const observations = new FrameworkObservations();
const report = message => { toastr.warning(message, text('通用 RPG 框架','Universal RPG framework')); const el = document.getElementById('rpg-framework-feedback'); if (el) el.textContent = message; };
export const frameworkChat = new FrameworkChat({ getContext, save, enabled: () => !!extensionSettings.enabled, render: renderFramework, report,
    observe: (message, event) => { observations.record(message, event); renderDiagnostics(); },
    // Call once directly; the generic wrapper can issue an unbudgeted fallback.
    generateRepair: prompt => generateRaw({ prompt, quietToLoud: false, responseLength: 4096, trimNames: false }),
    repairLimit: () => getContext().chatMetadata?.rpg_framework_v1?.repairAttempts ?? 2,
    sceneReviewMode: () => getContext().chatMetadata?.rpg_framework_v1?.sceneReviewMode ?? 'noop',
    repairStatus: () => { if(playerPanel)renderFramework(frameworkChat.state());else {renderRepairStatus();renderDiagnostics();} },
});

function renderRepairStatus() {
    const host = document.getElementById('rpg-framework-repair-status'); if (!host) return;
    host.replaceChildren();
    const ctx = getContext(), message = ctx.chat.at(-1), repair = readRepair(message);
    const job = frameworkChat.repairJob;
    if (job?.metadata === ctx.chatMetadata && job.message === message) {
        host.append(node('small', '', text(job.cancelled ? '已停止后续请求，正在丢弃过期结果。' : readRepair(message)?.purpose === 'review' ? '正在后台复核场景与角色…' : '正在后台修正面板数据…', job.cancelled ? 'Stopped; pending output will be discarded.' : readRepair(message)?.purpose === 'review' ? 'Reviewing scene and characters…' : 'Correcting panel data in the background…')));
        const cancel = node('button', 'menu_button', text('停止纠错', 'Stop correction')); cancel.type = 'button'; cancel.disabled = job.cancelled;
        cancel.addEventListener('click', () => frameworkChat.cancelRepair()); host.append(cancel); return;
    }
    if (!repair) return;
    if (frameworkChat.uncertainSaves.has(message)) { host.append(node('small','',text('保存结果尚未确认；请重新加载聊天核实，暂不重复纠错。','Save status is uncertain. Reload the chat to verify before retrying.'))); return; }
    host.append(node('small', '', repair.status === 'checked' ? text('本轮场景与角色已复核，模型未报告额外变化。','Scene and characters checked; the model reported no additional changes.') : repair.status === 'corrected'
        ? repair.purpose==='review' ? text('场景与角色补充已保存；可在诊断中审查。','Scene and character additions saved; review them in diagnostics.') : repair.purpose==='coverage' ? text('补齐提交已保存；请查看是否还有缺项。','Completion saved; check for any remaining gaps.') : text(`面板数据已自动修正 · ${repair.attempts.length} 次请求`, `Panel data corrected · ${repair.attempts.length} requests`)
        : text('面板纠错或补齐未完成，仍使用之前的数据。', 'Correction or completion incomplete; the previous data remains active.')));
    if (!['corrected','checked'].includes(repair.status)) {
        const retry = node('button', 'menu_button', text('重新纠错', 'Retry correction')); retry.type = 'button';
        retry.disabled = !!frameworkChat.repairJob || is_send_press;
        retry.title = text('额外请求模型，最多两次；不会添加玩家发言。','Requests up to two additional model calls without a player message.');
        retry.addEventListener('click', () => { if (!is_send_press) void (repair.purpose==='review'?frameworkChat.reviewScene():repair.purpose==='coverage'?frameworkChat.completeMissing():frameworkChat.retryRepair(message)); }); host.append(retry);
    }
}

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
        if (row.operation) item.append(node('small', '', `${text('操作','Operation')} ${row.operation} · ${row.fieldId ?? ''} · ${row.fieldType ?? ''}`));
        if (row.repair) {
            item.append(node('small', '', `${text('后台纠错','Background correction')}: ${row.repair.status} · ${row.repair.attempts} ${text('次请求','requests')}`));
            const record = readRepair(getContext().chat[row.message-1]);
            const details = node('details',''); details.append(node('summary','',text('查看纠错记录（含本聊天原始数据）','Review correction record (includes private chat data)')));
            details.append(node('pre','',JSON.stringify(record,null,2))); item.append(details);
        }
        if (row.message === getContext().chat.length && ['parse_rejected','validation_rejected','missing_protocol','no_protocol'].includes(row.status) && frameworkChat.active() && getContext().chat.slice(0,-1).some(m=>m.is_user)) {
            const message = getContext().chat[row.message-1];
            const retry = node('button','menu_button',text('后台修正此回复','Correct this reply in the background')); retry.type = 'button';
            retry.disabled = is_send_press || !!frameworkChat.repairJob || frameworkChat.saving || frameworkChat.uncertainSaves.has(message);
            retry.title = text('最多两次额外文字请求；保留剧情，不添加玩家发言。','Up to two extra text calls; keeps the story and adds no player message.');
            retry.addEventListener('click',()=>{ if (!is_send_press) void frameworkChat.retryRepair(message); }); item.append(retry);
        }
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
const portraitMode = () => getContext().chatMetadata?.rpg_framework_v1?.mediaMode ?? actionPreference('portraitMode',extensionSettings.playerPortraitMode??'manual');
export const frameworkMedia = new FrameworkMedia({
    getContext, state:()=>frameworkChat.state(), active:()=>frameworkChat.active(), mode:portraitMode,
    blocked:()=>!!(is_send_press||frameworkChat.saving||frameworkChat.repairJob),
    generate:(prompt,valid)=>withAvatarJob(async()=>{
        const command=SlashCommandParser.commands?.sd??SlashCommandParser.commands?.imagine;
        if(!command?.callback)throw Error('Native image module unavailable');
        const result=await command.callback({quiet:'true',extend:'false',gallery:'false'},prompt);
        return typeof result==='string'?result:result?.pipe;
    },valid),
    persist:async()=>{frameworkChat.saving=true;try{await save();}finally{frameworkChat.saving=false;}},
    render:()=>renderFramework(frameworkChat.state()),
});
function renderMediaTarget(host,key,entity=false) {
    const target=mediaView.get(key);if(!target)return;
    const entry=readMedia(getContext().chat)[key],busy=frameworkMedia.job?.key===key;
    const wrap=node('span','uf-media-controls');
    if(!entity&&safeMediaUrl(entry?.url)){
        const img=node('img','uf-media-icon');img.src=entry.url;img.alt=target.label;img.loading='lazy';
        img.addEventListener('error',()=>img.remove(),{once:true});wrap.append(img);
    }
    const stale=entry?.url&&(entry.imageFingerprint??entry.fingerprint)!==target.fingerprint;
    const status=busy?text('生成中','Generating'):target.pending?text('外观待确认','Appearance pending')
        :target.locked||entry?.locked?text('已锁定','Locked'):portraitMode()==='off'?text('生成关闭','Disabled')
        :entry?.status==='failed'?text('生成失败','Failed'):entry?.status==='requesting'?text('上次未完成','Interrupted')
        :stale?text('外观已变化','Appearance changed'):entry?.url?text('已生成','Generated')
        :portraitMode()==='proposal'?text('建议生成','Proposed'):text('待生成','Pending');
    const label=node('small','uf-media-state',status);label.title=target.pending||target.description;wrap.append(label);
    const action=(cn,en,handler)=>{const b=node('button','uf-subtle',text(cn,en));b.type='button';b.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();b.disabled=true;try{await handler();}catch{report(text('配图操作未确认完成，请查看状态；必要时重载聊天核验。','Media operation was not confirmed; review the status and reload to verify if needed.'));}finally{b.disabled=false;}});wrap.append(b);return b;};
    if(safeMediaUrl(entry?.url))action('查看','View',()=>{
        const dialog=node('dialog','uf-media-dialog'),img=node('img','');img.src=entry.url;img.alt=target.label;
        const close=node('button','menu_button',text('关闭','Close'));close.type='button';close.onclick=()=>dialog.close();
        dialog.append(img,close);dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
    });
    const generate=action(entry?.url?'刷新':'生成',entry?.url?'Refresh':'Generate',()=>frameworkMedia.run(key,{refresh:true}));
    generate.disabled=!!(target.pending||target.locked||entry?.locked||portraitMode()==='off'||frameworkMedia.job||is_send_press||frameworkChat.saving||frameworkChat.repairJob||frameworkMedia.uncertain.has(getContext().chat.at(-1)));
    generate.title=text('使用原生绘图模块生成一张图片','Generate one image with the native image module');
    if(entry?.url){const lock=action(entry.locked?'解锁':'锁图',entry.locked?'Unlock':'Lock',()=>frameworkMedia.toggleLock(key));lock.disabled=!!frameworkMedia.job;}
    if(busy){const stop=action('停止','Stop',()=>frameworkMedia.cancel());stop.title=text('停止后续请求并丢弃返回结果；已发出的请求仍可能计费。','Stop further requests and discard pending output; an existing request may still be billed.');}
    host.append(wrap);
}
function renderCoverage(state) {
    let host=document.getElementById('rpg-framework-coverage');
    if(!host){host=node('details','uf-coverage');host.id='rpg-framework-coverage';playerPanel.root.before(host);}
    const missing=coverageIssues(state),pending=state.entities.filter(e=>!e.archived&&e.visual?.pending);
    host.replaceChildren();host.hidden=!missing.length&&!pending.length;
    host.append(node('summary','',text(`记录待补齐 ${missing.length} · 外观待确认 ${pending.length}`,`Missing records ${missing.length} · Deferred appearances ${pending.length}`)));
    const labels={initialization:text('初始化','Initialization'),scene_missing:text('当前场景','Current scene'),scene_details:text('地点与动态','Location and activity'),appearance:text('外观','Appearance'),portrait_intent:text('头像意图','Portrait intent')};
    for(const issue of missing)host.append(node('small','',`${issue.label} · ${labels[issue.code]}`));
    for(const e of pending)host.append(node('small','',`${e.label} · ${e.visual.pending}`));
    if(missing.length){
        const button=node('button','menu_button',text('后台补齐缺项（1次文字请求）','Complete missing records (1 text request)'));button.type='button';
        button.disabled=!!(is_send_press||frameworkChat.saving||frameworkChat.repairJob||frameworkMedia.job||!getContext().chat.at(-1)||getContext().chat.at(-1)?.is_user);
        button.addEventListener('click',async()=>{button.disabled=true;try{if(!await frameworkChat.completeMissing())report(text('补齐未完成；请先处理未提交回复，并查看数据更新诊断。','Completion did not finish. Resolve any rejected reply and review diagnostics.'));}finally{renderFramework(frameworkChat.state());}});host.append(button);
    }
}
const encounterMode = () => extensionSettings.encounterSettings?.enabled===false ? 'manual' : actionPreference('encounterMode',extensionSettings.modelEncounterMode??'proposal');
function view(state, predicate) { return { ...state, entities: state.entities.filter(predicate) }; }
function portrait(entity) {
    const ctx = getContext();
    const stored = readMedia(ctx.chat)[`entity:${entity.id}`] ?? currentPortraits()[entity.id];
    if (entity.visual?.mode === 'none') return null;
    if (safeMediaUrl(stored?.url)) return stored.url;
    if (entity.kind === 'player' && user_avatar) return getThumbnailUrl('persona', user_avatar);
    const character = ctx.characters?.find(c => c.name === entity.label);
    return character?.avatar ? ctx.getThumbnailUrl?.('avatar', character.avatar) : null;
}
function panel(root) { return new FrameworkPanel(root, { language: zh() ? 'zh' : 'en', getPortrait: portrait, onOperation: op => frameworkChat.manual([op]) }); }
function roster(root, side) { return new FrameworkRoster(root, {
    language: zh() ? 'zh' : 'en', side, getPortrait: portrait, renderMedia: renderMediaTarget,
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
        // These preferences share one metadata save; prevent overlapping changes.
        const changePreference = async (operation, failure) => {
            const metadata = getContext().chatMetadata;
            const selects = [...controls.querySelectorAll('select')];
            for (const control of selects) control.disabled = true;
            const status = controls.querySelector('#rpg-framework-feedback');
            if (status) status.textContent = text('正在保存聊天设置…','Saving chat settings…');
            try {
                await operation();
                if (getContext().chatMetadata === metadata) renderFramework(frameworkChat.state());
            } catch {
                if (getContext().chatMetadata === metadata) report(failure);
            } finally {
                for (const control of selects) control.disabled = false;
            }
        };
        const label = node('label','',text('本聊天数据框架','Chat data framework')), select = node('select',''); select.id = 'rpg-framework-mode';
        for (const [value,name] of [['universal',text('通用：模型定义分类','Universal: model-defined')],['legacy',text('兼容：原版记录','Legacy trackers')]]) { const o = node('option','',name); o.value = value; select.append(o); }
        select.addEventListener('change', () => changePreference(async () => { incrementSeparateGenerationId(); await frameworkChat.setMode(select.value); await eventSource.emit(event_types.CHAT_LOADED); }, text('模式保存失败','Could not save mode')));
        label.append(select); controls.append(label);
        const repairLabel = node('label','',text('后台自动纠错','Background correction')), repairSelect = node('select',''); repairSelect.id = 'rpg-framework-repair-limit';
        for (const value of [0,1,2]) { const o = node('option','',value ? text(`最多 ${value} 次额外文字请求`,`Up to ${value} extra text requests`) : text('关闭','Off')); o.value = String(value); repairSelect.append(o); }
        repairSelect.addEventListener('change', () => changePreference(async () => { try { await frameworkChat.setRepairLimit(Number(repairSelect.value)); } finally { repairSelect.value = String(frameworkChat.repairLimit()); } }, text('纠错设置保存失败','Could not save correction settings')));
        repairLabel.append(repairSelect); controls.append(repairLabel);
        const reviewLabel=node('label','',text('场景与角色复核','Scene and character review')),reviewSelect=node('select','');reviewSelect.id='rpg-framework-scene-review';
        for(const [value,cn,en] of [['noop','无变化回执后复核','Review no-change receipts'],['all','每轮复核','Review every reply'],['off','关闭自动复核','No automatic review']]){const o=node('option','',text(cn,en));o.value=value;reviewSelect.append(o);}
        reviewSelect.addEventListener('change',()=>changePreference(()=>frameworkChat.setSceneReviewMode(reviewSelect.value),text('复核设置保存失败','Could not save review settings')));
        reviewLabel.append(reviewSelect);controls.append(reviewLabel,node('small','',text('复核最多额外1次文字请求，受自动纠错开关限制；不改资金、物品或玩家资产。','Review uses at most one extra text call and respects the correction switch; it cannot change money, items or player assets.')));
        const reviewButton=node('button','menu_button',text('复核本轮场景与角色（1次文字请求）','Review this scene and cast (1 text call)'));reviewButton.id='rpg-framework-review-now';reviewButton.type='button';
        reviewButton.addEventListener('click',async()=>{reviewButton.disabled=true;try{await frameworkChat.reviewScene();}finally{renderFramework(frameworkChat.state());}});controls.append(reviewButton);
        const mediaLabel=node('label','',text('本聊天头像与图标','Chat portraits and icons')),mediaSelect=node('select','');mediaSelect.id='rpg-framework-media-mode';
        for(const [value,cn,en] of [['manual','手动生成','Manual'],['proposal','列出提议，点击生成','Propose; click to generate'],['auto','自动（每轮最多两张）','Automatic (up to two per turn)'],['off','关闭生成','Disabled']]){const o=node('option','',text(cn,en));o.value=value;mediaSelect.append(o);}
        mediaSelect.addEventListener('change', () => changePreference(async () => { try { frameworkMedia.cancel(); await frameworkChat.setMediaMode(mediaSelect.value); } finally { mediaSelect.value = portraitMode(); } }, text('配图设置保存失败','Could not save media settings')));
        mediaLabel.append(mediaSelect);controls.append(mediaLabel,node('small','',text('与场景图模式分开；切换模式不会立即绘图。','Separate from scene images; changing mode does not generate images.')));

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
    controls.querySelector('#rpg-framework-media-mode').value = portraitMode();
    controls.querySelector('#rpg-framework-repair-limit').value = String(frameworkChat.repairLimit());
    controls.querySelector('#rpg-framework-scene-review').value = frameworkChat.sceneReviewMode();
    controls.querySelector('#rpg-framework-review-now').disabled = !!(is_send_press||frameworkChat.saving||frameworkChat.repairJob||frameworkMedia.job||frameworkChat.uncertainSaves.has(getContext().chat.at(-1))||!getContext().chat.at(-1)?.extra?.rpg_framework_swipes);
    if (!document.getElementById('rpg-framework-repair-status')) {
        const status = node('div','uf-repair-status'); status.id = 'rpg-framework-repair-status'; status.setAttribute('role','status'); playerPanel.root.before(status);
    }
}
function renderFramework(state, info = {}) {
    if (panelContext !== getContext().chatMetadata) {
        document.getElementById('rpg-framework-coverage')?.remove();
        playerPanel?.root.remove(); scenePanel?.root.remove(); playerPanel = null; scenePanel = null;
        panelContext = getContext().chatMetadata;
    }
    mount(); const active = frameworkChat.active();
    document.getElementById('rpg-companion-panel')?.classList.toggle('rpg-framework-active', active);
    preserveBalancedDice();
    if (!active || !playerPanel || !state) return;
    mediaView = new Map(mediaTargets(state).map(t=>[t.key,t]));
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
        const battle = !info.repaired && state.entities.find(e => encounterEntity(e) && !e.archived);
        if (battle && !frameworkChat.generation?.before.entities.some(e=>e.id===battle.id&&!e.archived)) {
            if (encounterMode() === 'auto') window.dispatchEvent(new Event('rpg-framework-open-encounter'));
            else if (encounterMode() === 'proposal') toastr.info(text('遭遇已记录，可打开原遭遇窗口查看与行动','Encounter recorded. Open the encounter window to act.'));
        }
    }
    if (nativePanel && nativeModal?.modal.classList.contains('is-open')) renderFrameworkEncounter(nativeModal);
    renderDiagnostics();
    renderRepairStatus();
    renderCoverage(state);
}
function begin(type, data, dryRun) {
    const ctx = getContext();
    const suppressed = !!(data?.quietImage || data?.quiet_image || data?.isImageGeneration || data?.quiet_prompt || data?.quietPrompt || evaluateSuppression(extensionSettings,ctx,data).shouldSuppress);
    if(!suppressed&&!dryRun&&!['quiet','impersonate','continue'].includes(type))frameworkMedia.cancel();
    let prompt = '';
    try { prompt = frameworkChat.begin(type, { suppressed, dryRun }); } catch { report(text('游戏数据损坏，已停止注入','Invalid game data; injection stopped')); }
    if (prompt) prompt += `\n遭遇界面模式：${encounterMode()}。auto可在真实遭遇开始时打开原遭遇窗口，proposal只提示，manual仅由玩家打开；任意规则数据仍由上面的框架管理。骰子使用独立rpg_dice_check/rpg-roll协议，由程序提供结果。场景图模式：${sceneImageMode()}，仅proposal/auto允许在场景/人物/主要动态显著改变后输出一个<rpg-scene>{"change":"action","summary":"此刻公开可见的画面"}</rpg-scene>，change可为location/cast/action，复用原生绘图，不把URL写入游戏字段。通用配图模式：${portraitMode()}。使用框架visual声明头像/图标意图，不另输出rpg-portrait标签或URL。auto每轮最多两次头像/图标请求，其余留待手动；manual/proposal只列待生成项，off不绘图。场景图使用独立模式。外观和意图无论模式都必须记录。`;
    setExtensionPrompt('rpg-framework',prompt,extension_prompt_types.IN_CHAT,0,false,extension_prompt_roles.SYSTEM);
}
async function receive(id) {
    const messages = getContext().chat;
    if (!frameworkChat.active() || is_send_press) return;
    const message=Number.isInteger(id) ? messages[id] : messages.at(-1);
    await frameworkChat.receive(message);
    renderActionMessages();
    if (frameworkChat.active() && !readRepair(message) && frameworkChat.generation?.handled.has(message)) await visualRequests(message);
}
function restore() { frameworkMedia.cancel(); clearTimeout(timer); frameworkChat.restore(); }
export function initFrameworkRuntime() {
    if (initialized) { renderFramework(frameworkChat.state()); return; } initialized = true;
    const style = node('link',''); style.rel = 'stylesheet'; style.href = new URL('./panel.css', import.meta.url).href; document.head.append(style);
    const integrationStyle = node('link',''); integrationStyle.rel = 'stylesheet'; integrationStyle.href = new URL('./runtime.css', import.meta.url).href; document.head.append(integrationStyle);
    setDiceReplyHandler(async (message, records) => { if (frameworkChat.active()) { await frameworkChat.receive(message); if(!readRepair(message) && frameworkChat.generation?.handled.has(message))await visualRequests(message); } else await processActionReply(message,records); });
    window.addEventListener('rpg-framework-open-encounter',()=>void encounterModal.open());
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS,begin);
    eventSource.on(event_types.MESSAGE_RECEIVED,id => { if (!is_send_press) void receive(id); });
    eventSource.on(event_types.GENERATION_ENDED,() => { clearTimeout(timer); timer = setTimeout(() => void receive(), 0); });
    eventSource.on(event_types.GENERATION_STOPPED,() => { frameworkMedia.cancel(); frameworkChat.cancelRepair(); frameworkChat.generation = null; });
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
    if (expectedMessage && getContext().chat.at(-1)!==expectedMessage) return;
    return frameworkMedia.run(`entity:${entityId}`, {automatic:!!expectedMessage,refresh:!expectedMessage});
}
async function togglePortraitLock(entityId) { return frameworkMedia.toggleLock(`entity:${entityId}`); }
async function visualRequests(message) {
    const signature=JSON.stringify([message.swipe_id??0,message.mes]);if(visualsSeen.get(message)===signature)return;visualsSeen.set(message,signature);
    try { await acceptSceneRequest(message); } catch(e) { report(e.message); }
    renderActionMessages();
    const snapshot=(message.extra?.rpg_framework_swipes??message.swipe_info?.[message.swipe_id??0]?.extra?.rpg_framework_swipes)?.[message.swipe_id??0];
    if(snapshot?.reply===message.mes&&snapshot.state?.revision>frameworkChat.generation?.before.revision)await frameworkMedia.automatic(message);
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
