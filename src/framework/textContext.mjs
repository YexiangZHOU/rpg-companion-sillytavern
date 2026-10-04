/** Preserve source offsets while excluding quoted/code examples from execution. */
export function frameworkVisibleText(raw) {
    let fence = null;
    const blank = text => text.replace(/[^\n\r]/g, ' ');
    const inline = text => text.replace(/(`+).*?\1/g, blank);
    return raw.split(/(?<=\n)/).map(line => {
        if (/^\s*>/.test(line)) return blank(line);
        const marker = line.match(/^[ \t]*(`{3,}|~{3,})/);
        if (fence) {
            if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) {
                const rest = line.slice(marker[0].length);
                if (/^\s*$/.test(rest)) { fence = null; return blank(line); }
                // A narrow compatibility boundary: the model closed an existing
                // fence and immediately started an explicitly tagged transaction.
                // Never expose an opening fence, other trailing prose or code.
                if (/^[ \t]*<rpg-framework>/.test(rest)) {
                    fence = null;
                    return blank(marker[0]) + inline(rest);
                }
            }
            return blank(line);
        }
        if (marker) { fence = marker[1]; return blank(line); }
        return inline(line);
    }).join('');
}
