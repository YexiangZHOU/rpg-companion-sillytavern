import { layoutMetrics } from './layoutMetrics.mjs';
/** Layout only: move existing nodes; never clone editors or keep tracker data. */
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { i18n } from '../../core/i18n.js';

export const wantsBalancedLayout = () => extensionSettings.layoutMode === 'balanced';
let root, left, right, player, scene, toolbar, scrim, more, tabs, resizeObserver, themeObserver, widthProbe, frame;
let drawer = null, returnFocus = null, mode = '', originals = [], inertNodes = [];
const sections = ['rpg-user-stats', 'rpg-info-box', 'rpg-thoughts', 'rpg-inventory', 'rpg-quests', 'rpg-music-player'];
const text = key => i18n.getTranslation(`layout.${key}`) || ({player:'My character',scene:'Current scene',sheet:'Character sheet',inventory:'Inventory',quests:'Quests',more:'More',close:'Close',thoughts:'Thoughts',appearance:'Appearance',events:'Recent events',sync:'Sheet sync',unknown:'Unknown'})[key] || key;
const prefs = () => extensionSettings.balancedLayout || {};
function remember(change) {
    extensionSettings.balancedLayout = { ...prefs(), ...change };
    saveSettings();
}
function node(tag, className, value) {
    const el = document.createElement(tag);
    el.className = className;
    if (value) el.textContent = value;
    return el;
}
function label(el, key) {
    el.dataset.i18nKey = `layout.${key}`;
    el.textContent = text(key);
    return el;
}
function button(key, onClick) {
    const el = label(node('button','rpg-balanced-button'),key);
    el.type = 'button';
    el.addEventListener('click',onClick);
    return el;
}
function move(el, destination) {
    if (!el) return;
    const marker = document.createComment('rpg-balanced-origin');
    el.before(marker);
    originals.push([el,marker]);
    destination.append(el);
}
function setTab(tab, persist = false) {
    if (!root) return;
    if (!['sheet','inventory','quests'].includes(tab) || (tab === 'inventory' && !extensionSettings.showInventory) || (tab === 'quests' && !extensionSettings.showQuests)) tab = 'sheet';
    root.dataset.playerTab = tab;
    player.querySelectorAll('[role="tab"]').forEach(el => {
        const selected = el.dataset.tab === tab;
        el.setAttribute('aria-selected',String(selected));
        el.tabIndex = selected ? 0 : -1;
        el.hidden = el.dataset.tab === 'inventory' && !extensionSettings.showInventory || el.dataset.tab === 'quests' && !extensionSettings.showQuests;
    });
    player.querySelectorAll('[role="tabpanel"]').forEach(el => { el.hidden = el.dataset.tab !== tab; });
    if (persist) remember({ tab });
}
function restoreInert() {
    inertNodes.forEach(([el,value]) => { el.inert = value; });
    inertNodes = [];
}
function closeDrawer(restoreFocus = true) {
    restoreInert();
    if (drawer) {
        drawer.classList.remove('rpg-balanced-drawer');
        drawer.removeAttribute('aria-modal');
        drawer.removeAttribute('role');
    }
    drawer = null;
    if (scrim) scrim.hidden = true;
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
}
function drawerControls() {
    return drawer ? [...drawer.querySelectorAll('button,select,input,textarea,summary,[contenteditable="true"],a[href]')]
        .filter(el => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility === 'visible') : [];
}
function finishOpening(event) {
    if (event.target === drawer && toolbar?.contains(document.activeElement)) drawerControls()[0]?.focus();
}
function toggleSide(side, trigger) {
    const pane = side === 'left' ? left : right;
    const isDrawer = mode === 'mobile' || side === 'left' && mode === 'compact';
    if (isDrawer) {
        const wasOpen = drawer === pane;
        closeDrawer(wasOpen);
        if (!wasOpen) {
            returnFocus = trigger;
            drawer = pane;
            pane.hidden = false;
            pane.inert = false;
            pane.classList.add('rpg-balanced-drawer');
            pane.setAttribute('role','dialog');
            pane.setAttribute('aria-modal','true');
            scrim.hidden = false;
            // Only inert the chat and the other pane; existing ST popups remain usable.
            [document.getElementById('sheld'),side === 'left' ? right : left].filter(Boolean).forEach(el => {
                inertNodes.push([el,el.inert]); el.inert = true;
            });
        }
        refreshBalancedLayout();
        // Remove the closed visibility/inert state before moving keyboard focus.
        if (!wasOpen) requestAnimationFrame(() => {
            if (drawer === pane) drawerControls()[0]?.focus();
        });
    } else {
        remember({ [side + 'Collapsed']: !prefs()[side + 'Collapsed'] });
        refreshBalancedLayout();
    }
}
function keydown(event) {
    if (!drawer) return;
    if (event.key === 'Escape') {
        event.preventDefault(); closeDrawer(); refreshBalancedLayout();
    } else if (event.key === 'Tab') {
        const focusable = drawerControls();
        const first = focusable[0], last = focusable.at(-1);
        if (!drawer.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
}
function beforePopup(event) {
    if (drawer && event.target.closest('#rpg-open-settings,#rpg-open-tracker-editor,#rpg-dice-display')) {
        closeDrawer(false); refreshBalancedLayout();
    }
}
function updateSourceBadge() {
    const badge = root?.querySelector('.rpg-balanced-source');
    if (!badge) return;
    const source = extensionSettings.characterSheetState?.source;
    const key = ['model','manual','legacy'].includes(source) ? source : 'unknown';
    badge.dataset.i18nKey = `layout.source.${key}`;
    badge.textContent = i18n.getTranslation(badge.dataset.i18nKey) || 'Unconfirmed sheet';
}
function scheduleRefresh() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refreshBalancedLayout);
}
export function refreshBalancedLayout() {
    if (!root?.isConnected) return;
    positionBalancedDice();
    const width = document.documentElement.clientWidth;
    const metrics = layoutMetrics(width, widthProbe?.getBoundingClientRect().width);
    const nextMode = metrics.mode;
    root.style.setProperty('--rpg-side-width', metrics.side + 'px');
    root.style.setProperty('--rpg-drawer-width', metrics.drawer + 'px');
    root.style.setProperty('--rpg-portrait-size', ([48,64,80].includes(extensionSettings.portraitSize) ? extensionSettings.portraitSize : 64) + 'px');
    if (mode !== nextMode) closeDrawer();
    mode = nextMode;
    root.dataset.layoutSize = mode;
    const leftOpen = mode === 'desktop' && !prefs().leftCollapsed || drawer === left;
    const rightOpen = mode !== 'mobile' && !prefs().rightCollapsed || drawer === right;
    for (const [side, pane, open] of [['left',left,leftOpen],['right',right,rightOpen]]) {
        const handle = toolbar.querySelector(`[data-side="${side}"]`);
        pane.hidden = false;
        pane.classList.toggle('rpg-balanced-closed', !open);
        pane.setAttribute('aria-hidden', String(!open));
        // Closed drawers remain in the DOM for sliding, but cannot receive input.
        if (!open && pane.contains(document.activeElement)) handle.focus();
        if (drawer !== pane && !inertNodes.some(([el]) => el === pane)) pane.inert = !open;
        handle.setAttribute('aria-expanded', String(open));
        handle.setAttribute('aria-label', text(side === 'left' ? 'scene' : 'player'));
        handle.title = `${handle.getAttribute('aria-label')} · ${i18n.getTranslation('global.collapseExpandPanel') || 'Collapse/Expand Panel'}`;
        handle.classList.toggle('rpg-balanced-handle-open', open);
        // At phone widths the open handle crosses the opposite screen edge.
        // Keep only its own handle available until the modal drawer closes.
        handle.hidden = !!drawer && drawer !== pane;
        handle.querySelector('span').textContent = side === 'left' ? (open ? '❮' : '❯') : (open ? '❯' : '❮');
    }
    document.body.style.setProperty('--rpg-balanced-left', mode === 'desktop' && leftOpen ? metrics.reserve + 'px' : '0px');
    document.body.style.setProperty('--rpg-balanced-right', mode !== 'mobile' && rightOpen ? metrics.reserve + 'px' : '0px');
    if (window.visualViewport) {
        root.style.setProperty('--rpg-balanced-bottom',Math.max(0,window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop) + 'px');
    }
    setTab(prefs().tab);
    // The existing renderers own section visibility and saved values.
    root.querySelectorAll('.rpg-divider').forEach(el => { el.style.display = 'none'; });
}
export function mountBalancedLayout() {
    if (!wantsBalancedLayout() || !extensionSettings.enabled) return;
    if (root?.isConnected) { refreshBalancedLayout(); return; }
    root = document.getElementById('rpg-companion-panel');
    if (!root) return;
    const content = root.querySelector('.rpg-content-box');
    // Normalize legacy tabs while keeping the actual editable nodes and their handlers.
    const nodes = sections.map(id => document.getElementById(id)).filter(Boolean);
    nodes.forEach(el => $(el).detach());
    $(content).find('.rpg-tabs-container,.rpg-mobile-container,.rpg-mobile-tabs').remove();
    nodes.forEach(el => content.append(el));
    root.classList.remove('rpg-collapsed','rpg-mobile-open','rpg-mobile-closing');
    $('.rpg-mobile-overlay').remove();
    root.classList.add('rpg-balanced');
    document.body.classList.add('rpg-balanced-active');
    player = node('aside','rpg-balanced-right rpg-balanced-side'); player.id = 'rpg-balanced-player';
    const leftHeader = node('header','rpg-balanced-header');
    const title = label(node('strong',''), 'player'); title.id = 'rpg-balanced-player-title';
    player.setAttribute('aria-labelledby',title.id);
    leftHeader.append(title);
    const scroll = node('div','rpg-balanced-scroll');
    player.append(leftHeader,scroll); root.append(player);
    move(document.getElementById('rpg-user-stats'),scroll);
    tabs = node('div','rpg-balanced-tabs'); tabs.setAttribute('role','tablist');
    const sheet = node('div','rpg-balanced-sheet');
    ['sheet','inventory','quests'].forEach(key => {
        const tab = button(key,() => setTab(key,true));
        tab.dataset.tab = key; tab.id = `rpg-balanced-tab-${key}`; tab.setAttribute('role','tab');
        const panel = key === 'sheet' ? sheet : node('div','');
        panel.id = `rpg-balanced-page-${key}`; panel.dataset.tab = key; panel.setAttribute('role','tabpanel');
        panel.setAttribute('aria-labelledby',tab.id); tab.setAttribute('aria-controls',panel.id);
        if (key !== 'sheet') move(document.getElementById(`rpg-${key}`),panel);
        tabs.append(tab);
        if (key !== 'sheet') scroll.append(panel);
    });
    document.getElementById('rpg-user-stats').after(tabs);
    tabs.addEventListener('keydown',e => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
        e.preventDefault();
        const buttons = [...tabs.querySelectorAll('button')].filter(el => !el.hidden);
        const index = buttons.indexOf(document.activeElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length-1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].click(); buttons[next].focus();
    });
    scene = root.querySelector('.rpg-game-container'); scene.classList.add('rpg-balanced-side','rpg-balanced-left');
    const rightHeader = node('header','rpg-balanced-header'); rightHeader.id='rpg-balanced-scene-header';
    const sceneTitle = label(node('strong',''),'scene'); sceneTitle.id='rpg-balanced-scene-title';
    scene.setAttribute('aria-labelledby',sceneTitle.id);
    rightHeader.append(sceneTitle); scene.prepend(rightHeader);
    scene.id = 'rpg-balanced-scene';
    more = node('details','rpg-balanced-more'); more.append(label(node('summary',''),'more'));
    scroll.append(more);
    const featureKeys=['featureHtml','featureDialogue','featureDeception','featureOmniscience','featureCyoa','featureMusic','featureWeather','featureNarrator','featureAvatars'];
    root.querySelectorAll('.rpg-feature-col label').forEach((el,index)=>{
        const name=label(node('span','rpg-balanced-toggle-name'),featureKeys[index]); el.append(name);
    });
    ['#rpg-features-row','#rpg-manual-update','.rpg-settings-buttons-row','#rpg-music-player'].forEach(selector => move(root.querySelector(selector),more));
    // Physical sides are independent of player/scene ownership.
    left = scene; right = player;
    toolbar = node('nav','rpg-balanced-toolbar'); toolbar.id='rpg-balanced-toolbar';
    ['left','right'].forEach(side => {
        const btn = node('button',`rpg-balanced-handle rpg-balanced-handle-${side}`);
        btn.type = 'button';
        const arrow = node('span',''); arrow.setAttribute('aria-hidden','true'); btn.append(arrow);
        btn.addEventListener('click',e => toggleSide(side,e.currentTarget));
        btn.dataset.side = side; btn.setAttribute('aria-controls',side==='left' ? left.id : right.id); toolbar.append(btn);
    });
    // Edge handles live outside the scrolling panes and stay visible when folded.
    root.append(toolbar);
    scrim = node('button','rpg-balanced-scrim'); scrim.type='button'; scrim.setAttribute('aria-label',text('close')); scrim.hidden=true;
    scrim.addEventListener('click',() => { closeDrawer(); refreshBalancedLayout(); }); root.prepend(scrim);
    document.addEventListener('keydown',keydown);
    root.addEventListener('click',beforePopup,true);
    root.addEventListener('click',updateSourceBadge);
    root.addEventListener('focusout',updateSourceBadge);
    root.addEventListener('transitionend',finishOpening);
    window.addEventListener('resize',scheduleRefresh);
    window.visualViewport?.addEventListener('resize',scheduleRefresh);
    widthProbe = node('div','rpg-theme-width-probe'); root.append(widthProbe);
    resizeObserver = new ResizeObserver(scheduleRefresh); resizeObserver.observe(widthProbe);
    themeObserver = new MutationObserver(scheduleRefresh);
    themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['style','class']});
    const dice=document.getElementById('rpg-dice-display');
    if(dice)move(dice,dice.parentElement);
    decorateBalancedStats(); decorateBalancedScene(); refreshBalancedLayout();
}
export function unmountBalancedLayout() {
    closeDrawer(false);
    cancelAnimationFrame(frame); resizeObserver?.disconnect(); resizeObserver = null; themeObserver?.disconnect(); themeObserver = null; widthProbe?.remove(); widthProbe = null;
    document.removeEventListener('keydown',keydown);
    root?.removeEventListener('click',beforePopup,true);
    root?.removeEventListener('click',updateSourceBadge);
    root?.removeEventListener('focusout',updateSourceBadge);
    root?.removeEventListener('transitionend',finishOpening);
    window.removeEventListener('resize',scheduleRefresh);
    window.visualViewport?.removeEventListener('resize',scheduleRefresh);
    // Restore renderer-owned children before removing the layout containers.
    const stats = document.getElementById('rpg-user-stats');
    document.querySelectorAll('.rpg-balanced-sheet-body').forEach(el => { (stats?.querySelector('.rpg-stats-content') || stats)?.append(el); el.classList.remove('rpg-balanced-sheet-body'); });
    document.querySelectorAll('.rpg-balanced-sync').forEach(el => { [...el.children].filter(n => n.tagName !== 'SUMMARY').forEach(n => stats?.prepend(n)); el.remove(); });
    document.getElementById('rpg-balanced-page-sheet')?.remove();
    document.querySelectorAll('.rpg-balanced-event-fold,.rpg-balanced-field-fold').forEach(el => { el.replaceWith(...[...el.children].filter(n => n.tagName !== 'SUMMARY')); });
    document.querySelectorAll('.rpg-balanced-npc-summary').forEach(el=>el.remove());
    document.querySelectorAll('.rpg-balanced-npc-status').forEach(el=>el.replaceWith(...[...el.children].filter(n=>n.tagName!=='SUMMARY')));
    originals.reverse().forEach(([el,marker]) => { if (marker.isConnected) marker.replaceWith(el); }); originals=[];
    root?.querySelectorAll('.rpg-balanced-toggle-name').forEach(el=>el.remove());
    tabs?.remove(); toolbar?.remove(); player?.remove(); more?.remove(); scrim?.remove();
    document.getElementById('rpg-balanced-scene-header')?.remove();
    scene?.classList.remove('rpg-balanced-side','rpg-balanced-left','rpg-balanced-closed');
    if (scene?.id === 'rpg-balanced-scene') scene.removeAttribute('id');
    scene?.removeAttribute('aria-hidden'); if (scene) scene.inert = false;
    scene?.removeAttribute('aria-labelledby'); scene?.removeAttribute('hidden');
    root?.classList.remove('rpg-balanced');
    document.body.classList.remove('rpg-balanced-active');
    document.body.style.removeProperty('--rpg-balanced-left'); document.body.style.removeProperty('--rpg-balanced-right');
    root=null; left=null; right=null; player=null; scene=null; toolbar=null; more=null; scrim=null; tabs=null; mode='';
}
export function decorateBalancedStats() {
    if (!root?.isConnected) return;
    const stats = document.getElementById('rpg-user-stats');
    let sheet = stats.querySelector('#rpg-balanced-page-sheet');
    if (!sheet) {
        sheet = node('div','rpg-balanced-sheet');
        sheet.id='rpg-balanced-page-sheet'; sheet.dataset.tab='sheet';
        sheet.setAttribute('role','tabpanel'); sheet.setAttribute('aria-labelledby','rpg-balanced-tab-sheet');
        const fresh = stats.querySelector('.rpg-stats-right');
        const sync = stats.querySelector('.rpg-sheet-sync-controls');
        if (fresh) { fresh.classList.add('rpg-balanced-sheet-body'); sheet.append(fresh); }
        if (sync) {
            const source = extensionSettings.characterSheetState?.source || 'unknown';
            const key = ['model','manual','legacy'].includes(source) ? source : 'unknown';
            const badge = node('small','rpg-balanced-source');
            badge.dataset.i18nKey = `layout.source.${key}`;
            badge.textContent = i18n.getTranslation(badge.dataset.i18nKey) || 'Unconfirmed sheet';
            sheet.append(badge);
            const fold = node('details','rpg-balanced-sync');
            fold.append(label(node('summary',''),'sync'),sync); sheet.append(fold);
        }
        stats.append(sheet);
    }
    sheet.hidden = root.dataset.playerTab !== 'sheet';
    sheet.style.display = extensionSettings.showUserStats ? '' : 'none';
    // Keep keyboard/reading order aligned with the visual summary → tabs → sheet order.
    // Native tab listeners survive renderer replacement and reattachment of this same node.
    if (tabs) {
        if (extensionSettings.showUserStats) sheet.before(tabs);
        else stats.after(tabs);
    }
}
export function decorateBalancedScene() {
    if (!root?.isConnected) return;
    const info = document.getElementById('rpg-info-box');
    const events = info?.querySelector('.rpg-dashboard-row-3');
    if (events && !events.closest('details')) {
        const fold = node('details','rpg-balanced-event-fold');
        fold.append(label(node('summary',''),'events')); events.before(fold); fold.append(events);
    }
    positionBalancedDice();
    document.querySelectorAll('#rpg-thoughts .rpg-character-card').forEach(card=>{
        const stats=card.querySelector('.rpg-character-stats'),condition=card.querySelector('[data-npc-condition]')?.closest('.rpg-character-field');
        if((!stats && !condition) || card.querySelector('.rpg-balanced-npc-status'))return;
        const detail=node('details','rpg-balanced-npc-status');
        detail.append(label(node('summary',''),'npcStatusDetails'));
        const content=card.querySelector('.rpg-character-content');content.append(detail);
        if(stats)detail.append(stats);
        if(condition)detail.append(condition);
    });
    refreshBalancedNpcSummary();
    document.querySelectorAll('#rpg-thoughts .rpg-character-field').forEach(field => {
        const id = field.querySelector('[data-field]')?.dataset.field || field.dataset.field || '';
        const appearance = extensionSettings.trackerConfig?.presentCharacters?.customFields?.find(f => f.id === 'appearance');
        if (appearance && id === appearance.name && !field.closest('details')) {
            const fold = node('details','rpg-balanced-field-fold');
            // Translate the default display name; data-field and lock paths stay unchanged.
            const summary = appearance.name === 'Appearance'
                ? label(node('summary',''),'appearance') : node('summary','',appearance.name);
            fold.append(summary); field.before(fold); fold.append(field);
        }
    });
    // Keep existing editable description nodes above appearance; retain locks/listeners.
    document.querySelectorAll('#rpg-thoughts .rpg-character-info').forEach(info => {
        const fold=info.querySelector(':scope > .rpg-balanced-field-fold');
        if(!fold)return;
        const descriptions=[...info.children].filter(el=>el.classList.contains('rpg-character-field') && !el.querySelector('[data-npc-condition]'));
        if(descriptions.length)descriptions[descriptions.length-1].after(fold);
    });
}
/** Detach the original dice node before the info renderer replaces its children. */
export function preserveBalancedDice() {
    if(!root?.isConnected)return;
    const frameworkScroll = root.classList.contains('rpg-framework-active') && document.getElementById('rpg-framework-scene-scroll');
    const dice = document.getElementById('rpg-dice-display');
    if (frameworkScroll && dice) { if (dice.parentElement !== frameworkScroll) frameworkScroll.prepend(dice); return; }
    const entry=originals.find(([el])=>el.id==='rpg-dice-display');
    if(entry?.[1].isConnected)entry[1].after(entry[0]);
}
function positionBalancedDice() {
    if (root?.classList.contains('rpg-framework-active')) { preserveBalancedDice(); return; }
    const info=document.getElementById('rpg-info-box'),fold=info?.querySelector('.rpg-balanced-event-fold'),dice=document.getElementById('rpg-dice-display');
    if(fold && dice && extensionSettings.showInfoBox && info.style.display!=='none') {
        if(fold.previousElementSibling!==dice)fold.before(dice);
    } else preserveBalancedDice();
}
// Retain the existing renderer import; summaries are no longer duplicated outside Status.
export function refreshBalancedNpcSummary() {
    document.querySelectorAll('#rpg-thoughts .rpg-balanced-npc-summary').forEach(el=>el.remove());
}
