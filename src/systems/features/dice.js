/** Free rolls are chat-local; model checks use diceRequests.js. */
import { getContext } from '../../../../../../extensions.js';
import { saveChatDebounced, getCurrentChatId } from '../../../../../../../script.js';
import { extensionSettings, setPendingDiceRoll } from '../../core/state.js';
import { i18n } from '../../core/i18n.js';
import { performRoll } from './diceEngine.mjs';
const metadata = () => getContext().chatMetadata;
export function currentDiceData(create=false) {
    const m=metadata();
    if (!m) return null;
    if (!m.rpg_dice_v1 && create) m.rpg_dice_v1={version:1,records:[],lastRoll:null};
    return m.rpg_dice_v1 || null;
}
export function saveFreeRoll(roll) {
    const data=currentDiceData(true); if (!data) throw Error('当前没有可保存的聊天');
    data.lastRoll=roll; saveChatDebounced(); updateDiceDisplay();
}
export async function rollDice(modal) {
    if (!modal || modal.state !== 'IDLE' || !modal.modal.classList.contains('is-open')) return;
    const original=metadata(), chatKey=getCurrentChatId(), token=++modal.sequence;
    try {
        const count=Number($('#rpg-dice-count').val()),sides=Number($('#rpg-dice-sides').val());
        const result=performRoll({id:'free',actor:'玩家',reason:'自由投掷',count,sides});
        setPendingDiceRoll(null); modal.startRolling();
        await new Promise(resolve=>setTimeout(resolve,1200));
        if (modal.sequence !== token || metadata() !== original || getCurrentChatId() !== chatKey || !modal.modal.classList.contains('is-open')) return;
        modal.rollMetadata=original; modal.rollChatKey=chatKey; setPendingDiceRoll(result); modal.showResult(result.total,result.rolls);
    } catch (e) {
        if (modal.sequence === token) { modal._setState('IDLE'); toastr.error(e.message); }
    }
}
export async function executeRollCommand(command) {
    const match=String(command).match(/^\/roll (\d+)d(\d+)$/);
    if (!match) throw Error('仅支持 /roll NdM');
    return performRoll({id:'free',actor:'玩家',reason:'自由投掷',count:Number(match[1]),sides:Number(match[2])});
}
export function updateDiceDisplay() {
    const display=$('#rpg-dice-display');
    if (!extensionSettings.showDiceDisplay) { display.hide(); return; }
    display.show();
    const roll=currentDiceData()?.lastRoll;
    const label=i18n.getTranslation('template.mainPanel.lastRoll') || 'Last Roll: ';
    $('#rpg-last-roll-text').text(roll ? `${label}(${roll.formula}): ${roll.total}` : label+(i18n.getTranslation('global.none') || 'None'));
}
export function clearDiceRoll() {
    const data=currentDiceData(); if (data) { data.lastRoll=null; saveChatDebounced(); }
    updateDiceDisplay();
}
export function addDiceQuickReply() {}
