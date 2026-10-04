/** Adapt the original EncounterModal UI to the main chat, without a second LLM loop. */
import { getContext } from '../../../../../../extensions.js';
import { extensionSettings } from '../../core/state.js';
import { updateCurrentEncounter,resetEncounter } from './encounterState.js';
import { actionState,actionData,saveActionSnapshot,latestActionMessage } from './actionStore.js';
import { currentDiceData } from './dice.js';
import { resumeEncounterRolls } from './diceRequests.js';
import { tr,node,actionButton } from './actionPanels.js';
import { showPortraitPreview } from '../ui/portraitPreview.js';
let instance=null,requestStart=null;
export function setNativeStartHandler(fn){requestStart=fn;}
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function nativeCombatView(state) {
    const battle=state.encounter;if(!battle)return null;
    const member=p=>{const r=state.resources[p.id]??{};return {name:escape(p.name),isPlayer:p.actorType==='player',hp:r.hp?.current??null,maxHp:r.hp?.max??null,statuses:(r.conditions??[]).map(name=>({name:escape(name),emoji:'•'}))};};
    return {party:battle.participants.filter(p=>p.side!=='enemy').map(member),enemies:battle.participants.filter(p=>p.side==='enemy').map(member),environment:escape(battle.reason)};
}
export function closeNativeEncounter(modal){modal.modal?.classList.remove('is-open');}
export function hideNativeEncounter(){if(instance)closeNativeEncounter(instance);resetEncounter();}
export function draftNativeAction(modal,text) {
    const b=actionState().encounter;
    if(!b||['ended','proposed','awaiting_initiative','awaiting_roll','awaiting_settlement'].includes(b.phase)){toastr.info(tr('waitRoll'));return false;}
    const input=document.getElementById('send_textarea');if(!input)return false;
    if(input.value.trim()){toastr.info(tr('draftPreserved'));return false;}
    input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));closeNativeEncounter(modal);toastr.info(tr('draftReady'));return true;
}
export function openNativeEncounter(modal) {
    if(!extensionSettings.enabled||!getContext().chat?.length)return;
    instance=modal;
    const b=actionState().encounter;
    if(!b||b.phase==='ended'){requestStart?.();return;}
    if(!modal.modal)modal.createModal();
    refreshNativeEncounter();modal.modal.classList.add('is-open');
}
export function refreshNativeEncounter() {
    if(!instance?.modal)return;
    const state=actionState(),b=state.encounter;if(!b||!extensionSettings.enabled){hideNativeEncounter();return;}
    const m=instance,view=nativeCombatView(state);
    // Original renderers interpolate HTML. Only validated, escaped text reaches them.
    const actions=b.playerActions??{attacks:[],items:[]};
    updateCurrentEncounter({active:b.phase!=='ended',initialized:true,combatStats:view,playerActions:{attacks:(actions.attacks??[]).map(a=>({...a,name:escape(a.name)})),items:(actions.items??[]).map(escape)}});
    const draft=m.modal.querySelector('#rpg-encounter-custom-input')?.value??'';
    m.renderCombatUI(view);
    m.modal.querySelectorAll('.rpg-encounter-card img').forEach(img=>{img.tabIndex=0;img.setAttribute('role','button');img.addEventListener('click',()=>showPortraitPreview(img.src,img.alt));img.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();img.click();}});});
    const field=m.modal.querySelector('#rpg-encounter-custom-input');if(field)field.value=draft;
    const top=node('div','rpg-native-phase',`${tr(b.phase)} · ${tr('round')} ${b.round}`);
    if(b.initiative?.length)top.append(node('div','',`${tr('order')}：${b.initiative.map(i=>`${b.participants.find(p=>p.id===i.id)?.name} ${i.total}`).join(' → ')}`));
    for(const p of b.participants){const r=state.resources[p.id]??{};const slots=Object.entries(r.spellSlots??{}).map(([k,v])=>`${k}：${v.current}/${v.max}`).join('、');top.append(node('small','',`${p.name} · AC ${r.ac??'?'}${slots?` · ${tr('slots')} ${slots}`:''}${r.concentration?` · ${tr('concentration')} ${r.concentration}`:''}`));}
    for(const ref of b.pending??[]){const r=currentDiceData()?.records?.find(r=>r.key===ref.key);if(r)top.append(node('small','',`${r.request.actor} · ${r.request.reason}：${r.status==='resolved'?r.result.total:tr('pending')} · ${r.delivered?tr('delivered'):tr('notDelivered')}`));}
    if(b.phase==='proposed')top.append(actionButton(tr('accept'),async()=>{
        b.phase=b.pending.some(p=>p.kind==='initiative')?'awaiting_initiative':b.pending.length?'awaiting_roll':'active';saveActionSnapshot(latestActionMessage(),state);
        try{await resumeEncounterRolls(b.pending.map(p=>p.key));}catch(e){toastr.warning(e.message);}window.dispatchEvent(new Event('rpg-actions-render'));
    }));
    top.append(node('small','',tr('rollInChat')));m.modal.querySelector('#rpg-encounter-main').prepend(top);
    const enabled=b.phase==='active';m.modal.querySelectorAll('.rpg-encounter-action-btn,#rpg-encounter-custom-submit,#rpg-encounter-conclude').forEach(e=>e.disabled=!enabled);
    for(const row of b.log??[])m.addToLog(row.text,'narrative');
    if(b.phase==='ended'){
        m.showCombatOverScreen(b.result);m.updateCombatOverScreen(true);
        const p=m.modal.querySelector('.rpg-encounter-over p');if(p)p.textContent=b.summary;
    }
}
