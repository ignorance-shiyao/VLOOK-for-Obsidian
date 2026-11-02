// 跨块特性（基于 SourceIndex）：标题编号、封面/封底、迷你封面、页签组、分栏、不发布章节
// 在阅读视图中，每个块是 .markdown-preview-sizer 下的一个 div（section）

import { headingPlain } from "./toc";
import { h, svgIcon } from "../core/dom";
import type { RenderCtx } from "../core/context";
import type { Block } from "../core/source-index";
import { t } from "../core/i18n";
import { ALERT_TYPES } from "./alert";

export function processHeadings(section: HTMLElement, ctx: RenderCtx): void {
    const b = ctx.block;
    if (!b || b.type !== "heading") return;
    const hx = section.querySelector<HTMLElement>("h1,h2,h3,h4,h5,h6");
    if (!hx) return;
    if (ctx.settings.headerAutoNum && b.headerNum !== undefined) {
        hx.setAttribute("data-header-num", b.headerNum);
        if (b.headerNumNormal) hx.setAttribute("data-header-num-normal", b.headerNumNormal);
    }
    if (ctx.settings.cover && b.cover === "front" && hx.tagName === "H6") {
        hx.classList.add("vlook-cover");
        section.classList.add("vlook-cover-section");
        markRoot(section, "vlook-has-cover");
    }
    if (ctx.settings.cover && b.cover === "back" && hx.tagName === "H1") {
        hx.classList.add("vlook-back-cover");
        section.classList.add("vlook-back-cover-section");
    }
    if (hx.querySelector(":scope > mark:only-child")) hx.classList.add("v-hl-header");
}

/** 根容器在块插入文档后才可用 */
function markRoot(section: HTMLElement, cls: string) {
    const apply = () => section.closest(".markdown-rendered")?.classList.add(cls);
    section.isConnected ? apply() : requestAnimationFrame(apply);
}

