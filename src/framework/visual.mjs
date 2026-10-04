import { activeFrameworkFields, activeFrameworkGroups } from './state.mjs';
import { protocolVisibleText } from '../systems/features/diceEngine.mjs';
/** Public visual descriptions only; never private thoughts or unrelated numeric rules. */
export function entityAppearance(state, entity) {
    const fields = activeFrameworkGroups(state,entity.id).flatMap(g => activeFrameworkFields(state,g.id));
    return fields.filter(f => f.type === 'text' && /^(外观|相貌|外貌|appearance)$/i.test(f.label.trim())).map(f => state.values[f.id]).filter(v => typeof v === 'string' && v.trim()).join('; ').slice(0,2400);
}
export function frameworkVisual(state, summary = '') {
    const entities = state.entities.filter(e => !e.archived);
    const scene = entities.find(e => e.kind === 'scene');
    const cast = entities.filter(e => ['player','npc'].includes(e.kind)).map(e => ({ name:e.label,appearance:entityAppearance(state,e),visibleAction:e.description ?? '' }));
    const player = cast.find(c => entities.find(e => e.label === c.name)?.kind === 'player') ?? null;
    return { location:scene?.description || scene?.label || '',weather:{},time:{},cast,player,summary };
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
