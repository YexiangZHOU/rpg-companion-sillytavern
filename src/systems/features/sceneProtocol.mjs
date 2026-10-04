import { protocolVisibleText } from './diceEngine.mjs';
export function validateScene(x){
    if(!x||Array.isArray(x)||typeof x!=='object'||Object.keys(x).some(k=>!['change','summary'].includes(k))||!['location','cast','action'].includes(x.change)||typeof x.summary!=='string'||!x.summary.trim()||x.summary.length>1600)throw Error('场景刷新请求无效');
    return {change:x.change,summary:x.summary.trim()};
}
export function scanScenes(raw){
    const visible=protocolVisibleText(raw).replace(/^\s*>[^\n]*/gm,m=>' '.repeat(m.length)),result=[];
    for(const m of visible.matchAll(/<rpg-scene>\s*([\s\S]*?)\s*<\/rpg-scene>/g))result.push({value:validateScene(JSON.parse(m[1])),start:m.index,end:m.index+m[0].length});
    if(result.length>1)throw Error('每轮只能刷新一个场景');return result;
}
export const sceneSignature=x=>JSON.stringify({location:x.location,cast:x.cast.map(c=>({name:c.name,appearance:c.appearance})).sort((a,b)=>a.name.localeCompare(b.name)),player:x.player,summary:x.summary});
export function sceneTriggerAllowed(change,previous,next){
    if(!previous)return true;
    if(change==='location')return previous.location!==next.location;
    if(change==='cast')return JSON.stringify(previous.cast.map(c=>c.name).sort())!==JSON.stringify(next.cast.map(c=>c.name).sort());
    return previous.summary!==next.summary;
}
export function stripScenes(raw,spans,source=raw){
    let out=String(raw);const original=String(source);
    // Tracker display_text may remove a preceding JSON block. Original offsets
    // identify accepted source chunks, never offsets in the shortened display.
    for(const s of [...spans].sort((a,b)=>b.start-a.start)){
        if(!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.start<0||s.end<=s.start||s.end>original.length)continue;
        out=out.replace(original.slice(s.start,s.end),'');
    }
    return out.trimEnd();
}
