import { cloneFramework, emptyFramework, validateFramework } from './state.mjs';

/** Pure adapters for ST-shaped messages. The caller owns chat context and saving. */
export function writeFrameworkSnapshot(message, state) {
    validateFramework(state);
    if (!message || typeof message.mes !== 'string' || message.is_user || message.is_system) throw new Error('快照须关联模型回复');
    const swipe = message.swipe_id ?? 0;
    message.extra ??= {};
    message.extra.rpg_framework_swipes ??= {};
    // Exact reply identity, avoiding acceptance of an edited reply's old state.
    message.extra.rpg_framework_swipes[swipe] = { protocol: 1, reply: message.mes, state: cloneFramework(state) };
    if (message.swipe_info?.[swipe]) {
        message.swipe_info[swipe].extra ??= {};
        message.swipe_info[swipe].extra.rpg_framework_swipes = cloneFramework(message.extra.rpg_framework_swipes);
    }
}
export function readFrameworkBranch(messages, baseline = emptyFramework()) {
    validateFramework(baseline);
    for (const message of [...messages].reverse()) {
        if (message.is_user || message.is_system) continue;
        const swipe = message.swipe_id ?? 0;
        const snap = (message.extra?.rpg_framework_swipes ?? message.swipe_info?.[swipe]?.extra?.rpg_framework_swipes)?.[swipe];
        if (!snap) continue;
        if (snap.protocol !== 1 || snap.reply !== message.mes) continue;
        validateFramework(snap.state);
        return cloneFramework(snap.state);
    }
    return cloneFramework(baseline);
}
