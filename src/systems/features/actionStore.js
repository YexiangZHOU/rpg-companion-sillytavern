import { stripScenes } from './sceneProtocol.mjs';
import { stripAcceptedPortraits } from '../../framework/visual.mjs';
import { getContext } from '../../../../../../extensions.js';
import { saveChatDebounced } from '../../../../../../../script.js';
import { emptyActions,scanActionBlocks,hideActionBlocks } from './actionProtocol.mjs';
export const cloneAction=x=>JSON.parse(JSON.stringify(x));
export function actionData(create=false) {
    const meta=getContext().chatMetadata;
    if(!meta)return null;
    if(create)meta.rpg_actions_v1??={version:1,state:emptyActions(),locks:{},preferences:{}};
    return meta.rpg_actions_v1??null;
}
export const actionState=()=>actionData()?.state??emptyActions();
export function replyRevision(text) {let h=2166136261;for(const c of String(text))h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(16);}
export function saveActionSnapshot(message,state) {
    const data=actionData(true);data.state=cloneAction(state);
    if(message) {
        message.extra??={};const swipe=message.swipe_id??0;
        message.extra.rpg_action_swipes??={};
        message.extra.rpg_action_swipes[swipe]={version:1,revision:replyRevision(message.mes),state:cloneAction(state)};
        if(message.swipe_info?.[swipe]) {message.swipe_info[swipe].extra??={};message.swipe_info[swipe].extra.rpg_action_swipes=cloneAction(message.extra.rpg_action_swipes);}
    }
    saveChatDebounced();
}
export function restoreActionBranch() {
    const data=actionData();if(!data)return;
    for(const message of [...getContext().chat].reverse()) {
        const swipe=message.swipe_id??0;
        const snap=(message.extra?.rpg_action_swipes??message.swipe_info?.[swipe]?.extra?.rpg_action_swipes)?.[swipe];
        if(snap?.version===1 && snap.revision===replyRevision(message.mes)) {data.state=cloneAction(snap.state);return;}
    }
    data.state=cloneAction(data.manual??emptyActions());
}
export function actionPreference(key,fallback) {return actionData()?.preferences?.[key]??fallback;}
export function latestActionMessage() {
    return [...getContext().chat].reverse().find(m=>m.extra?.rpg_action_swipes?.[m.swipe_id??0]?.revision===replyRevision(m.mes));
}
export function portraitData(create=false) {
    const meta=getContext().chatMetadata;if(!meta)return null;
    if(create)meta.rpg_player_portrait_v1??={version:1,portraits:{}};
    return meta.rpg_player_portrait_v1??null;
}
export function activePortrait() {const player=actionState().player;return player?portraitData()?.portraits?.[player.id]:null;}
export function stripAcceptedActions(raw,message) {
    const snap=message.extra?.rpg_action_swipes?.[message.swipe_id??0];
    const scene=message.extra?.rpg_scene_swipes?.[message.swipe_id??0];
    let out=scene?.revision===replyRevision(message.mes)?stripScenes(raw,scene.spans??[],message.mes):String(raw);
    if(snap?.revision===replyRevision(message.mes)){try{out=hideActionBlocks(out,scanActionBlocks(out,{encounterId:snap.state?.encounter?.id}));}catch{}}
    return stripAcceptedPortraits(out,message);
}
