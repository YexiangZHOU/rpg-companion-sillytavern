/** Geometry uses the theme's unconstrained width, never the rendered chat width. */
export function layoutMetrics(width, themeWidth) {
    const mode = width >= 1200 ? 'desktop' : width > 1000 ? 'compact' : 'mobile';
    const clearance = 6 + 44 + 8;
    const preferred = Number.isFinite(themeWidth) && themeWidth > 0 ? themeWidth : width * .5;
    const chat = Math.min(preferred, width - 2 * (270 + clearance));
    const side = mode === 'desktop' ? Math.max(270, (width - chat) / 2 - clearance) : 270;
    return { mode, side, reserve: side + clearance - 8, drawer: Math.min(340, width - 64) };
}
