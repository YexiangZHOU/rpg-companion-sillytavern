import { emptyFramework, cloneFramework, applyFrameworkTransaction } from './state.mjs';
import { applyFrameworkReply, buildFrameworkInstructions } from './protocol.mjs';
import { readFrameworkBranch, writeFrameworkSnapshot } from './snapshots.mjs';
import { frameworkFailure } from './diagnostics.mjs';

export const CHAT_FRAMEWORK_KEY = 'rpg_framework_v1';
export function frameworkMode(context) {
    const stored = context?.chatMetadata?.[CHAT_FRAMEWORK_KEY]?.mode;
    if (stored === 'universal' || stored === 'legacy') return stored;
    const messages = context?.chat ?? [];
    if (messages.some(m => m.extra?.rpg_framework_swipes || m.swipe_info?.some(s => s?.extra?.rpg_framework_swipes))) return 'universal';
    // Existing records never become invented defaults in a new schema.
    if (context?.chatMetadata?.rpg_companion || messages.some(m => m.extra?.rpg_companion_swipes || m.swipe_info?.some(s => s?.extra?.rpg_companion_swipes))) return 'legacy';
    return messages.filter(m => !m.is_user && !m.is_system).length <= 1 ? 'universal' : 'legacy';
}
const validReply = m => m && !m.is_user && !m.is_system && typeof m.mes === 'string';
const snapFor = m => (m.extra?.rpg_framework_swipes ?? m.swipe_info?.[m.swipe_id ?? 0]?.extra?.rpg_framework_swipes)?.[m.swipe_id ?? 0];

