import { getContext } from '../../../../../extensions.js';
import { messageFormatting, is_send_press } from '../../../../../../script.js';
import { extensionSettings } from '../core/state.js';
import { i18n } from '../core/i18n.js';
import { frameworkMode } from './chat.mjs';
import { frameworkMessagePresentation } from './presentation.mjs';

const cache = new WeakMap();
export function hasFrameworkMessageData(raw) {
    return extensionSettings.enabled && frameworkMode(getContext()) === 'universal' && typeof raw === 'string' && raw.includes('<rpg-framework>');
}

/** Shared by action and dice renderers, so a late re-render cannot expose the block. */
export function renderGameMessage(body, raw, message, index) {
    const result = hasFrameworkMessageData(raw) && !is_send_press
        ? frameworkMessagePresentation(raw) : { visible: raw, blocks: [] };
    const language = i18n.currentLanguage;
    const prior = cache.get(body);
    if (prior?.raw === raw && prior?.language === language && prior?.folded === result.blocks.length && prior?.html === body.innerHTML) return;
    const open = prior?.raw === raw && !!body.querySelector('.uf-message-data')?.open;
    body.innerHTML = messageFormatting(result.visible, message.name, message.is_system, message.is_user, index, {}, false);
    if (result.blocks.length) {
        const zh = language.startsWith('zh');
        const notice = document.createElement('details'); notice.className = 'uf-message-data';
        notice.open = open;
        const summary = document.createElement('summary');
        summary.textContent = zh ? '本轮状态未更新 · 查看原始数据' : 'State update not committed · View raw data';
        const hint = document.createElement('p');
        hint.textContent = zh ? '继续使用面板中已保存的数据；以下内容仅供检查，不会执行或写入。' : 'The panel still uses saved data. The content below is for inspection only.';
        const code = document.createElement('pre'); code.textContent = result.blocks.map(b => b.raw).join('\n\n');
        notice.append(summary, hint, code); body.append(notice);
    }
    cache.set(body, { raw, language, folded: result.blocks.length, html: body.innerHTML });
}
