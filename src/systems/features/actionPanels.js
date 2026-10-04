import { actionState,actionData,saveActionSnapshot,latestActionMessage,activePortrait } from './actionStore.js';
import { i18n } from '../../core/i18n.js';
export const tr=(key)=>i18n.getTranslation('actions.'+key)||key;
let playerToolsRenderer=null;
export function setPlayerToolsRenderer(fn){playerToolsRenderer=fn;}
export function node(tag,cls='',text='') {const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;}
export function actionButton(text,run) {const b=node('button','rpg-action-button',text);b.type='button';b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();void run();});return b;}
export function resourcesPanel(pid,editable=true) {
    const resources=actionState().resources[pid];if(!resources)return null;
    const panel=node('details','rpg-action-resources');panel.append(node('summary','',tr('resources')));
    const parts=[];
    parts.push(`HP ${resources.hp?`${resources.hp.current}/${resources.hp.max}`:tr('unknown')}`);
    parts.push(`AC ${resources.ac??tr('unknown')}`);
    if(resources.spellSlots)for(const [level,slot] of Object.entries(resources.spellSlots))parts.push(`${tr('slots')} ${level}：${slot.current}/${slot.max}`);
    if(resources.concentration)parts.push(`${tr('concentration')}：${resources.concentration}`);
    if(resources.conditions)parts.push(`${tr('conditions')}：${resources.conditions.join('、')||tr('none')}`);
    panel.append(node('div','rpg-action-resource-values',parts.join(' · ')));
    if(editable)panel.append(actionButton(actionData()?.locks?.[pid]===true?tr('unlock'):tr('lock'),()=>{
        const data=actionData(true);if(data.locks[pid]===true)delete data.locks[pid];else data.locks[pid]=true;
        saveActionSnapshot(latestActionMessage(),actionState());window.dispatchEvent(new Event('rpg-actions-render'));
    }));
    return panel;
}
export function decorateNpcResources() {
    document.querySelectorAll('.rpg-character-card').forEach(card=>{
        card.querySelector('.rpg-action-resources')?.remove();
        const member=actionState().encounter?.participants.find(p=>p.actorType==='npc'&&p.name===card.dataset.characterName);
        if(!member)return;const panel=resourcesPanel(member.id);if(panel)(card.querySelector('.rpg-balanced-npc-status')??card).append(panel);
    });
}
export function decoratePlayerPortrait() {
    const portrait=document.querySelector('#rpg-user-stats .rpg-user-portrait');
    const url=activePortrait()?.url;if(portrait&&url)portrait.src=url;
    playerToolsRenderer?.();
}
