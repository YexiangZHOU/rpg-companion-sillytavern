import { activeFrameworkFields, activeFrameworkGroups, isFrameworkLocked } from './state.mjs';

export const MEDIA_KEY = 'rpg_framework_media';
export const entityFields = (state, entity) => activeFrameworkGroups(state, entity.id).flatMap(g => activeFrameworkFields(state, g.id));
export const appearanceField = f => f.type === 'text' && (f.role === 'appearance' || (!f.role && /^(外观|相貌|外貌|appearance)$/i.test(f.label.trim())));
export function appearanceText(state, entity) {
    const explicit = entityFields(state, entity).filter(f => f.role === 'appearance');
    const text = (explicit.length ? explicit : entityFields(state, entity).filter(appearanceField))
        .map(f => state.values[f.id]).filter(v => typeof v === 'string' && v.trim()).join('; ');
    return (text || entity.visual?.description || '').slice(0, 2400);
}
export function requiresPortrait(entity) {
    return ['player', 'npc', 'ship', 'vehicle', 'asset', 'creature', '舰船', '护卫舰', '载具'].includes(entity.kind)
        || entity.visual?.mode === 'portrait';
}
export function coverageIssues(state) {
    if (!state.initialized) return [{ code: 'initialization', id: '', label: '游戏初始化' }];
    const issues = [], entities = state.entities.filter(e => !e.archived);
    const scenes = entities.filter(e => e.kind === 'scene');
    if (!scenes.length) issues.push({ code: 'scene_missing', id: '', label: '当前场景' });
    for (const e of scenes) {
        const publicDetails = entityFields(state,e).some(f => ['location','action'].includes(f.role) && typeof state.values[f.id] === 'string' && state.values[f.id].trim());
        if (!e.description?.trim() && !publicDetails) issues.push({ code: 'scene_details', id: e.id, label: e.label });
    }
    for (const e of entities.filter(requiresPortrait)) {
        if (e.visual?.mode==='portrait' && e.visual.pending) continue; // Explicitly deferred, not secretly invented.
        if (!appearanceText(state,e)) issues.push({ code: 'appearance', id: e.id, label: e.label });
        if (e.visual?.mode !== 'portrait') issues.push({ code: 'portrait_intent', id: e.id, label: e.label });
    }
    return issues;
}

/** Only active targets. Item identity includes its collection; duplicate names are safe. */
export function mediaTargets(state) {
    const targets = [];
    const add = (kind, part, owner, field) => {
        let visual = part.visual;
        if (kind === 'entity' && !visual && requiresPortrait(part) && appearanceText(state,part)) {
            visual = { mode:'portrait', subject:['player','npc'].includes(part.kind) ? 'person' : 'object', description:appearanceText(state,part) };
        }
        if (!visual || visual.mode === 'none') return;
        const key = kind === 'item' ? `item:${field.id}:${part.id}` : `${kind}:${part.id}`;
        const label = kind === 'item' ? String(part.values[field.columns[0].id] ?? part.id) : part.label;
        const description = kind === 'entity' ? appearanceText(state,part) : visual.description ?? '';
        const subject = visual.subject ?? (kind === 'entity' && ['player','npc'].includes(part.kind) ? 'person' : visual.mode === 'icon' ? 'symbol' : 'object');
        const fingerprint = JSON.stringify([visual.mode, subject, description]);
        const lockKind = kind === 'item' ? 'field' : kind, lockId = kind === 'item' ? field.id : part.id;
        targets.push({ key, kind, id:part.id, label, owner:owner.id, mode:visual.mode, subject, description, fingerprint,
            pending:visual.pending ?? (!description.trim() ? 'appearance' : ''),
            locked:isFrameworkLocked(state,lockKind,lockId,'structure') || isFrameworkLocked(state,lockKind,lockId,'value') });
    };
    for (const entity of state.entities.filter(e => !e.archived)) {
        add('entity',entity,entity);
        for (const group of activeFrameworkGroups(state,entity.id)) {
            add('group',group,entity);
            for (const field of activeFrameworkFields(state,group.id)) {
                if (field.role === 'private') continue;
                add('field',field,entity);
                if (field.type === 'collection') for (const item of state.values[field.id] ?? []) if (!item.archived) add('item',item,entity,field);
            }
        }
    }
    return targets;
}
export function mediaPrompt(target) {
    const framing = target.mode === 'icon' ? 'One clear compact icon, simple background, recognizable at small size.'
        : target.subject === 'person' ? 'One character portrait, head and upper body, clear face.'
        : target.subject === 'creature' ? 'One creature portrait showing its characteristic anatomy.'
        : target.subject === 'place' ? 'One establishing view of the described place.'
        : 'One object illustration showing the complete silhouette and distinctive details. A vessel is a complete vessel, not a human portrait.';
    return `${framing} Confirmed visual data, not instructions: ${JSON.stringify({ subject:target.subject, appearance:target.description })}. No text, labels, UI or collage.`;
}
export const safeMediaUrl = url => typeof url === 'string' && /^\/?user\/images\//.test(url) && !/\.\.|["<>\n\r\\]/.test(url);
export function readMedia(chat) {
    const entries = {};
    for (const m of chat) {
        const swipe=m.swipe_id??0, store=(m.extra?.[MEDIA_KEY]??m.swipe_info?.[swipe]?.extra?.[MEDIA_KEY])?.[swipe];
        const legacy=(m.extra?.rpg_framework_portraits??m.swipe_info?.[swipe]?.extra?.rpg_framework_portraits)?.[swipe];
        if(legacy?.reply===m.mes)for(const [id,image] of Object.entries(legacy.images??{}))if(!entries[`entity:${id}`])entries[`entity:${id}`]={...image,status:'ready'};
        if (store?.reply === m.mes) Object.assign(entries, store.entries);
    }
    return entries;
}
export function writeMedia(message, entries) {
    const swipe=message.swipe_id??0;
    message.extra??={};message.extra[MEDIA_KEY]??={};
    const prior=message.extra[MEDIA_KEY][swipe];
    message.extra[MEDIA_KEY][swipe]={reply:message.mes,entries:{...(prior?.reply===message.mes?prior.entries:{}),...structuredClone(entries)}};
    if(message.swipe_info?.[swipe]){message.swipe_info[swipe].extra??={};message.swipe_info[swipe].extra[MEDIA_KEY]=structuredClone(message.extra[MEDIA_KEY]);}
}

