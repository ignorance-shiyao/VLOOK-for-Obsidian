// 导出 HTML 的多主题内嵌与切换：主题样式随文件携带，页面右下角切换，不依赖插件或网络。
import type VlookPlugin from '../main';
import { themeColor, themeLabel } from '../core/themes';
import { resolveRemoteFonts } from '../core/page-appearance';

/** common：该主题依赖的公共样式编号，对应页面中的 text/vlook-common；css 只含主题独有的一层。 */
export interface EmbeddedTheme { name: string; label: string; color: string; css: string; common?: string }

const scriptText = (css: string) => css.replace(/<\/(script)/gi, '<\\/$1');

/** 主题 CSS 放在惰性 script 中，只有被选中的一份进入 #style-theme_css；公共样式整页只写一次。 */
export function embeddedThemesHtml(current: string, themes: EmbeddedTheme[], commons = new Map<string, string>()): string {
    const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return [
        ...[...commons].map(([id, css]) => `<script type="text/vlook-common" data-common="${attr(id)}">${scriptText(css)}</script>`),
        ...themes.map(theme => `<script type="text/vlook-theme" data-theme="${attr(theme.name)}" data-label="${attr(theme.label)}" data-color="${attr(theme.color)}"${theme.common ? ` data-common="${attr(theme.common)}"` : ''}${theme.name === current ? ' data-current=""' : ''}>${theme.name === current ? '' : scriptText(theme.css)}</script>`),
    ].join('\n');
}

/** 导出所选主题：当前主题已内联在页面中，其余主题共用的公共样式只写入一次。 */
export async function exportThemesHtml(plugin: VlookPlugin, current: string, names: string[]): Promise<string> {
    const strip = (css: string) => resolveRemoteFonts(css, !!plugin.settings.remoteFonts);
    const commons = new Map<string, string>();
    const ids = new Map<string, string>();
    const items: EmbeddedTheme[] = [];
    for (const name of names) {
        const base = { name, label: themeLabel(name), color: themeColor(name) };
        if (name === current) { items.push({ ...base, css: '' }); continue; }
        await plugin.ensureTheme(name);
        let layers;
        try { layers = await plugin.themeStore.layers(name, 'export'); } catch { layers = null; }
        if (!layers) continue;
        const common = strip(layers.common);
        let id: string | undefined;
        if (common) {
            id = ids.get(common);
            if (!id) { id = `c${ids.size}`; ids.set(common, id); commons.set(id, common); }
        }
        items.push({ ...base, css: strip(layers.theme), common: id });
    }
    return items.length > 1 ? embeddedThemesHtml(current, items, commons) : '';
}

