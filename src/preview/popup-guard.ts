/** 移动端：弹出层（导航中心、画中画、字体风格、链接列表等）不被工具栏或屏幕边缘遮挡。须自包含（toString 注入）。 */
export function installPopupGuard(): void {
    if (!matchMedia("(pointer:coarse)").matches) return;
    const POPUPS = ".v-nav-center,.v-pic-in-pic,.v-font-style,.v-link-info-list,.v-footnote-pn,.v-print-tip,.v-doc-lib,.v-content-helper,.v-info-tips";
    const GAP = 8;
    const shown = (el: Element): boolean => {
        const box = el.getBoundingClientRect(), style = getComputedStyle(el);
        return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden" && box.right > 0 && box.left < innerWidth;
    };
    const fit = (el: HTMLElement): void => {
        if (!shown(el) || getComputedStyle(el).position !== "fixed") return;
        const toolbar = document.querySelector<HTMLElement>(".v-toolbar");
        const bar = toolbar && shown(toolbar) ? toolbar.getBoundingClientRect() : null;
        let box = el.getBoundingClientRect();
        // 与工具栏重叠时，整体下移到工具栏下方
        if (bar && !el.matches(".v-toolbar") && box.top < bar.bottom + GAP && box.bottom > bar.top && box.left < bar.right && box.right > bar.left) {
            const top = Math.round(bar.bottom + GAP);
            if (el.dataset.vPopupTop !== String(top)) { el.dataset.vPopupTop = String(top); el.style.setProperty("top", `${top}px`, "important"); }
            box = el.getBoundingClientRect();
        }
        // 超出屏幕底部时压低高度，内容在弹出层内滚动
        const limit = innerHeight - GAP;
        if (box.bottom > limit) {
            const height = Math.max(120, Math.round(limit - box.top));
            if (el.dataset.vPopupMax !== String(height)) {
                el.dataset.vPopupMax = String(height);
                el.style.setProperty("max-height", `${height}px`, "important");
                el.style.setProperty("overflow-y", "auto", "important");
                el.style.setProperty("bottom", "auto", "important");
            }
        }
    };
    // 工具栏可收起；导航中心弹出时自动隐藏
    const root = document.documentElement;
    const css = new CSSStyleSheet();
    css.replaceSync("html.v-tb-folded .v-toolbar,html.v-tb-auto .v-toolbar,html.v-tb-auto .v-tb-fold{display:none!important}"
        + ".v-tb-fold{position:fixed;z-index:2147483000;left:50%;transform:translateX(-50%);width:44px;height:18px;border:0;border-radius:0 0 10px 10px;background:var(--ac-t1,#2a55cc);color:#fff;padding:0;display:flex;align-items:center;justify-content:center;opacity:.85}"
        + ".v-tb-fold svg{width:14px;height:14px;transition:transform .2s}html.v-tb-folded .v-tb-fold svg{transform:rotate(180deg)}");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, css];
    const fold = document.createElement("button");
    fold.className = "v-tb-fold";
    const ns = "http://www.w3.org/2000/svg", icon = document.createElementNS(ns, "svg"), arrow = document.createElementNS(ns, "path");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "3", "stroke-linecap": "round", "stroke-linejoin": "round" })) icon.setAttribute(k, v);
    arrow.setAttribute("d", "M6 15l6-6 6 6");
    icon.append(arrow);
    fold.append(icon);
    fold.addEventListener("click", (e) => { e.stopPropagation(); root.classList.toggle("v-tb-folded"); window.setTimeout(run, 50); });
    document.body.appendChild(fold);
    const sync = (): void => {
        const nav = document.querySelector<HTMLElement>(".v-nav-center");
        root.classList.toggle("v-tb-auto", !!nav && shown(nav));
        const toolbar = document.querySelector<HTMLElement>(".v-toolbar");
        const bar = toolbar && shown(toolbar) ? toolbar.getBoundingClientRect() : null;
        fold.style.top = `${bar ? Math.round(bar.bottom) : 0}px`;
        if (!bar && nav?.dataset.vPopupTop) { delete nav.dataset.vPopupTop; nav.style.removeProperty("top"); }
    };
    let timer = 0;
    const run = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { sync(); document.querySelectorAll<HTMLElement>(POPUPS).forEach(fit); }, 120); };
    new MutationObserver(run).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"], subtree: true });
    addEventListener("resize", run);
    document.addEventListener("click", (e) => {
        // 点击目录条目：跳转后收起导航中心
        const target = e.target as Element | null;
        if (target?.closest?.(".v-nav-center .md-toc-item") && !target.closest(".v-toc-folder")) window.setTimeout(() => {
            const nav = document.querySelector<HTMLElement>(".v-nav-center");
            if (nav && shown(nav)) document.querySelector<HTMLElement>(".v-toolbar .nav-center")?.click();
        }, 300);
        window.setTimeout(run, 250);
    }, true);
    run();
}
