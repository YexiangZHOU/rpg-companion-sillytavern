export function showPortraitPreview(src, name = '') {
    if (typeof src !== 'string' || !/^(https?:\/\/|\/[^/]|data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]|blob:)/i.test(src)) return;
    document.getElementById('rpg-portrait-preview')?.remove();
    const dialog = document.createElement('dialog'); dialog.id = 'rpg-portrait-preview';
    dialog.setAttribute('aria-label',name ? `${name} · 头像预览` : '头像预览');
    const image = document.createElement('img'); image.src = src; image.alt = name; image.className = 'rpg-portrait-preview';
    const close = document.createElement('button'); close.type='button'; close.textContent='关闭 / Close';
    close.addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
    dialog.append(image,close); document.body.append(dialog); dialog.showModal(); close.focus();
}