/** 在导出页内运行：切换主题后按当前明暗重算原版运行时写在 <html> 上的颜色变量。 */
export function installExportThemeSwitcher(doc: Document): void {
    const style = doc.getElementById('style-theme_css');
    const sources = Array.from(doc.querySelectorAll<HTMLScriptElement>('script[type="text/vlook-theme"]'));
    const win = doc.defaultView;
    if (!style || sources.length < 2 || !win) return;
    const root = doc.documentElement;
    const initial = sources.find(source => source.hasAttribute('data-current'));
    if (initial) initial.textContent = style.textContent;
    let fadeTimer = 0;
    const KEY = 'vlook-export-theme';
    const read = (name: string) => win.getComputedStyle(root).getPropertyValue(name).trim();
    const vars = () => read('--thm-cs-vars').replace(/^["']|["']$/g, '').split(',').map(v => v.trim()).filter(Boolean);
    const dark = () => {
        let saved: string | null = null;
        try { saved = win.localStorage.getItem('color-scheme'); } catch { /* 隐私模式 */ }
        return saved === 'dark' || saved !== 'light' && win.matchMedia('(prefers-color-scheme: dark)').matches;
    };
    // 自绘下拉：导出页不依赖插件，这里自成一体
    const box = doc.createElement('div');
    box.className = 'vlook-export-theme';
    const trigger = doc.createElement('button');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', '主题');
    const list = doc.createElement('div');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', '主题');
    list.tabIndex = -1;
    const items = sources.map(source => {
        const item = doc.createElement('div');
        item.setAttribute('role', 'option');
        item.dataset.value = source.dataset.theme || '';
        item.textContent = source.dataset.label || item.dataset.value;
        item.style.setProperty('--vlook-theme-dot', source.dataset.color || 'currentColor');
        list.append(item);
        return item;
    });
    box.append(trigger, list);
    let value = '', active = 0;
    const setValue = (name: string) => {
        value = name;
        const at = Math.max(0, items.findIndex(item => item.dataset.value === name));
        items.forEach((item, i) => item.setAttribute('aria-selected', String(i === at)));
        trigger.textContent = items[at].textContent;
        box.style.setProperty('--vlook-theme-dot', items[at].style.getPropertyValue('--vlook-theme-dot'));
    };
    const highlight = (index: number) => {
        active = Math.max(0, Math.min(items.length - 1, index));
        items.forEach((item, i) => item.classList.toggle('active', i === active));
    };
    const close = () => { box.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); };
    const open = () => {
        box.classList.add('open'); trigger.setAttribute('aria-expanded', 'true');
        highlight(items.findIndex(item => item.dataset.value === value));
        list.focus({ preventScroll: true });
    };
    let syncing = false, moved = false;
    const sync = () => {
        syncing = true;
        const flag = dark() ? 'dk' : 'lg';
        // 先批量读、再批量写：逐个「写-读」会让浏览器对整页反复重算样式，切换主题要数秒
        const names = vars();
        const values = names.map(v => read(`${v}-${flag}`));
        names.forEach((v, i) => root.style.setProperty(v, values[i]));
        syncing = false;
    };
    const sheets = new Map<string, HTMLStyleElement>();
    const linksOf = new Map<HTMLStyleElement, HTMLLinkElement[]>();
    const deferred = new Map<HTMLStyleElement, string[]>();
    let shown = style as HTMLStyleElement;
    if (initial?.dataset.theme) sheets.set(initial.dataset.theme, shown);
    const cssOf = (source: HTMLScriptElement) => {
        const id = source.dataset.common;
        const common = id ? Array.from(doc.querySelectorAll<HTMLScriptElement>('script[type="text/vlook-common"]')).find(item => item.dataset.common === id) : undefined;
        return (common?.textContent || '') + (source.textContent || '');
    };
    const importRe = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^"';)\s]+))\s*\)?[^;]*;/g;
    const sheetOf = (name: string, source: HTMLScriptElement) => {
        let el = sheets.get(name);
        if (el) return el;
        const urls: string[] = [];
        const text = cssOf(source).replace(importRe, (_m, a, b, c) => { urls.push(a || b || c); return ''; });
        el = doc.createElement('style');
        el.media = 'not all';
        el.textContent = text;
        shown.after(el);
        linksOf.set(el, []);
        deferred.set(el, urls);
        sheets.set(name, el);
        return el;
    };
    const apply = (name: string) => {
        root.classList.add('vlook-fading');
        win.clearTimeout(fadeTimer);
        fadeTimer = win.setTimeout(() => root.classList.remove('vlook-fading'), 650);
        const source = sources.find(item => item.dataset.theme === name);
        if (!source) return;
        // 切换后各主题的字号 / 行距不同，以视口顶部的内容块为锚点保持阅读位置，避免页面跳动
        let anchor: { el: Element; top: number } | null = null;
        for (const el of Array.from(doc.querySelectorAll('#write > *'))) {
            const box = el.getBoundingClientRect();
            if (box.bottom > 0) { anchor = { el, top: box.top }; break; }
        }
        const keep = () => { if (anchor?.el.isConnected) win.scrollBy(0, anchor.el.getBoundingClientRect().top - anchor.top); };
        syncing = true;
        for (const v of vars()) root.style.removeProperty(v);
        // 每个主题只解析一次：切换仅切换样式表的 media，避免反复解析上百 KB 的 CSS 与重复拉取字体
        const next = sheetOf(name, source);
        if (next !== shown) {
            for (const el of [shown, ...(linksOf.get(shown) || [])]) el.media = 'not all';
            // 字体等外链只在主题首次被选中时才创建，避免一次性拉取全部主题的网络资源
            const urls = deferred.get(next);
            if (urls) {
                deferred.delete(next);
                linksOf.set(next, urls.map(href => {
                    const link = doc.createElement('link');
                    link.rel = 'stylesheet'; link.href = href;
                    next.before(link);
                    return link;
                }));
            }
            for (const el of [next, ...(linksOf.get(next) || [])]) el.media = 'all';
            shown = next;
        }
        syncing = false;
        sync();
        // 浏览器标题栏色与页面图标由原版运行时在启动时写入，随主题同步
        const accent = read('--ac-t1');
        if (accent) doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', accent);
        const icon = read('--thm-fav').match(/url\((["']?)(.*?)\1\)/)?.[2];
        if (icon) doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach(link => { link.href = icon; });
        setValue(name);
        moved = true;
        keep();
        win.requestAnimationFrame(keep);
        win.setTimeout(keep, 250);
    };
    const choose = (name: string) => {
        apply(name);
        try { win.localStorage.setItem(KEY, name); } catch { /* 隐私模式 */ }
    };
    // 空闲时逐个预解析其余主题，首次切换也不卡顿
    const warm = (rest: HTMLScriptElement[]) => {
        const source = rest.shift();
        if (!source) return;
        sheetOf(source.dataset.theme || '', source);
        const next = () => warm(rest);
        const idle = (win as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
        if (idle) idle.call(win, next); else win.setTimeout(next, 200);
    };
    win.setTimeout(() => warm(sources.filter(source => !sheets.has(source.dataset.theme || ''))), 1500);
    trigger.addEventListener('click', () => box.classList.contains('open') ? close() : open());
    items.forEach((item, i) => {
        item.addEventListener('click', () => { choose(item.dataset.value || ''); close(); trigger.focus(); });
        item.addEventListener('pointermove', () => highlight(i));
    });
    list.addEventListener('pointerdown', event => event.preventDefault());
    box.addEventListener('focusout', event => { if (!box.contains(event.relatedTarget as Node | null)) close(); });
    list.addEventListener('keydown', event => {
        const keys: Record<string, () => void> = {
            ArrowDown: () => highlight(active + 1), ArrowUp: () => highlight(active - 1),
            Home: () => highlight(0), End: () => highlight(items.length - 1),
            Enter: () => { choose(items[active].dataset.value || ''); close(); trigger.focus(); },
            Escape: () => { close(); trigger.focus(); },
        };
        const run = keys[event.key] || (event.key === ' ' ? keys.Enter : undefined);
        if (run) { event.preventDefault(); run(); }
    });
    trigger.addEventListener('keydown', event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); } });
    const css = doc.createElement('style');
    css.textContent = ".vlook-export-theme{position:fixed;left:16px;bottom:16px;z-index:2147483000;font:12px/1.4 -apple-system,\"PingFang SC\",\"Segoe UI\",sans-serif;color:var(--d-f,inherit);opacity:.85;transition:opacity .2s}.vlook-export-theme:hover,.vlook-export-theme.open,.vlook-export-theme:focus-within{opacity:1}.vlook-export-theme button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;height:30px;padding:0 12px 0 10px;border:1px solid var(--d-bc,rgba(128,128,128,.35));border-radius:15px;cursor:pointer;background:var(--d-bg,Canvas);box-shadow:0 2px 8px rgba(0,0,0,.12);transition:transform .15s,box-shadow .2s}.vlook-export-theme button:hover{box-shadow:0 4px 14px rgba(0,0,0,.18)}.vlook-export-theme button:active{transform:scale(.97)}.vlook-export-theme button:focus-visible{outline:2px solid var(--vlook-theme-dot,currentColor);outline-offset:2px}.vlook-export-theme button::before{content:\"\";width:8px;height:8px;border-radius:50%;background:var(--vlook-theme-dot,currentColor)}.vlook-export-theme [role=listbox]{position:absolute;left:0;bottom:calc(100% + 8px);min-width:100%;max-height:50vh;overflow:auto;padding:5px;outline:none;border:1px solid var(--d-bc,rgba(128,128,128,.35));border-radius:12px;background:var(--d-bg,Canvas);box-shadow:0 12px 32px rgba(0,0,0,.2);opacity:0;visibility:hidden;transform:translateY(6px) scale(.98);transform-origin:bottom left;transition:opacity .15s,transform .2s,visibility 0s linear .2s}.vlook-export-theme.open [role=listbox]{opacity:1;visibility:visible;transform:none;transition-delay:0s}.vlook-export-theme [role=option]{display:flex;align-items:center;gap:8px;padding:5px 10px;border-radius:7px;cursor:pointer;white-space:nowrap}.vlook-export-theme [role=option]::before{content:\"\";width:8px;height:8px;border-radius:50%;background:var(--vlook-theme-dot,currentColor)}.vlook-export-theme [role=option].active{background:rgba(128,128,128,.16)}.vlook-export-theme [role=option][aria-selected=true]{font-weight:600}@media (prefers-reduced-motion:reduce){.vlook-export-theme,.vlook-export-theme *{transition:none!important}}@media print{.vlook-export-theme{display:none}}";
    css.textContent += ".v-toolbar:has(.theme-switch){width:max-content!important}.vlook-export-theme.docked{left:auto;bottom:auto}.vlook-export-theme.docked>button{display:none}.vlook-export-theme.docked [role=listbox]{top:0;bottom:auto}";
    doc.head.append(css);
    doc.body.append(box);
    // 聚合：原版工具栏出现后，主题切换并入其中成为一个按钮；工具栏被关闭或迟迟不出现时保留左下角的独立入口
    const dock = (toolbar: Element) => {
        if (toolbar.querySelector('.theme-switch')) return;
        const group = doc.createElement('div');
        group.className = 'v-btn-group theme v-float-card float';
        const btn = doc.createElement('div');
        btn.className = 'v-btn theme-switch v-transition-all';
        btn.setAttribute('role', 'button'); btn.tabIndex = 0;
        btn.setAttribute('aria-label', '主题'); btn.dataset.tips = '主题';
        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="v-svg-i-small"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/></svg>';
        // 与原版按钮组一致右浮；工具栏宽度由原版运行时写定，需为新增按钮组让出位置
        btn.dataset.btnGroup = '';
        // 聚合：优先并入「视图」按钮组，没有该组时才单独成组
        const host = toolbar.querySelector('.v-btn-group.view');
        if (host) host.append(btn);
        else { group.style.cssText = 'float:right;margin-left:20px;display:flex'; group.append(btn); toolbar.append(group); }
        box.classList.add('docked');
        const toggle = () => {
            if (box.classList.contains('open')) { close(); return; }
            const rect = btn.getBoundingClientRect();
            box.style.left = `${Math.max(8, Math.min(rect.right + 8, win.innerWidth - 200))}px`;
            box.style.top = `${Math.max(8, rect.top)}px`;
            open();
        };
        btn.addEventListener('click', toggle);
        btn.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
    };
    const existing = doc.querySelector('.v-toolbar');
    if (existing) dock(existing);
    else {
        const watch = new win.MutationObserver(() => { const toolbar = doc.querySelector('.v-toolbar'); if (toolbar) { watch.disconnect(); dock(toolbar); } });
        watch.observe(doc.body, { childList: true, subtree: true });
        win.setTimeout(() => watch.disconnect(), 8000);
    }
    let saved: string | null = null;
    try { saved = win.localStorage.getItem(KEY); } catch { /* 隐私模式 */ }
    const start = initial?.dataset.theme || sources[0].dataset.theme || '';
    setValue(start);
    // 等原版运行时完成首次颜色方案初始化后再切换，避免被其覆盖
    if (saved && saved !== start) win.addEventListener('load', () => win.setTimeout(() => apply(saved!), 300), { once: true });
    // 明暗切换后，原版只更新它启动时读到的变量集；按新主题再同步一次
    win.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => win.setTimeout(() => apply(value), 50));
    win.addEventListener('storage', event => { if (event.key === 'color-scheme') sync(); });
    // 原版明暗切换只改写它启动时读到的变量集；各主题变量集不同，切换后补齐当前主题的完整变量集
    let pending = 0;
    new win.MutationObserver(() => {
        if (syncing || value === start && !moved) return;
        win.clearTimeout(pending); pending = win.setTimeout(sync, 30);
    }).observe(root, { attributes: true, attributeFilter: ['style'] });
}

/** 导出页：系统明暗变化与状态栏操作时渐变。须自包含（toString 注入）。 */
export function installExportFade(doc: Document): void {
    const win = doc.defaultView;
    if (!win) return;
    const root = doc.documentElement;
    let timer = 0;
    const fade = () => {
        root.classList.add('vlook-fading');
        win.clearTimeout(timer);
        timer = win.setTimeout(() => root.classList.remove('vlook-fading'), 650);
    };
    try { win.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', fade); } catch { /* 旧浏览器 */ }
    doc.addEventListener('click', event => {
        const target = event.target as Element | null;
        if (target?.closest?.('.v-status-bar,.v-toolbar,.vlook-export-theme')) fade();
    }, true);
}
