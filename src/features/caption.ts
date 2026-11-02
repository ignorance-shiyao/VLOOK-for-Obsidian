// 题注与自动编号：*==题注==* / *==题注_第二题注_==* 独占一行置于内容前；
// 图片使用 ![题注](url "第二题注")。编号基于整篇源码计算（见 SourceIndex）。
// 移植自 vlook.js「题注生成器类」

import { h, wrap } from "../core/dom";
import type { RenderCtx } from "../core/context";
import type { CaptionInfo } from "../core/source-index";
import { t } from "../core/i18n";

const LABEL: Record<CaptionInfo["kind"], () => string> = {
    table: () => t("table"),
    codeblock: () => t("codeblock"),
    formula: () => t("formula"),
    figure: () => t("figure"),
    media: () => t("video"),
};

let anchorSeq = 0;

function prefixSpan(ctx: RenderCtx, kind: CaptionInfo["kind"], num: string, withSplitter: boolean, label = LABEL[kind]()): HTMLElement {
    const span = h("span", "", {
        "data-up-symbol": ctx.cssVar("--v-cap-up-symbol"),
        "data-down-symbol": ctx.cssVar("--v-cap-down-symbol"),
    });
    const off = ctx.query.get("capnum") === "off";
    span.textContent = (off || !num ? label : `${label} ${num}`) + (withSplitter ? " " : "");
    return span;
}

function makeCap1(ctx: RenderCtx, kind: CaptionInfo["kind"], num: string, fc: string, label?: string): HTMLElement {
    const mini = ctx.query.get("capmini") === "on";
    const blank = ctx.query.get("capblank") === "on";
    const cap = h("figcaption", "v-cap-1");
    if (!fc && !blank) {
        cap.classList.add("none");
        return cap;
    }
    cap.append(prefixSpan(ctx, kind, num, true, label));
    if (!mini && fc) cap.append(fc);
    return cap;
}

function anchorId(text: string): string {
    return text.trim().replace(/\s+/g, "-");
}

/** 表格、代码块、公式的题注 */
export function buildTextCaption(target: HTMLElement, kind: "table" | "codeblock" | "formula", ctx: RenderCtx): void {
    const info = ctx.block?.caption;
    if (!info || target.closest(".v-caption")) return;
    const fc = info.cap1 ?? "", fc2 = info.cap2;
    // 容器
    const figure = h("figure", "v-cap-cntr", { "data-cntr": kind });
    wrap(target, figure);
    if (fc) {
        figure.id = anchorId(fc);
        figure.dataset.capForId = fc;
    }
    const idPrefix = kind === "table" ? "vk-id-tbl" : kind === "codeblock" ? "vk-id-codeblock" : "vk-id-math";
    const box = h("div", `v-caption ${kind === "formula" ? "formula" : kind}`, { id: `${idPrefix}${info.counter}-${++anchorSeq}` });
    wrap(target, box);
    const cap1 = makeCap1(ctx, kind, info.num, fc);
    if (fc2) {
        target.before(cap1);
        cap1.classList.add("up");
        target.after(Object.assign(h("figcaption", "v-cap-2"), { textContent: fc2 }));
        target.dataset.capCount = "2";
    } else if (kind === "formula") {
        target.after(cap1);
        cap1.classList.add("down");
    } else {
        target.before(cap1);
        cap1.classList.add("up");
    }
    box.dataset.title = cap1.textContent || "";
}

/** 图片、Mermaid、音视频的题注 */
export function buildMediaCaption(target: HTMLElement, kind: "figure" | "media", ctx: RenderCtx, figType = "img"): void {
    if (target.closest(".v-caption")) return;
    const info = ctx.block?.caption;
    let fc = (target.getAttribute("alt") || "").trim();
    let fc2 = target.getAttribute("title") || undefined;
    if (!fc && info?.cap1) { fc = info.cap1; fc2 = info.cap2 ?? fc2; }
    const num = info?.num ?? "";
    const figure = h("figure", "v-cap-cntr", { "data-cntr": figType });
    wrap(target, figure);
    if (fc) {
        figure.id = anchorId(fc);
        figure.dataset.capForId = fc;
    }
    const box = h("div", `v-caption ${figType === "svg" ? "mermaid" : kind === "figure" ? "figure" : ""}`.trim(), {
        id: `vk-id-fig${info?.counter ?? 0}-${++anchorSeq}`, "data-fig-type": figType,
    });
    wrap(target, box);
    target.classList.add("v-fig");
    if (info) target.dataset.num = String(info.counter);
    const cap1 = makeCap1(ctx, kind === "media" ? "media" : "figure", num, fc, figType === "audio" ? t("audio") : undefined);
    if (fc && fc2) {
        target.before(cap1);
        cap1.classList.add("up");
        target.after(Object.assign(h("figcaption", "v-cap-2"), { textContent: fc2 }));
        target.dataset.capCount = "2";
        target.removeAttribute("title");
    } else if (kind === "figure") {
        target.after(cap1);
        cap1.classList.add("down");
    } else {
        target.before(cap1);
        cap1.classList.add("up");
    }
}

/** 段落本身是题注语法时：在阅读视图中隐藏（题注会显示在内容上） */
export function hideCaptionSource(section: HTMLElement): void {
    section.classList.add("vlook-caption-source");
}
