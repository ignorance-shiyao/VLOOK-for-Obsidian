// [TOC] 目录：Obsidian 原生不支持
// 阅读视图：根据源码中的标题生成可点击的目录；预览 / 导出：生成与 Typora 一致的 .md-toc 结构，交给官方运行时

import { Query, type RenderCtx } from "../core/context";
import { getSourceIndex, type SourceIndex } from "../core/source-index";
import { headingPlain } from "../core/heading";
import { navigateViewLine, navigationSourceView, recordLineNavigation } from "../navigation-history";
import { notify } from "../notify";
import { newEl } from '../core/dom';
export { headingPlain } from "../core/heading";

const TOC_RE = /^\s*\[toc\]\s*$/i;


interface TocItem { level: number; text: string; line?: number; occurrence?: number }

function sourceItems(index: SourceIndex, query: Query): TocItem[] {
    const seen = new Map<string,number>();
    return index.blocks.filter(b => b.type === "heading" && !b.cover && (!b.unpub || query.get("unpub") === "off"))
        .map(b => {
            const text=headingPlain(b.text), occurrence=seen.get(text)||0;
            seen.set(text,occurrence+1);
            return {level:b.level!,text,line:b.start,occurrence};
        }).filter(item=>item.text);
}

function tocDom(doc: Document, items: TocItem[], href: (i: TocItem) => string, onClick?: (i: TocItem, ev: MouseEvent) => void): HTMLElement {
    const box = newEl(doc, "div");
    box.className = "md-toc";
    box.setAttribute("mdtype", "toc");
    const content = newEl(doc, "p");
    content.className = "md-toc-content";
    content.setAttribute("role", "list");
    items.forEach((it, n) => {
        const span = newEl(doc, "span");
        span.setAttribute("role", "listitem");
        span.className = `md-toc-item md-toc-h${it.level}`;
        span.dataset.ref = `n${n}`;
        const a = newEl(doc, "a");
        a.className = "md-toc-inner";
        if(it.line!==undefined)a.dataset.vlookTargetLine=String(it.line);
        a.setAttribute("href", href(it));
        a.textContent = it.text;
        if (onClick) a.addEventListener("click", ev => { ev.preventDefault(); onClick(it, ev); });
        span.append(a);
        content.append(span);
    });
    box.append(content);
    return box;
}

/** 阅读视图：[TOC] 段落替换为目录 */
export function processToc(section: HTMLElement, ctx: RenderCtx): void {
    const p = section.querySelector<HTMLElement>(":scope > p");
    if (!p || !TOC_RE.test(p.textContent || "") || !ctx.index) return;
    const items = sourceItems(ctx.index,ctx.query);
    const app = ctx.app;
    const toc = tocDom(section.ownerDocument, items, i => `#${encodeURIComponent(i.text)}`, (i, ev) => {
        let line=i.line;
        const view=ctx.app?navigationSourceView(ctx.app,ctx.sourcePath,section):null;
        if(view?.file?.path===ctx.sourcePath){
            const index=getSourceIndex(view.editor.getValue(),{captionGroup:false,captionNumber:false});
            const query=new Query(ctx.cssVar?.("--vlook-query") || "",index.frontmatter["vlook-query"]);
            const item=sourceItems(index,query).find(item=>item.text===i.text && item.occurrence===i.occurrence);
            if(!item){notify("章节已变更，请刷新目录");return;}
            line=item.line;
        }
        if(view?.contentEl?.contains(section) && !ev.metaKey && !ev.ctrlKey && line!==undefined){navigateViewLine(view,line);return;}
        if (ctx.app && line !== undefined) recordLineNavigation(ctx.app, ctx.sourcePath, line,view);
        // 按全文索引定位，重复标题与标题中的 # 不再依赖字符串锚点解析。
        void app?.workspace?.openLinkText(ctx.sourcePath, "", ev.metaKey || ev.ctrlKey, {eState:{line}});
    });
    p.replaceWith(toc);
}

/** Typora DOM：[TOC] 段落替换为目录（标题 id 已由转换流程设置） */
export function buildTyporaToc(root: HTMLElement): void {
    const p = Array.from(root.querySelectorAll<HTMLElement>(":scope > p")).find(e => TOC_RE.test(e.textContent || ""));
    if (!p && root.querySelector(":scope > .md-toc")) return;
    const heads = Array.from(root.querySelectorAll<HTMLElement>(":scope > :is(h1,h2,h3,h4,h5,h6)"));
    if (!heads.length) return;
    const items = heads.map(h => ({ level: Number(h.tagName[1]), text: (h.textContent || "").trim(), id: h.id }));
    // 官方 Unpublish_removeChapter 用 href === "#" + id 查找目录项，需保留原值。
    // 浏览器自身处理 URL 展示编码；这里不能提前编码而破坏运行时的精确匹配。
    const toc = tocDom(root.ownerDocument, items, i => `#${(i as TocItem & { id: string }).id || i.text}`);
    // Typora 中目录项保留标题的行内格式（如高亮）
    toc.querySelectorAll<HTMLAnchorElement>("a").forEach((a, n) => {
        const clone = heads[n].cloneNode(true) as HTMLElement;
        clone.querySelectorAll(".heading-collapse-indicator, .md-header-anchor").forEach(e => e.remove());
        a.replaceChildren(...Array.from(clone.childNodes));
    });
    if (p) p.replaceWith(toc);
    else {
        toc.dataset.vlookAutoToc = "true";
        // 保持首个 h6 封面的首元素位置，原版运行时会消费此目录用于导航中心。
        const first = root.firstElementChild;
        if (first?.tagName === "H6") first.after(toc);
        else root.prepend(toc);
    }
}