/** Dependency-injected chat lifecycle: no ST globals and no account-wide game state. */
export class FrameworkChat {
    constructor({ getContext, save, enabled = () => true, render = () => {}, report = () => {}, observe = () => {} }) {
        Object.assign(this, { getContext, save, enabled, render, report }); this.generation = null; this.serial = 0;
        // Optional diagnostics must never change the transaction outcome.
        this.observe = (...args) => { try { observe(...args); } catch { /* Diagnostics are best effort. */ } };
    }
    active() { return this.enabled() && frameworkMode(this.getContext()) === 'universal'; }
    state() { return readFrameworkBranch(this.getContext().chat ?? []); }
    restore() { this.generation = null; try { const state = this.state(); this.render(state); return state; } catch { this.report('保存的游戏数据校验失败，未覆盖记录'); this.render(null); return null; } }
    async setMode(mode) {
        if (this.saving) throw Error('数据正在保存，请稍后重试');
        if (!['universal', 'legacy'].includes(mode)) throw Error('跟踪模式无效');
        const ctx = this.getContext(); this.generation = null;
        const prior = ctx.chatMetadata[CHAT_FRAMEWORK_KEY];
        ctx.chatMetadata[CHAT_FRAMEWORK_KEY] = { ...(prior ?? {}), mode };
        this.saving = true;
        try { await this.save(); } catch (error) { if (prior === undefined) delete ctx.chatMetadata[CHAT_FRAMEWORK_KEY]; else ctx.chatMetadata[CHAT_FRAMEWORK_KEY] = prior; throw error; } finally { this.saving = false; }
        this.restore();
    }
    begin(type, { suppressed = false, dryRun = false } = {}) {
        this.generation = null;
        if (!this.active() || dryRun || suppressed || ['quiet','impersonate','continue'].includes(type)) return '';
        const ctx = this.getContext(), messages = ctx.chat ?? [];
        // Pin a fresh game's mode before the first reply. An invalid initializer
        // must not make it look like a legacy chat simply by adding a message.
        ctx.chatMetadata[CHAT_FRAMEWORK_KEY] ??= { mode: 'universal' };
        const replace = ['swipe','regenerate'].includes(type) && validReply(messages.at(-1));
        const prior = replace ? messages.slice(0, -1) : messages;
        const state = readFrameworkBranch(prior);
        this.generation = { metadata: ctx.chatMetadata, anchor: prior.at(-1), anchorText: prior.at(-1)?.mes, before: cloneFramework(state), handled: new WeakSet(), start: prior.length };
        return buildFrameworkInstructions(state);
    }
    async receive(message) {
        const ctx = this.getContext(), g = this.generation;
        if (!this.active() || !g || ctx.chatMetadata !== g.metadata || !validReply(message) || !ctx.chat.includes(message) || ctx.chat.indexOf(message) < g.start || g.handled.has(message)) return false;
        if (g.anchor && (!ctx.chat.includes(g.anchor) || g.anchor.mes !== g.anchorText)) return false;
        if (this.saving) { this.observe(message, { status: 'busy' }); this.report('数据正在保存，本轮更新请稍后重试'); return false; }
        const existing = snapFor(message);
        if (existing?.reply === message.mes) { g.handled.add(message); this.render(this.state()); return false; }
        // The pinned generation revision prevents an asynchronous reply overwriting manual edits.
        const before = readFrameworkBranch(ctx.chat.slice(0, ctx.chat.indexOf(message)));
        if (JSON.stringify(before) !== JSON.stringify(g.before)) { this.observe(message, { status: 'conflict' }); this.report('生成期间数据已修改，本轮事务未覆盖最新记录'); return false; }
        let phase = 'apply';
        try {
            const result = applyFrameworkReply(message.mes, before);
            if (!result.accepted) { this.observe(message, { status: 'no_protocol', baseRevision: before.revision }); g.handled.add(message); this.render(this.state()); return false; }
            const original = { mes: message.mes, swipes: message.swipes ? [...message.swipes] : undefined, extra: message.extra ? cloneFramework(message.extra) : undefined, swipe_info: message.swipe_info ? cloneFramework(message.swipe_info) : undefined };
            const priorMode = ctx.chatMetadata[CHAT_FRAMEWORK_KEY];
            this.saving = true;
            try {
                message.mes = result.visibleText;
                if (message.swipes) message.swipes[message.swipe_id ?? 0] = result.visibleText;
                writeFrameworkSnapshot(message, result.state);
                ctx.chatMetadata[CHAT_FRAMEWORK_KEY] = { ...(priorMode ?? {}), mode: 'universal' };
                phase = 'save';
                await this.save();
                this.observe(message, { status: 'accepted', baseRevision: before.revision, revision: result.state.revision });
                if (this.getContext().chatMetadata !== ctx.chatMetadata) { g.handled.add(message); return true; }
            } catch (error) {
                for (const key of ['mes','swipes','extra','swipe_info']) { if (original[key] === undefined) delete message[key]; else message[key] = original[key]; }
                if (priorMode === undefined) delete ctx.chatMetadata[CHAT_FRAMEWORK_KEY]; else ctx.chatMetadata[CHAT_FRAMEWORK_KEY] = priorMode;
                throw error;
            } finally { this.saving = false; }
            g.handled.add(message); this.render(result.state, { message, changes: result.changes }); return true;
        } catch (error) {
            this.observe(message, { ...(phase === 'save' ? { status: 'save_failed', code: 'save_readback' } : frameworkFailure(error)), baseRevision: before.revision });
            this.report(phase === 'save' ? '保存或回读失败，服务器结果尚未确认；请查看诊断记录。' : `游戏数据未提交：${String(error.message).slice(0, 180)}`); return false;
        }
    }
    async manual(ops) {
        if (this.saving) throw Error('数据正在保存，请稍后重试');
        if (!this.active()) throw Error('通用框架未启用');
        const ctx = this.getContext(), message = [...ctx.chat].reverse().find(validReply);
        if (!message) throw Error('请先开始聊天');
        const before = this.state();
        const result = applyFrameworkTransaction(before, { protocol: 1, id: `manual_${Date.now()}_${++this.serial}`, baseRevision: before.revision, ops }, { actor: 'manual' });
        const originalExtra = message.extra ? cloneFramework(message.extra) : undefined;
        const originalInfo = message.swipe_info ? cloneFramework(message.swipe_info) : undefined;
        this.saving = true;
        try { writeFrameworkSnapshot(message, result.state); await this.save(); }
        catch (error) { if (originalExtra === undefined) delete message.extra; else message.extra = originalExtra; if (originalInfo === undefined) delete message.swipe_info; else message.swipe_info = originalInfo; throw error; }
        finally { this.saving = false; }
        if (this.getContext().chatMetadata === ctx.chatMetadata) this.render(result.state, { changes: result.changes }); return result;
    }
}
