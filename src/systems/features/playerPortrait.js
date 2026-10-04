import { getContext } from '../../../../../../extensions.js';
import { saveChatDebounced } from '../../../../../../../script.js';
import { user_avatar } from '../../../../../../../script.js';
import { power_user } from '../../../../../../power-user.js';
import { SlashCommandParser } from '../../../../../../slash-commands/SlashCommandParser.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';
import { actionState,activePortrait,portraitData,actionPreference } from './actionStore.js';
import { extensionSettings } from '../../core/state.js';
import { withAvatarJob } from './avatarQueue.mjs';
const pending=new WeakSet();
export function playerPortraitMode() {return actionPreference('portraitMode',extensionSettings.playerPortraitMode??'manual');}
export function canAutoPortrait() {
    const player=actionState().player,record=activePortrait();
    const hasPersona=user_avatar!=='user-default.png'&&!!power_user.personas?.[user_avatar];
    return !!(extensionSettings.enabled&&player?.confirmed&&player.appearance?.length>=20&&playerPortraitMode()==='auto'&&!hasPersona&&!record?.url&&!record?.locked&&!record?.attempted);
}
/** Uses the registered native /sd callback directly: prompt text cannot execute a slash pipeline. */
export async function generatePlayerPortrait(force=false) {
    const meta=getContext().chatMetadata,player=actionState().player;
    if(!extensionSettings.enabled||!player?.confirmed||player.appearance?.length<20)throw Error('请先确认玩家姓名和足够具体的外观');
    const data=portraitData(true),before=data.portraits[player.id]??{};
    if(before.locked)throw Error('玩家头像已锁定');
    if(playerPortraitMode()==='off')throw Error('玩家头像生成已关闭');
    if(pending.has(meta))throw Error('当前聊天头像正在生成');
    if(!force&&before.attempted)return;
    const command=SlashCommandParser.commands?.sd??SlashCommandParser.commands?.imagine;
    if(typeof command?.callback!=='function')throw Error('原生绘图模块尚未加载');
    pending.add(meta);
    const token=crypto.randomUUID(),originalUrl=before.url;
    data.portraits[player.id]={...before,attempted:true,requestId:token,status:'pending'};saveChatDebounced();
    const valid=()=>getContext().chatMetadata===meta&&actionState().player?.id===player.id&&actionState().player?.appearance===player.appearance&&data.portraits[player.id]?.requestId===token&&!data.portraits[player.id]?.locked&&data.portraits[player.id]?.url===originalUrl&&extensionSettings.enabled&&playerPortraitMode()!=='off';
    window.dispatchEvent(new Event('rpg-actions-render'));
    try {
        await withAvatarJob(async()=>{
        const prompt=await safeGenerateRaw({prompt:`Write a single concise English image prompt, no commands or commentary. One person, head-and-shoulders portrait, clear face, no text or collage. Preserve only this confirmed appearance; do not infer other character identities. Name: ${player.name}. Appearance: ${player.appearance}`,quietToLoud:false});
        if(!valid())return;
        if(typeof prompt!=='string'||!prompt.trim()||prompt.length>4000)throw Error('绘图提示词为空或过长');
        const result=await command.callback({quiet:'true',extend:'false',gallery:'false'},`Single-person portrait, ${prompt.trim()}`);
        if(!valid())return;
        // Native generator saves account-scoped image paths. Do not accept remote/model supplied URLs.
        const url=typeof result==='string'?result:result?.pipe;
        if(typeof url!=='string'||!/^\/?user\/images\//.test(url)||url.includes('..')||/["<>\n]/.test(url))throw Error('原生绘图未返回有效图片');
        data.portraits[player.id]={...data.portraits[player.id],url,status:'ready',source:'generated',appearance:player.appearance};
        saveChatDebounced();
        },valid);
    } catch(error) {
        if(getContext().chatMetadata===meta&&data.portraits[player.id]?.requestId===token){data.portraits[player.id].status='failed';saveChatDebounced();}
        throw error;
    } finally {
        pending.delete(meta);
        if(data.portraits[player.id]?.requestId===token&&data.portraits[player.id].status==='pending'){data.portraits[player.id].status='interrupted';if(getContext().chatMetadata===meta)saveChatDebounced();}
        window.dispatchEvent(new Event('rpg-actions-render'));
    }
}
export async function uploadPlayerPortrait(file) {
    const meta=getContext().chatMetadata,player=actionState().player;
    if(!player?.confirmed)throw Error('请先确认玩家身份');
    if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('请选择5MB以内的PNG/JPEG/WebP');
    // Small chat-scoped image, no new server endpoint or global persona mutation.
    const url=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('图片读取失败'));r.readAsDataURL(file);});
    const image=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('图片无法解码'));i.src=url;});
    const size=512,scale=Math.min(size/image.width,size/image.height,1),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    if(getContext().chatMetadata!==meta||actionState().player?.id!==player.id)throw Error('聊天/玩家已改变，未应用图片');
    const data=portraitData(true);data.portraits[player.id]={url:canvas.toDataURL('image/png'),source:'uploaded',locked:true,attempted:true,status:'ready'};saveChatDebounced();window.dispatchEvent(new Event('rpg-actions-render'));
}
