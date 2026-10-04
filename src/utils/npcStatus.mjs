/** An optional basic NPC status view; never rewrite the user's tracker configuration. */
export function npcStatusConfig(config={}, enabled=true) {
    if(!enabled)return config;
    const previous=config.characterStats || {}, existing=previous.customStats || [];
    const stats=previous.enabled ? existing.filter(s=>!['health','energy'].includes(s.id)) : [];
    for(const [id,name] of [['energy','Energy'],['health','Health']]) {
        const original=existing.find(s=>s.id===id || s.name===name);
        stats.unshift({...original,id,name:original?.name || name,enabled:true});
    }
    const fields=[...(config.customFields || [])];
    const index=fields.findIndex(f=>f.id==='npc_conditions' || f.name==='Conditions');
    const condition={...fields[index],id:'npc_conditions',name:fields[index]?.name || 'Conditions',enabled:true,
        description:'Observable abnormal conditions such as injured, poisoned or unconscious. Explicitly known healthy state: None; insufficient evidence: Unknown. Never infer inner thoughts or invent an injury.',persistInHistory:true};
    if(index<0)fields.push(condition);else fields[index]=condition;
    return {...config,customFields:fields,characterStats:{...previous,enabled:true,customStats:stats}};
}
export function npcPercentage(value) {
    if(value && typeof value==='object')value=value.value;
    if(typeof value==='string' && /^\d+(?:\.\d+)?%?$/.test(value.trim()))value=Number(value.trim().replace('%',''));
    return typeof value==='number' && Number.isFinite(value) && value>=0 && value<=100 ? value : null;
}