/** 小封面：无大封面时根据 YAML（title/author/date/version/copyright/rights/tags）生成 */
export function processMiniCover(section: HTMLElement, ctx: RenderCtx): void {
    const idx = ctx.index, b = ctx.block;
    if (!idx || !b || b.type !== "frontmatter" || !ctx.settings.cover) return;
    if (idx.blocks.some(x => x.cover === "front")) return;
    const fm = idx.frontmatter;
    const fields = ["author", "date", "version", "copyright", "rights", "tags"];
    if (!fm.title && !fields.some(f => fm[f])) return;
    // 原版按页面模式加 max/mini，主题渐变背景与图标依赖 max
    const cover = h("div", "v-doc-mini-cover max", { id: "vk-id-doc-mini-cover" });
    const title = fm.title || ctx.sourcePath.split("/").pop()!.replace(/\.md$/, "");
    cover.append(Object.assign(h("div", "doc-title"), { textContent: title }));
    if (fm.tags) {
        const tags = h("div", "doc-tags");
        fm.tags.replace(/^\[|\]$/g, "").split(/,\s?/).filter(Boolean).forEach(tag => {
            tags.append(h("code", "v-tag t2-a", {value: tag.trim()}, escapeHtml(tag.trim())), "\u00a0");
        });
        cover.append(tags);
    }
    if (fm.author) cover.append(Object.assign(h("div", "doc-author"), { textContent: fm.author }));
    if (fm.date || fm.version) cover.append(Object.assign(h("div", "doc-date"), { textContent: [fm.date, fm.version ? `(${fm.version})` : ""].filter(Boolean).join(" ") }));
    if (fm.copyright) cover.append(Object.assign(h("div", "doc-copyright"), { textContent: fm.copyright }));
    if (fm.rights) cover.append(Object.assign(h("div", "doc-rights"), { textContent: fm.rights }));
    section.append(cover);
    section.classList.add("vlook-mini-cover-section");
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

// ---------------- 页签组 ----------------

const TAB_ICON: Record<string, string> = {
    table: "icoIndexTab-table", figure: "icoIndexTab-figure", codeblock: "icoIndexTab-codeblock",
    formula: "icoIndexTab-formula", media: "icoIndexTab-media", blockquote: "icoIndexTab-blockquote",
};

const TAB_CAPTION_LABEL: Record<string, "table" | "figure" | "codeblock" | "formula" | "video"> = { table: "table", figure: "figure", codeblock: "codeblock", formula: "formula", media: "video" };
function tabCaptionLabel(type: string): string { return t(TAB_CAPTION_LABEL[type] ?? "figure"); }

export function tabInfo(b: Block): { type: string; title: string; icon?: string } {
    if (b.type === "callout") {
        const m = b.text.match(/^[ \t]*>[ \t]*\[!([\w-]+)\][+-]?[ \t]*(.*)$/m);
        const type = (m?.[1] ?? "").toLowerCase();
        const def = ALERT_TYPES[type];
        return { type: "alert", title: m?.[2]?.trim() || (def ? t(def.key) : m?.[1] ?? ""), icon: def?.icon };
    }
    if (b.type === "blockquote") {
        const first = b.text.split("\n")[0].replace(/^\s*>\s*/, "").replace(/^(\*\*|==)|(\*\*|==)$/g, "");
        return { type: "blockquote", title: headingPlain(first.replace(/<br\s*\/?>/gi, " ")).replace(/\s+/g, " ") };
    }
    const kind = b.caption?.kind ?? "figure";
    let title = b.caption?.cap1 ?? "";
    // 插图：题注来自图片的 alt
    if (!title && kind === "figure") title = b.text.match(/!\[([^\]]+)\]\(/)?.[1]?.trim() ?? "";
    if (!title) {
        if (kind === "codeblock") title = b.lang || t("codeblock");
        else title = kind === "media" ? t("video") : t(kind as "table" | "figure" | "formula");
    }
    return { type: kind, title };
}

function tabMembers(section: HTMLElement, id: number): HTMLElement[] {
    const parent = section.parentElement;
    if (!parent) return [];
    return Array.from(parent.querySelectorAll<HTMLElement>(`:scope > [data-vlook-tab-group="${id}"]`))
        .sort((a, b) => Number(a.dataset.vlookTabIndex) - Number(b.dataset.vlookTabIndex));
}

/** 当前选中的页签按源码索引记录：阅读视图虚拟化卸载页签栏后，重新挂载的成员仍按选择显隐。 */
const tabSelections = new WeakMap<object, Map<number, number>>();
const tabIndexes = new WeakMap<HTMLElement, object>();

function selectTab(section: HTMLElement, id: number, index: number) {
    const key = tabIndexes.get(section);
    if (key) { let map = tabSelections.get(key); if (!map) tabSelections.set(key, map = new Map()); map.set(id, index); }
    const parent = section.parentElement;
    if (!parent) return;
    parent.querySelectorAll<HTMLElement>(`:scope > [data-vlook-tab-group="${id}"]`).forEach(m => {
        m.classList.toggle("vlook-tab-hidden", Number(m.dataset.vlookTabIndex) !== index);
    });
    section.querySelectorAll<HTMLElement>(".tab-group-wrap > span").forEach((s, i) => s.classList.toggle("current", i + 1 === index));
    section.dataset.vlookTabCurrent = String(index);
}

export function processTabGroups(section: HTMLElement, ctx: RenderCtx): void {
    const idx = ctx.index, b = ctx.block;
    if (!idx || !b || !ctx.settings.tabGroups) return;
    // 页签组的成员：默认只显示第 1 个
    if (b.tabGroup) {
        section.dataset.vlookTabGroup = String(b.tabGroup.id);
        section.dataset.vlookTabIndex = String(b.tabGroup.index);
        section.classList.add("vlook-tab-member", "tab-content-target");
        // 若页签栏已选中其他页签，则按当前选中项决定显隐
        const bar = section.parentElement?.querySelector<HTMLElement>(`:scope > [data-vlook-tab-marker="${b.tabGroup.id}"]`);
        // 单独渲染（如全屏内容助手）时没有页签栏，成员本身必须可见
        const current = bar ? Number(bar.dataset.vlookTabCurrent || 1) : ctx.suppressContentViewers ? b.tabGroup.index : tabSelections.get(idx)?.get(b.tabGroup.id) ?? 1;
        section.classList.toggle("vlook-tab-hidden", b.tabGroup.index !== current);
        return;
    }
    if (!b.tabMarker) return;
    const { id } = b.tabMarker;
    section.dataset.vlookTabMarker = String(id);
    section.classList.add("vlook-tab-bar-section");
    tabIndexes.set(section, idx);
    const remembered = tabSelections.get(idx)?.get(id);
    if (remembered) section.dataset.vlookTabCurrent = String(remembered);
    const members = idx.blocks.filter(x => x.tabGroup?.id === id && x.captionFor === undefined);
    const tabIconOption = ["off", "line", "solid", "flat"].includes(ctx.query.get("tabico") ?? "") ? ctx.query.get("tabico")! : "line";
    const tabCaption = ctx.query.get("tabcap") === "on", captionOn = ctx.query.get("capnum") !== "off";
    const box = h("div", "v-tab-box", { id: `tab-box${id}` });
    const group = h("div", "v-tab-group v-backdrop-blurs", { id: `tab-group${id}`, title: `[Tab] / [⇧ Shift + Tab] ${t("switchTabs")}` });
    const wrapEl = h("div", "tab-group-wrap");
    group.append(wrapEl);
    box.append(group);
    members.forEach((m, i) => {
        const info = tabInfo(m);
        const icon = tabIconOption === "off" ? "" : info.icon ? svgIcon(info.icon, 20, 16, "current-color") : TAB_ICON[info.type] ? svgIcon(`${TAB_ICON[info.type]}${tabIconOption}`, 20, 16, "current-color") : "";
        const tab = h("span", i + 1 === (remembered ?? 1) ? "current" : "", { tabindex: "1", "data-content-type": info.type }, icon);
        tab.append(tabCaption && m.caption?.num && captionOn ? `${tabCaptionLabel(info.type)} ${m.caption.num} ${info.title}` : info.title);
        tab.addEventListener("click", () => selectTab(section, id, i + 1));
        tab.addEventListener("keydown", ev => {
            if (ev.key !== "Tab") return;
            ev.preventDefault();
            const next = ev.shiftKey ? (i - 1 + members.length) % members.length : (i + 1) % members.length;
            selectTab(section, id, next + 1);
            (wrapEl.children[next] as HTMLElement).focus();
        });
        wrapEl.append(tab);
    });
    // 隐藏原 _^tab^_ 段落内容，显示页签栏
    section.replaceChildren(box);
    requestAnimationFrame(() => tabMembers(section, id).length && selectTab(section, id, Number(section.dataset.vlookTabCurrent || 1)));
}

// ---------------- 分栏 ----------------

export function processColumns(section: HTMLElement, ctx: RenderCtx): void {
    const b = ctx.block;
    if (!b || !ctx.settings.columns) return;
    if (b.columnMarker) {
        section.classList.add("vlook-col-marker");
        const hr = section.querySelector("hr");
        hr?.classList.add("v-column");
        return;
    }
    if (!b.columns) return;
    const { group, count, index, kind } = b.columns;
    section.classList.add("vlook-col", `vlook-col-${kind}`);
    section.style.setProperty("--vlook-col-count", String(count));
    section.dataset.vlookColGroup = String(group);
    section.dataset.vlookColIndex = String(index);
    if (kind === "quote") {
        section.querySelector(":scope > :is(blockquote, details, .callout, .md-alert)")?.classList.add("column");
        if (index % count === 0) section.classList.add("vlook-col-last");
        // 阅读视图按需渲染：新挂载的栏先套用此前量到的同组最大高度，避免滚动回来时高度参差
        const known = ctx.index ? columnHeights.get(ctx.index)?.get(group) : undefined;
        const inner = section.querySelector<HTMLElement>(":scope > :is(blockquote, .callout, .md-alert)");
        if (known && inner) inner.style.minHeight = `${known}px`;
        if (ctx.index) columnOwners.set(section, ctx.index);
        scheduleEqualize(section, group);
    } else {
        section.querySelector(":scope > :is(ul, ol)")?.classList.add("vlook-col-list-inner");
    }
}

/** 定时器按分栏所在容器隔离，分屏或多个视图同时渲染时互不取消 */
const pending = new WeakMap<HTMLElement, Map<number, number>>();
const columnHeights = new WeakMap<object, Map<number, number>>();
const columnOwners = new WeakMap<HTMLElement, object>();
const watched = new WeakSet<HTMLElement>();

/**
 * 同一组分栏统一高度（与原版 ExtQuote_uniteColumnsHeight 一致）
 * 用 min-height 而非 height：内容后续变高（字体加载、图片）时不会溢出；栏宽变化时重新计算
 */
function scheduleEqualize(section: HTMLElement, group: number) {
    const scope = section.parentElement ?? section;
    let timers = pending.get(scope); if (!timers) pending.set(scope, timers = new Map());
    window.clearTimeout(timers.get(group));
    timers.set(group, window.setTimeout(() => {
        const parent = section.parentElement;
        if (!parent) return;
        const items = Array.from(parent.querySelectorAll<HTMLElement>(`:scope > [data-vlook-col-group="${group}"] > :is(blockquote, details, .callout, .md-alert)`));
        items.forEach(i => i.style.minHeight = "");
        if (getComputedStyle(section).display === "block") return;
        const max = Math.max(...items.filter(i => !i.closest("[data-folding]") && i.tagName !== "DETAILS").map(i => i.offsetHeight));
        if (max > 0) {
            const owner = columnOwners.get(section);
            let target = max;
            if (owner) {
                let heights = columnHeights.get(owner); if (!heights) columnHeights.set(owner, heights = new Map());
                const count = Number(section.style.getPropertyValue("--vlook-col-count")) || 0;
                // 整组都已渲染时以实测为准（窗口变宽后可回落）；仅部分渲染时保留此前量到的最大值
                target = items.length < count ? Math.max(max, heights.get(group) ?? 0) : max; heights.set(group, target);
            }
            items.forEach(i => { if (i.tagName !== "DETAILS") i.style.minHeight = `${target}px`; });
        }
    }, 150));
    if (!watched.has(section) && typeof ResizeObserver !== "undefined") {
        watched.add(section);
        let width = 0;
        new ResizeObserver(([entry]) => {
            const w = Math.round(entry.contentRect.width);
            if (w !== width) { width = w; scheduleEqualize(section, group); }
        }).observe(section);
    }
}

export function processUnpublished(section: HTMLElement, ctx: RenderCtx): void {
    section.classList.toggle("vlook-unpub", !!ctx.block?.unpub && ctx.query.get("unpub") !== "off");
}
