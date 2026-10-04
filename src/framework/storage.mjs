import { CHAT_FRAMEWORK_KEY } from './chat.mjs';
import { cloneFramework } from './state.mjs';

/** ST 1.19 saveChat swallows HTTP errors. Read back only this extension's data. */
export async function saveFrameworkVerified(context, transport = fetch) {
    const character = context.characters?.[context.characterId];
    if (!context.chatId || (!context.groupId && !character?.avatar)) throw Error('请先选择已保存的角色聊天');
    if (typeof context.saveChat !== 'function') throw Error('当前版本缺少聊天保存接口');
    const project = (messages, metadata) => ({
        mode: metadata?.[CHAT_FRAMEWORK_KEY]?.mode ?? null,
        repairAttempts: metadata?.[CHAT_FRAMEWORK_KEY]?.repairAttempts ?? null,
        mediaMode: metadata?.[CHAT_FRAMEWORK_KEY]?.mediaMode ?? null,
        sceneReviewMode: metadata?.[CHAT_FRAMEWORK_KEY]?.sceneReviewMode ?? null,
        media: messages.map(m=>m.extra?.rpg_framework_media ?? m.swipe_info?.[m.swipe_id??0]?.extra?.rpg_framework_media ?? null),
        messages: messages.map(m => ({ reply: m.mes, swipe: m.swipe_id ?? 0, data: m.extra?.rpg_framework_swipes ?? m.swipe_info?.[m.swipe_id ?? 0]?.extra?.rpg_framework_swipes ?? null, portraits: m.extra?.rpg_framework_portraits ?? m.swipe_info?.[m.swipe_id ?? 0]?.extra?.rpg_framework_portraits ?? null, repairs: m.extra?.rpg_framework_repairs ?? m.swipe_info?.[m.swipe_id ?? 0]?.extra?.rpg_framework_repairs ?? null })),
    });
    const expected = cloneFramework(project(context.chat,context.chatMetadata));
    const endpoint = context.groupId ? '/api/chats/group/get' : '/api/chats/get';
    const body = context.groupId ? { id: context.chatId } : { ch_name: character.name, file_name: context.chatId, avatar_url: character.avatar };
    const headers = context.getRequestHeaders();
    await context.saveChat();
    const response = await transport(endpoint,{ method:'POST',headers,body:JSON.stringify(body),cache:'no-store' });
    if (!response.ok) throw Error('无法核验保存结果，请检查连接后重试');
    const saved = await response.json();
    if (!Array.isArray(saved) || !saved.length) throw Error('未读取到已保存的聊天');
    const [header,...messages] = saved;
    if (JSON.stringify(project(messages,header.chat_metadata)) !== JSON.stringify(expected)) throw Error('聊天保存未通过回读核验，未显示为已提交');
}
