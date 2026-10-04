import { FrameworkProtocolError } from './protocol.mjs';

/** A selected scope is extension-owned, never supplied by the reviewing model. */
export function panelReviewScope(state, scope = { target:'all' }) {
    if (!scope || !['all','entity','group','field','item'].includes(scope.target)) throw new FrameworkProtocolError('review_scope','核验范围无效');
    if (scope.target === 'all') return { target:'all' };
    const list = scope.target === 'entity' ? state.entities : scope.target === 'group' ? state.groups : state.fields;
    const part = list.find(p=>p.id === scope.id);
    if (!part) throw new FrameworkProtocolError('review_scope','核验对象已不存在');
    if (scope.target === 'item') {
        if (part.type !== 'collection' || !(state.values[part.id] ?? []).some(i=>i.id === scope.itemId)) throw new FrameworkProtocolError('review_scope','核验条目已不存在');
        return { target:'item',id:part.id,itemId:scope.itemId };
    }
    return { target:scope.target,id:part.id };
}

/** Prevent a field/item check from silently editing a different panel. */
export function validatePanelReview(ops, before, after, requested) {
    const scope=panelReviewScope(before,requested);
    const ancestry=(target,id,state)=>{
        if (target==='entity') return {entityId:id};
        const field=target==='field' ? state.fields.find(f=>f.id===id) : null;
        const group=state.groups.find(g=>g.id===(field?.groupId ?? (target==='group'?id:null)));
        return {fieldId:field?.id,groupId:group?.id,entityId:group?.entityId};
    };
    for(const op of ops) {
        if(!['create','updateDefinition','archive','setValue','upsertItem','archiveItem'].includes(op.op)) throw new FrameworkProtocolError('review_scope','核验不能重置游戏、改锁或执行额外动作');
        if(scope.target==='all') continue;
        const valueOp=['setValue','upsertItem','archiveItem'].includes(op.op);
        const target=valueOp?'field':op.target,id=op.op==='create'?op.definition.id:valueOp?op.fieldId:op.id;
        if(scope.target==='item') {
            if(!['upsertItem','archiveItem'].includes(op.op)||id!==scope.id||(op.op==='upsertItem'?op.item.id:op.itemId)!==scope.itemId) throw new FrameworkProtocolError('review_scope','条目核验不能修改其他条目或字段');
            continue;
        }
        const key=scope.target+'Id';
        const current=ancestry(target,id,after),old=ancestry(target,id,before);
        if(current[key]!==scope.id || old[key] && old[key]!==scope.id) throw new FrameworkProtocolError('review_scope','核验不能修改所选范围之外的记录');
    }
}
