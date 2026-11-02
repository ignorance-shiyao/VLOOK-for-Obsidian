import { prepareImageCaptions } from './preview/image-captions';
// 阅读视图渲染流水线：每个块（section）依次经过各 VLOOK 特性处理
// 顺序参照 vlook.js V_initKernel()

import type { RenderCtx } from "./core/context";
import { normalizeSubSup } from "./core/normalize";
import { processQuotes } from "./features/quote";
import { processContentViewers } from "./features/content-viewer";
import type { TableSizes } from "./core/context";
import { reorderTable } from "./core/table-move";
import { processTableTools } from "./features/table-tools";
import { processTables } from "./features/table";
import { processImages } from "./features/image";
import { buildMediaCaption, buildTextCaption, hideCaptionSource } from "./features/caption";
import { processCodeMagic } from "./features/code-magic";
import { processSupSubMagic } from "./features/sup-sub-magic";
import { processBreadcrumb, processProgress } from "./features/inline-extras";
import { processColumns, processHeadings, processMiniCover, processTabGroups, processUnpublished } from "./features/structure";
import { processAlerts } from "./features/alert";
import { processMathFit } from "./features/math-fit";
import { repairNestedMath } from "./features/math-nested";
import { wrapTextSpans } from "./core/dom";
import { processLinks } from "./features/link";
import { processExternalReferences } from './features/external-reference';
import {processMermaid} from './features/mermaid';
import { processCodeBlocks } from "./features/code-block";
import { processToc } from "./features/toc";

import { processPageBreaks } from "./features/page-break";
import { restoreSpacedLinks } from "./core/spaced-links";
import { processResourceStatus } from './features/resource-status';

export function renderSection(el: HTMLElement, ctx: RenderCtx): void {
    const b = ctx.block;
    el.classList.add("vlook");
    el.dataset.vlookSourcePath = ctx.sourcePath;
    if(b){el.dataset.vlookSourceLine=String(b.start);el.dataset.vlookSourceEnd=String(b.end);}

    // 题注语法段落：内容由被题注的块显示
    if (b && b.captionFor !== undefined && ctx.settings.captions) {
        hideCaptionSource(el);
        if (b.tabGroup) {
            el.dataset.vlookTabGroup = String(b.tabGroup.id);
            el.dataset.vlookTabIndex = String(b.tabGroup.index);
        }
        return;
    }

    normalizeSubSup(el, ctx.settings.genericSubSup);
    restoreSpacedLinks(el, (a, href) => {
        if (/^[a-z][\w+.-]*:/i.test(href)) { a.className = "external-link"; a.target = "_blank"; a.rel = "noopener nofollow"; }
        else { a.className = "internal-link"; a.dataset.href = href; }
    });
    processMermaid(el);
    if (ctx.settings.captions) prepareImageCaptions(el);
    processToc(el, ctx);
    processPageBreaks(el, ctx);
    processQuotes(el, ctx);
    processAlerts(el);
    processTables(el, ctx);
    processImages(el, ctx);

    // 表格、代码块、公式、Mermaid 的题注
    if (ctx.settings.captions && b?.caption) {
        const table = el.querySelector<HTMLElement>(":scope table");
        if (b.type === "table" && table) buildTextCaption(table, "table", ctx);
        const pre = el.querySelector<HTMLElement>(":scope > pre");
        if (b.type === "code" && pre) buildTextCaption(pre, "codeblock", ctx);
        const math = el.querySelector<HTMLElement>(".math-block, mjx-container[display]");
        if (b.type === "math" && math) buildTextCaption(math, "formula", ctx);
        const mermaid = el.querySelector<HTMLElement>(".mermaid");
        if (b.type === "mermaid" && mermaid) buildMediaCaption(mermaid, "figure", ctx, "svg");
    }

    processTableTools(el, ctx.query.get("tr") === "on", tableReorder(ctx), tableSizeStore(ctx, el));
    processCodeBlocks(el, ctx);
    processCodeMagic(el, ctx);
    processSupSubMagic(el, ctx);
    processProgress(el, ctx);
    processBreadcrumb(el);

    processHeadings(el, ctx);
    processMiniCover(el, ctx);
    processTabGroups(el, ctx);
    processColumns(el, ctx);
    processUnpublished(el, ctx);
    processLinks(el, ctx);
    void processExternalReferences(el,ctx);
    processResourceStatus(el, ctx);
    repairNestedMath(el);
    processMathFit(el, ctx);

    // 与 Typora 一致地用 span 包裹文本：主题中 :only-child、:has(*) 等选择器依赖此结构
    wrapTextSpans(el);
    if (!ctx.suppressContentViewers) processContentViewers(el, ctx);
}

/** 阅读视图拖动手柄后把新的行列顺序写回源码；区块已变更时放弃，避免覆盖。 */
function tableReorder(ctx: RenderCtx) {
    const b = ctx.block, app = ctx.app, text = ctx.index?.text;
    if (!b || b.type !== "table" || !app || text === undefined) return undefined;
    return (_table: HTMLTableElement, kind: "row" | "col", from: number, to: number) => {
        const file = app.vault.getFileByPath(ctx.sourcePath);
        if (!file) return;
        void app.vault.process(file, current => {
            const lines = current.split("\n");
            if (lines.slice(b.start, b.end + 1).join("\n") !== text.split("\n").slice(b.start, b.end + 1).join("\n")) return current;
            for (let i = b.start; i <= b.end; i++) {
                const result = reorderTable(lines, i, kind, from, to);
                if (!result) continue;
                lines.splice(result.from, result.to - result.from + 1, ...result.lines);
                return lines.join("\n");
            }
            return current;
        });
    };
}

/** 同一文档内第几张表格作为键；列宽行高在重新渲染后据此恢复。 */
function tableSizeStore(ctx: RenderCtx, el: HTMLElement): TableSizes | undefined {
    const b = ctx.block, store = ctx.tableSizes;
    if (!b || b.type !== "table" || !store || !ctx.index || el.querySelectorAll(":scope table").length !== 1) return undefined;
    const ordinal = ctx.index.blocks.filter(x => x.type === "table").indexOf(b);
    const key = `${ctx.sourcePath}::${ordinal}`;
    let sizes = store.get(key);
    if (!sizes) store.set(key, sizes = { cols: [], rows: [] });
    return sizes;
}
