// Runs only for freshly generated Together replies, never for history rendering.
export function avatarNames(data) {
    let parsed = data;
    if (typeof data === 'string') {
        try { parsed = JSON.parse(data); }
        catch {
            parsed = data.split('\n').filter(line => line.startsWith('- '))
                .map(line => ({ name: line.slice(2).trim() }));
        }
    }
    const rows = Array.isArray(parsed) ? parsed : parsed?.characters;
    if (!Array.isArray(rows)) return [];
    return [...new Set(rows.map(row => row?.name)
        .filter(name => typeof name === 'string')
        .map(name => name.trim())
        .filter(name => name && name.toLowerCase() !== 'unavailable'))];
}

export function createTogetherAvatarRunner({ getContext, getSettings, isAwaiting,
    getSwipeId, generate, render, report, isBusy = () => false,
    delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const processed = new WeakMap();
    let epoch = 0;
    return {
        invalidate() { epoch++; },
        async run(message, thoughts, fresh) {
            if (!fresh || !message || message.is_user || message.is_system) return;
            const context = getContext();
            const origin = { chat: context.chat, id: context.chatId, epoch,
                swipe: getSwipeId(message), text: message.mes };
            let cancelled = false;
            const isCurrent = () => {
                const now = getContext();
                const settings = getSettings();
                cancelled ||= epoch !== origin.epoch || !settings.enabled ||
                    !settings.autoGenerateAvatars || settings.generationMode !== 'together' ||
                    isAwaiting() || now.chat !== origin.chat || now.chatId !== origin.id ||
                    now.chat?.at(-1) !== message || getSwipeId(message) !== origin.swipe ||
                    message.mes !== origin.text;
                return !cancelled;
            };
            if (!isCurrent()) return;
            const names = avatarNames(thoughts);
            if (!names.length) return;
            const swipes = processed.get(message) || new Map();
            if (swipes.get(origin.swipe) === origin.text) return;
            // Claim before the first await: duplicate MESSAGE_RECEIVED events cost nothing.
            swipes.set(origin.swipe, origin.text);
            processed.set(message, swipes);
            try {
                // Non-streaming MESSAGE_RECEIVED can precede SillyTavern's UI unlock.
                // Never start a second LLM call while the original generation owns the UI.
                for (let attempt = 0; isBusy(); attempt++) {
                    if (!isCurrent()) return;
                    if (attempt >= 300) { report(); return; }
                    await delay(100);
                }
                if (!isCurrent()) return;
                await generate(names, () => { if (isCurrent()) render(); },
                    { shouldContinue: isCurrent });
            } catch {
                if (isCurrent()) report();
            } finally {
                if (isCurrent()) render();
            }
        },
    };
}
