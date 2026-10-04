import { emptyFramework, cloneFramework, applyFrameworkTransaction } from './state.mjs';
import { applyFrameworkReply, buildFrameworkInstructions } from './protocol.mjs';
import { readFrameworkBranch, writeFrameworkSnapshot } from './snapshots.mjs';
import { frameworkFailure } from './diagnostics.mjs';
import { readRepair, writeRepair, repairable, repairPrompt, correctedResult } from './repair.mjs';

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
    constructor({ getContext, save, enabled = () => true, render = () => {}, report = () => {}, observe = () => {}, generateRepair, repairLimit = () => 2, repairStatus = () => {} }) {
        Object.assign(this, { getContext, save, enabled, render, report }); this.generation = null; this.serial = 0;
        Object.assign(this, { generateRepair, repairLimit }); this.repairJob = null;
        this.uncertainSaves = new WeakSet();
        this.repairStatus = () => { try { repairStatus(); } catch { /* Presentation cannot affect commit status. */ } };
        // Optional diagnostics must never change the transaction outcome.
        this.observe = (...args) => { try { observe(...args); } catch { /* Diagnostics are best effort. */ } };
    }
    active() { return this.enabled() && frameworkMode(this.getContext()) === 'universal'; }
    state() { return readFrameworkBranch(this.getContext().chat ?? []); }
    restore() { this.cancelRepair(); this.generation = null; try { const state = this.state(); this.render(state); return state; } catch { this.report('保存的游戏数据校验失败，未覆盖记录'); this.render(null); return null; } }
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
        this.cancelRepair();
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
            if (!result.accepted) {
                this.observe(message, { status: 'no_protocol', ...result.diagnostic, baseRevision: before.revision });
                g.handled.add(message); this.render(this.state());
                if (result.diagnostic) this.report('检测到示例、引用或代码块内的框架标签；这些内容未作为更新执行，请查看数据更新诊断。');
                return false;
            }
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
            if (phase === 'save') this.uncertainSaves.add(message);
            this.observe(message, { ...(phase === 'save' ? { status: 'save_failed', code: 'save_readback' } : frameworkFailure(error)), baseRevision: before.revision });
            if (phase === 'apply' && this.generateRepair && repairable(frameworkFailure(error))) {
                g.handled.add(message);
                return this.repair(message, before, error, g);
            }
            this.report(phase === 'save' ? '保存或回读失败，服务器结果尚未确认；请查看诊断记录。' : `游戏数据未提交：${String(error.message).slice(0, 180)}`); return false;
        }
    }
    cancelRepair() { if (this.repairJob) { this.repairJob.cancelled = true; this.repairStatus(); } }
    async setRepairLimit(value) {
        if (![0,1,2].includes(value) || this.saving) throw Error('当前无法更改纠错设置');
        this.cancelRepair(); const ctx = this.getContext(), prior = cloneFramework(ctx.chatMetadata[CHAT_FRAMEWORK_KEY] ?? {});
        ctx.chatMetadata[CHAT_FRAMEWORK_KEY] = { ...prior, repairAttempts: value };
        this.saving = true;
        try { await this.save(); } catch (error) { ctx.chatMetadata[CHAT_FRAMEWORK_KEY] = prior; throw error; } finally { this.saving = false; }
    }
    async retryRepair(message) {
        if (!this.active() || this.saving || this.repairJob || this.uncertainSaves.has(message) || this.getContext().chat.at(-1) !== message || snapFor(message)?.reply === message?.mes) return false;
        const ctx = this.getContext(), before = readFrameworkBranch(ctx.chat.slice(0,-1));
        try { applyFrameworkReply(message.mes, before); return false; }
        catch (error) {
            if (!repairable(frameworkFailure(error))) return false;
            return this.repair(message, before, error, null, true);
        }
    }
    async repair(message, before, error, generation, manual = false) {
        const ctx = this.getContext(), original = message.mes, swipe = message.swipe_id ?? 0;
        const configured = this.repairLimit(), maximum = [0,1,2].includes(configured) ? configured : 2;
        const limit = manual ? Math.max(1, maximum) : maximum;
        if (!this.generateRepair || !limit || this.repairJob || original.length > 200000 || (!manual && readRepair(message))) {
            this.report('本轮数据未提交；自动纠错已关闭、已尝试或暂不可用。'); return false;
        }
        const length = ctx.chat.length, prior = readRepair(message);
        const job = { message, metadata: ctx.chatMetadata, cancelled: false };
        this.repairJob = job;
        const record = { version: 1, reply: original, original, status: 'pending', baseRevision: before.revision,
            attempts: [], previousAttempts: (prior?.previousAttempts ?? 0) + (prior?.attempts?.length ?? 0), manual, failure: frameworkFailure(error) };
        let rejected = original, failure = record.failure;
        const valid = () => !job.cancelled && this.active() && this.getContext().chatMetadata === ctx.chatMetadata
            && ctx.chat.length === length && ctx.chat.at(-1) === message && message.mes === original && (message.swipe_id ?? 0) === swipe
            && !this.saving && JSON.stringify(this.state()) === JSON.stringify(before)
            && (!generation || this.generation === generation);
        const persist = async () => {
            const extra = message.extra ? cloneFramework(message.extra) : undefined, info = message.swipe_info ? cloneFramework(message.swipe_info) : undefined;
            this.saving = true; writeRepair(message, record);
            try { await this.save(); }
            catch (err) { if (extra === undefined) delete message.extra; else message.extra = extra; if (info === undefined) delete message.swipe_info; else message.swipe_info = info; throw err; }
            finally { this.saving = false; }
            this.repairStatus();
        };
        try {
            for (let attempt = 1; attempt <= limit; attempt++) {
                if (!valid()) return false;
                record.status = 'requesting'; record.attempts.push({ attempt, status: 'requesting', failure });
                // Persist the budget before any request. Reload cannot restart it.
                await persist(); if (!valid()) return false;
                let raw;
                try { raw = await this.generateRepair(repairPrompt(before, original, rejected, failure, ctx.chat.slice(Math.max(0,length-5),-1).filter(m => !m.is_system))); }
                catch { if (valid()) { record.status = 'request_failed'; record.attempts.at(-1).status = 'request_failed'; await persist(); } return false; }
                if (!valid()) return false;
                if (typeof raw !== 'string' || raw.length > 180000) { record.status = 'failed'; record.attempts.at(-1).status = 'output_limit'; await persist(); return false; }
                record.attempts.at(-1).output = raw;
                let result;
                try { result = correctedResult(raw, before, original); }
                catch (err) {
                    failure = frameworkFailure(err); record.attempts.at(-1).failure = failure; record.attempts.at(-1).status = 'rejected';
                    record.status = 'failed'; await persist();
                    if (!repairable(failure) || raw === rejected) return false;
                    rejected = raw; continue;
                }
                if (!valid()) return false;
                const backup = cloneFramework(message);
                record.status = 'corrected'; record.reply = result.visibleText; record.revision = result.state.revision;
                record.attempts.at(-1).status = 'accepted';
                this.saving = true;
                try {
                    message.mes = result.visibleText;
                    if (message.swipes) message.swipes[swipe] = message.mes;
                    writeFrameworkSnapshot(message, result.state); writeRepair(message, record);
                    await this.save();
                } catch (err) {
                    for (const key of ['mes','swipes','extra','swipe_info']) { if (backup[key] === undefined) delete message[key]; else message[key] = backup[key]; }
                    throw err;
                } finally { this.saving = false; }
                this.observe(message, { status: 'corrected', baseRevision: before.revision, revision: result.state.revision });
                if (this.getContext().chatMetadata === ctx.chatMetadata) this.render(result.state, { message, changes: result.changes, repaired: true });
                return true;
            }
            return false;
        } catch {
            this.uncertainSaves.add(message);
            this.observe(message, { status: 'save_failed', code: 'repair_save_readback' });
            this.report('纠错记录保存或回读失败，结果尚未确认；已停止重试。'); return false;
        } finally {
            if (this.repairJob === job) this.repairJob = null;
            this.repairStatus();
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
