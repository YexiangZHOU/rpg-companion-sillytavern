/** A reminder belongs to the background refresh request, never the conversation. */
export function refreshDialog({scope,sceneOnly,state,language='zh'},doc=document) {
    const zh=language==='zh',tr=(a,b)=>zh?a:b;
    const label=sceneOnly?tr('场景与其他角色','Scene and other characters'):scope.target==='all'?tr('全部面板','All panels')
        :scope.target==='item'?state.fields.find(f=>f.id===scope.id)?.label:state[`${scope.target==='entity'?'entitie':scope.target}s`]?.find(e=>e.id===scope.id)?.label;
    return new Promise(resolve=>{
        const dialog=doc.createElement('dialog');dialog.className='uf-refresh-dialog';
        const form=doc.createElement('form');form.method='dialog';
        const title=doc.createElement('h3');title.textContent=tr('刷新：','Refresh: ')+(label??scope.id);title.id='uf-refresh-title';dialog.setAttribute('aria-labelledby',title.id);
        const explanation=doc.createElement('p');explanation.textContent=tr('后台使用 1 次文字请求，不添加聊天或推进剧情。','Uses one background text request without adding messages or advancing the story.')+(sceneOnly?tr('此范围不包含玩家属性、物品或资产。','This scope excludes player stats, items and assets.'):'');
        const labelNode=doc.createElement('label');labelNode.textContent=tr('提醒模型（可选）','Reminder for the model (optional)');
        const input=doc.createElement('textarea');input.className='text_pole';input.rows=4;input.maxLength=2000;input.id='uf-refresh-hint';labelNode.htmlFor=input.id;
        input.placeholder=tr('例如：补齐游戏规则需要的基础属性；将已离场人物和已丢弃物品移出当前展示。','For example: add missing rule-defined stats; archive departed characters and discarded items.');
        const actions=doc.createElement('div');actions.className='uf-refresh-actions';
        const cancel=doc.createElement('button');cancel.type='button';cancel.className='menu_button';cancel.textContent=tr('取消','Cancel');cancel.onclick=()=>dialog.close();
        const submit=doc.createElement('button');submit.type='submit';submit.className='menu_button';submit.textContent=tr('刷新（1次文字请求）','Refresh (1 text call)');
        let result=null;form.addEventListener('submit',e=>{e.preventDefault();result=input.value.trim();dialog.close();});
        actions.append(cancel,submit);form.append(title,explanation,labelNode,input,actions);dialog.append(form);
        dialog.addEventListener('close',()=>{dialog.remove();resolve(result);},{once:true});doc.body.append(dialog);dialog.showModal();input.focus();
    });
}