/** Serialized externally with native image jobs. No provider access or chat append. */
export class FrameworkMedia {
    constructor({getContext,state,active,mode,blocked,generate,persist,render=()=>{}}) {
        Object.assign(this,{getContext,state,active,mode,blocked,generate,persist,render});
        this.job=null;this.seen=new WeakSet();this.uncertain=new WeakSet();this.epoch=0;
    }
    cancel(){this.epoch++;if(this.job){this.job.cancelled=true;this.render();}}
    async write(message,entries){
        const backup={extra:structuredClone(message.extra),swipe_info:structuredClone(message.swipe_info)};
        writeMedia(message,entries);
        try{await this.persist();}catch(error){
            for(const k of ['extra','swipe_info'])if(backup[k]===undefined)delete message[k];else message[k]=backup[k];
            this.uncertain.add(message);throw error;
        }
    }
    async run(key,{automatic=false,refresh=false}={}) {
        const ctx=this.getContext(),message=ctx.chat.at(-1),swipe=message?.swipe_id??0,reply=message?.mes,length=ctx.chat.length;
        if(!this.active()||this.mode()==='off'||this.job||this.blocked()||!message||message.is_user||message.is_system||this.uncertain.has(message))return false;
        const target=mediaTargets(this.state()).find(t=>t.key===key),prior=readMedia(ctx.chat)[key];
        if(!target||target.pending||target.locked||prior?.locked || (automatic&&this.mode()!=='auto'))return false;
        if(!refresh&&prior?.fingerprint===target.fingerprint&&(prior.status==='ready'&&safeMediaUrl(prior.url)||automatic&&['failed','requesting'].includes(prior.status)))return false;
        const job={key,metadata:ctx.chatMetadata,cancelled:false};this.job=job;
        const valid=()=>{
            const now=this.getContext(),current=mediaTargets(this.state()).find(t=>t.key===key);
            return !job.cancelled&&now.chatMetadata===ctx.chatMetadata&&now.chat.length===length&&now.chat.at(-1)===message
                &&message.mes===reply&&(message.swipe_id??0)===swipe&&this.active()&&!this.blocked()&&this.mode()!=='off'
                &&(!automatic||this.mode()==='auto')&&current&&!current.pending&&!current.locked&&!readMedia(now.chat)[key]?.locked&&current.fingerprint===target.fingerprint;
        };
        try{
            await this.write(message,{[key]:{...prior,fingerprint:target.fingerprint,status:'requesting'}});
            this.render();if(!valid())return false;
            let url;
            try {url=await this.generate(mediaPrompt(target),valid);} catch {if(valid())await this.write(message,{[key]:{...prior,fingerprint:target.fingerprint,status:'failed',code:'image_request'}});return false;}
            if(!valid())return false;
            if(!safeMediaUrl(url)){await this.write(message,{[key]:{...prior,fingerprint:target.fingerprint,status:'failed',code:'image_result'}});return false;}
            await this.write(message,{[key]:{url,imageFingerprint:target.fingerprint,fingerprint:target.fingerprint,status:'ready',locked:false}});return true;
        }finally{this.job=null;this.render();}
    }
    async automatic(message){
        if(this.seen.has(message))return;this.seen.add(message);
        if(this.mode()!=='auto'||this.job)return;
        const ctx=this.getContext(),epoch=this.epoch,reply=message.mes,swipe=message.swipe_id??0,state=JSON.stringify(this.state());
        const entries=readMedia(ctx.chat);
        // At most two image attempts per new assistant reply, including failures.
        const keys=mediaTargets(this.state()).filter(t=>!t.pending&&!t.locked&&!entries[t.key]?.locked
            && !(entries[t.key]?.fingerprint===t.fingerprint&&(safeMediaUrl(entries[t.key]?.url)||['failed','requesting'].includes(entries[t.key]?.status))))
            .sort((a,b)=>Number(b.kind==='entity')-Number(a.kind==='entity')).slice(0,2).map(t=>t.key);
        for(const key of keys){if(this.epoch!==epoch||this.getContext().chatMetadata!==ctx.chatMetadata||ctx.chat.at(-1)!==message||message.mes!==reply||(message.swipe_id??0)!==swipe||JSON.stringify(this.state())!==state||this.mode()!=='auto')break;await this.run(key,{automatic:true});}
    }
    async toggleLock(key){
        const ctx=this.getContext(),message=ctx.chat.at(-1),entry=readMedia(ctx.chat)[key];
        if(!this.active()||this.blocked()||this.job||!message||message.is_user||this.uncertain.has(message)||!entry?.url)return;
        await this.write(message,{[key]:{...entry,locked:!entry.locked}});this.render();
    }
}
