import { emptyFramework, validateFramework, FrameworkError } from './state.mjs';
import { applyFrameworkReply, FrameworkProtocolError } from './protocol.mjs';

/** A review hint, never an inferred scene transition or a state mutation. */
export function frameworkSceneWarnings(state) {
    return state.entities.filter(e => e.kind === 'scene' && !e.archived).length > 1 ? ['multiple_active_scenes'] : [];
}

/** Only fixed codes enter diagnostics; provider errors, prompts and credentials do not. */
export function frameworkFailure(error) {
    if (error instanceof FrameworkProtocolError) return { status: 'parse_rejected', code: error.code };
    if (error instanceof FrameworkError) return { status: 'validation_rejected', code: error.code };
    return { status: 'internal_error', code: 'unexpected' };
}

/** Ephemeral observations are bound to the exact message and selected swipe. */
export class FrameworkObservations {
    constructor() { this.messages = new WeakMap(); }
    record(message, event) {
        const entries = this.messages.get(message) ?? new Map();
        entries.set(message.swipe_id ?? 0, { reply: message.mes, event: { ...event, at: new Date().toISOString() } });
        this.messages.set(message, entries);
    }
    get(message) {
        const item = this.messages.get(message)?.get(message.swipe_id ?? 0);
        return item?.reply === message.mes ? item.event : null;
    }
}

/** Read-only review. Replay never becomes a commit or a claim about the original run. */
export function reviewFrameworkChat(messages, observations, limit = 100) {
    let state = emptyFramework(), baselineKnown = true;
    const rows = [];
    for (const [index, message] of messages.entries()) {
        if (message.is_user || message.is_system || typeof message.mes !== 'string') continue;
        const swipe = message.swipe_id ?? 0;
        const row = { message: index + 1, swipe, baseRevision: baselineKnown ? state.revision : null };
        const snapshot = (message.extra?.rpg_framework_swipes ?? message.swipe_info?.[swipe]?.extra?.rpg_framework_swipes)?.[swipe];
        const observed = observations?.get(message);
        if (snapshot?.reply === message.mes) {
            try {
                if (snapshot.protocol !== 1) throw Error('version');
                validateFramework(snapshot.state); state = snapshot.state; baselineKnown = true;
                Object.assign(row, { status: 'snapshot', basis: 'saved_snapshot', revision: state.revision, warnings: frameworkSceneWarnings(state) });
            } catch { baselineKnown = false; Object.assign(row, { status: 'invalid_snapshot', basis: 'replay', code: 'snapshot' }); }
        } else if (observed) Object.assign(row, observed, { basis: 'observed_this_page' });
        else if (!baselineKnown) Object.assign(row, { status: 'unknown_baseline', basis: 'replay' });
        else {
            try {
                const result = applyFrameworkReply(message.mes, state);
                Object.assign(row, { status: result.accepted ? 'valid_uncommitted' : 'no_protocol', ...result.diagnostic, basis: 'replay', warnings: frameworkSceneWarnings(result.state) });
            } catch (error) { Object.assign(row, frameworkFailure(error), { basis: 'replay' }); }
        }
        rows.push(row);
    }
    return { version: 1, scope: 'current_selected_swipes', total: rows.length, truncated: rows.length > limit, rows: rows.slice(-limit) };
}

export function frameworkDiagnosticLabel(row, zh = true) {
    const labels = {
        snapshot: ['已有保存快照', 'Saved snapshot'], accepted: ['保存并回读通过', 'Saved and verified'],
        no_protocol: ['本轮未提交框架数据（可能没有变化）', 'No framework data (possibly no change)'],
        ignored_protocol: ['框架标签位于示例、引用或代码块，未执行', 'Framework tags in an example, quote or code block; not executed'],
        parse_rejected: ['协议 / JSON 解析失败', 'Protocol / JSON parse failed'], validation_rejected: ['数据校验拒绝', 'Data validation rejected'],
        save_failed: ['保存或回读失败，服务器结果未确认', 'Save or readback failed; server result unknown'],
        conflict: ['生成期间数据变化，拒绝覆盖', 'Concurrent change; overwrite rejected'],
        busy: ['其他保存进行中，本轮未处理', 'Another save in progress; not processed'],
        valid_uncommitted: ['重放校验合法，但没有对应保存快照', 'Valid on replay, without matching saved snapshot'],
        invalid_snapshot: ['已有快照无法校验', 'Invalid saved snapshot'], unknown_baseline: ['此前快照损坏，无法判定', 'Cannot evaluate after invalid snapshot'],
        internal_error: ['处理异常', 'Processing error'],
    };
    return (labels[row.status] ?? labels.internal_error)[zh ? 0 : 1];
}
