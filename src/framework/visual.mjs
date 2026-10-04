import { protocolVisibleText } from '../systems/features/diceEngine.mjs';
import { appearanceText, entityFields } from './media.mjs';
/** Public visual descriptions only; never private thoughts or unrelated numeric rules. */
export function entityAppearance(state, entity) {
    return appearanceText(state,entity);
}
export function frameworkVisual(state, summary = '') {
    const entities = state.entities.filter(e => !e.archived);
    const scene = entities.find(e => e.kind === 'scene');
    const publicValue = (entity,role) => entity ? entityFields(state,entity).filter(f=>f.role===role&&['text','choice','number'].includes(f.type)).map(f=>state.values[f.id]).filter(v=>v!=null&&v!=='').join('; ') : '';
    const subjects = entities.filter(e => e.visual?.visible !== false && (['player','npc'].includes(e.kind) || e.visual?.visible === true));
    const cast = subjects.map(e => ({ name:e.label,appearance:entityAppearance(state,e),visibleAction:publicValue(e,'action')||e.description||'' }));
    const player = cast[subjects.findIndex(e=>e.kind==='player')] ?? null;
    const weather=publicValue(scene,'weather'),time=publicValue(scene,'time');
    return { location:publicValue(scene,'location')||scene?.description||scene?.label||'',weather:weather?{condition:weather}:{},time:time?{display:time}:{},cast,player,summary:summary||publicValue(scene,'action')||scene?.description||'' };
}
export function stripAcceptedPortraits(raw, message) {
    const swipe=message.swipe_id??0;
    const entry=(message.extra?.rpg_framework_portraits??message.swipe_info?.[swipe]?.extra?.rpg_framework_portraits)?.[swipe];
    if(entry?.reply!==message.mes)return raw;
    let out=String(raw);
    for(const m of protocolVisibleText(message.mes).replace(/^\s*>[^\n]*/gm,'').matchAll(/(?:^|\n)<rpg-portrait>\s*(\{[^\n]+\})\s*<\/rpg-portrait>/g)){
        try{const request=JSON.parse(m[1]);if(Object.keys(request).length===1&&typeof request.entityId==='string'&&entry.images?.[request.entityId]?.url)out=out.replace(m[0],'');}catch{}
    }
    return out.trimEnd();
}
