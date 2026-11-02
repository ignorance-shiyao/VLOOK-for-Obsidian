// 引用块增强：折叠（> ###### 标题）、小标题（首段加粗 / 高亮）、引用块着色（独占一行的 _~色号~_）
// 移植自 vlook.js「引用块增强类」「引用块着色模块」

import { parseColor } from "../core/color";
import { h, svgIcon, setHtml } from "../core/dom";
import type { RenderCtx } from "../core/context";
import { isUnpublishedQuote } from "../core/unpublished";

let detailsCount = 0;
const SUBTITLE = ":scope > :is(p:first-child, p:first-child + p) > :is(strong, mark):only-child";

function transHash(text: string): string {
    return text.trim().replace(/\s+/g, "-").toLowerCase();
}

function buildFold(quote: HTMLElement, h6: HTMLElement): HTMLElement {
    const details = h("details", "", { id: `vlook-details-${++detailsCount}` });
    const summary = h("summary");
    if (h6.id) summary.id = h6.id;
    setHtml(summary, svgIcon("icoDetailsOpen", 18, 18, "text", "v-svg-details"));
    // 去掉 Obsidian 标题上的折叠指示器
    h6.querySelectorAll(".heading-collapse-indicator, .collapse-indicator").forEach(e => e.remove());
    summary.append(...Array.from(h6.childNodes));
    h6.remove();
    details.append(summary, ...Array.from(quote.childNodes));
    for (const a of Array.from(quote.attributes)) if (a.name !== "class") details.setAttribute(a.name, a.value);
    details.className = quote.className;
    quote.replaceWith(details);
    const icon = summary.querySelector(".v-svg-details");
    details.addEventListener("toggle", () => icon?.classList.toggle("v-rotate45", details.open));
    details.dataset.folding = "true";
    return details;
}

function applyColoring(quote: HTMLElement, colorEm: HTMLElement | null, color: string, em: boolean): void {
    colorEm?.parentElement?.remove();
    const emCls = em ? " em" : "";
    quote.classList.add("v-q", ...(`${color}${emCls}`).split(" "));
    quote.querySelectorAll(":scope > summary").forEach(s => s.classList.add(`title-${color}`, ...(em ? ["em"] : [])));
    quote.querySelectorAll<HTMLElement>(SUBTITLE).forEach(st => {
        st.classList.add(`title-${color}`, ...(em ? ["em"] : []));
        st.parentElement?.previousElementSibling?.classList.add(`title-${color}`, ...(em ? ["em"] : []));
    });
}

export function processQuotes(root: HTMLElement, ctx: RenderCtx): void {
    const quotes = Array.from(root.querySelectorAll<HTMLElement>("blockquote"));
    for (let quote of quotes) {
        if (!root.contains(quote)) continue;
        quote.classList.toggle("vlook-unpub", ctx.query.get("unpub") !== "off" && isUnpublishedQuote(quote, ctx.index?.frontmatter["vlook-unpub"]));
        // 1) 折叠
        const first = quote.firstElementChild as HTMLElement | null;
        if (first?.tagName === "H6") {
            quote = buildFold(quote, first);
            if (quote.parentElement?.tagName === "BLOCKQUOTE") quote.parentElement.dataset.folding = "true";
        }
        // 2) 小标题
        quote.querySelectorAll<HTMLElement>(SUBTITLE).forEach(st => {
            st.id = st.id || transHash(st.textContent || "");
            st.parentElement?.parentElement?.classList.add("stt");
        });
    }

    // 3) 着色：:is(blockquote,details) > p > em > sub:only-child 且独占一行
    let colored = new Set<HTMLElement>();
    root.querySelectorAll<HTMLElement>(":is(blockquote, details) > p > em > sub:only-child").forEach(sub => {
        const em = sub.parentElement!, p = em.parentElement!, quote = p.parentElement as HTMLElement;
        if ((p.textContent || "").trim() !== (sub.textContent || "").trim()) return;
        const set = parseColor(sub.textContent || "");
        if (!set) return;
        applyColoring(quote, em, set.color, set.em);
        colored.add(quote);
    });

    // 4) 默认着色（调校参数 quote / 插件设置）
    const def = ctx.query.get("quote") ?? (ctx.settings.quoteDefault || null);
    if (def && def !== "off") {
        const set = parseColor(def);
        if (set)
            root.querySelectorAll<HTMLElement>(":is(blockquote, details)").forEach(q => {
                if (colored.has(q) || q.classList.contains("v-q")) return;
                const parent = q.parentElement?.tagName;
                if (parent === "LI" || parent === "BLOCKQUOTE" || parent === "DETAILS") return;
                applyColoring(q, null, set.color, set.em);
            });
    }
}
