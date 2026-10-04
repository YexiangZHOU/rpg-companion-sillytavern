/** Display-only extraction. It never repairs, executes or commits a transaction. */
export function frameworkDisplayBlocks(raw) {
    if (typeof raw !== 'string' || raw.length > 1500000) return [];
    let fenced = false;
    const masked = raw.split(/(?<=\n)/).map(line => {
        if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; return line.replace(/[^\n]/g, ' '); }
        return fenced || /^\s*>/.test(line) ? line.replace(/[^\n]/g, ' ') : line.replace(/(`+).*?\1/g, m => m.replace(/[^\n]/g, ' '));
    }).join('');
    const blocks = [];
    let consumed = 0;
    for (const match of masked.matchAll(/<rpg-framework>/g)) {
        if (match.index < consumed) continue;
        let quoted = false, escaped = false, end = raw.length, complete = false;
        for (let cursor = match.index + match[0].length; cursor < raw.length; cursor++) {
            const char = raw[cursor];
            if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
            if (raw.startsWith('</rpg-framework>', cursor)) { end = cursor + 16; complete = true; break; }
            if (char === '"') quoted = true;
        }
        blocks.push({ start: match.index, end, raw: raw.slice(match.index, end), complete });
        consumed = end;
    }
    return blocks;
}

export function frameworkMessagePresentation(raw) {
    const blocks = frameworkDisplayBlocks(raw);
    let visible = '', start = 0;
    for (const block of blocks) { visible += raw.slice(start, block.start); start = block.end; }
    visible += raw.slice(start);
    return { visible: blocks.length ? visible.trimEnd() : raw, blocks };
}
