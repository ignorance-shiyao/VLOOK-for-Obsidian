import {rewriteSrcset} from '../core/srcset';
import { prepareImageCaptions } from './image-captions';
import {processMermaid} from '../features/mermaid';
// 把 Obsidian 渲染出的 DOM 转换为 Typora 导出 HTML 的 DOM 结构，
// 以便直接运行官方 VLOOK 插件（导航中心、幻灯片、画中画、内容助手等全部特性）

import { tableGrid } from "../features/table-tools";
import { isUnpublishedQuote, unpublishedMatcher } from "../core/unpublished";
import { decodeUrlPart, encodeResourcePath } from "../core/url";
import { newEl, setHtml, wrapTextSpans } from '../core/dom';
import { buildTyporaToc } from "../features/toc";
import { restoreSpacedLinks } from '../core/spaced-links';
import { normalizeSubSup } from "../core/normalize";

const TOKEN_TO_CM: Record<string, string> = {
    keyword: "cm-keyword", string: "cm-string", "template-string": "cm-string", char: "cm-string",
    comment: "cm-comment", prolog: "cm-comment", doctype: "cm-comment", cdata: "cm-comment",
    number: "cm-number", boolean: "cm-atom", constant: "cm-atom", symbol: "cm-atom",
    function: "cm-variable", "function-name": "cm-def", "class-name": "cm-def",
    operator: "cm-operator", builtin: "cm-builtin", property: "cm-property",
    tag: "cm-tag", "attr-name": "cm-attribute", "attr-value": "cm-string", regex: "cm-string-2",
    variable: "cm-variable-2", selector: "cm-tag", important: "cm-keyword", entity: "cm-atom", url: "cm-link",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 将 Prism 高亮后的 <code> 按行拆分为 CodeMirror 行 */
function codeToLines(code: HTMLElement): string[] {
    const lines: string[] = [""];
    const walk = (node: Node, cls: string) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const parts = (node.textContent || "").split("\n");
            parts.forEach((part, i) => {
                if (i > 0) lines.push("");
                if (part) lines[lines.length - 1] += cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part);
            });
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as HTMLElement;
        if(el.tagName==='BR'){lines.push('');return;}
        let c = cls;
        if (el.classList.contains("token")) {
            const mapped = Array.from(el.classList).map(k => TOKEN_TO_CM[k]).find(Boolean);
            if (mapped) c = mapped;
        }
        el.childNodes.forEach(n => walk(n, c));
    };
    code.childNodes.forEach(n => walk(n, ""));
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    return lines;
}

function buildFence(pre: HTMLElement): HTMLElement {
    const doc = pre.ownerDocument;
    const code = pre.querySelector("code");
    const lang = ([...Array.from(code?.classList ?? []),...Array.from(pre.classList)].find(c => c.startsWith("language-")) || "").replace("language-", "");
    const lines = codeToLines(code||pre);
    const out = newEl(doc, "pre");
    out.className = "md-fences md-end-block ty-contain-cm modeLoaded";
    out.setAttribute("spellcheck", "false");
    out.setAttribute("lang", lang);
    const body = lines.map(l => `<div style="position: relative;" role="presentation"><pre class=" CodeMirror-line " role="presentation"><span role="presentation" style="padding-right: 0.1px;">${l || "<span cm-text=\"\">​</span>"}</span></pre></div>`).join("");
    setHtml(out, `<div class="CodeMirror cm-s-inner cm-s-null-scroll CodeMirror-wrap"><div class="CodeMirror-scroll" tabindex="-1"><div class="CodeMirror-sizer" style="margin-left: 0px;"><div style="position: relative; top: 0px;"><div class="CodeMirror-lines" role="presentation"><div role="presentation" style="position: relative; outline: none;"><div class="CodeMirror-code" role="presentation">${body}</div></div></div></div></div></div></div>`);
    out.firstElementChild!.setAttribute('lang',lang);
    return out;
}

const ALERTS: Record<string, string> = { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" };

function convertCallouts(root: HTMLElement) {
    const doc = root.ownerDocument;
    root.querySelectorAll<HTMLElement>(".callout[data-callout]").forEach(c => {
        const type = (c.dataset.callout || "").toLowerCase();
        const content = c.querySelector(".callout-content");
        const title = (c.querySelector(".callout-title-inner")?.textContent || "").trim();
        if (ALERTS[type]) {
            const div = newEl(doc, "div");
            div.className = `md-alert md-alert-${type} ${type}`;
            setHtml(div, `<p><span class="md-alert-text md-alert-text-${type}">${ALERTS[type]}</span></p>`);
            if (content) div.append(...Array.from(content.childNodes));
            c.replaceWith(div);
        } else {
            // 其他类型的 callout 退化为带小标题的引用块
            const bq = newEl(doc, "blockquote");
            if (title) setHtml(bq, `<p><strong>${esc(title)}</strong></p>`);
            if (content) bq.append(...Array.from(content.childNodes));
            c.replaceWith(bq);
        }
    });
}

/**
 * 转换（原地修改）
 * @param root Obsidian 渲染结果容器
 * @param genericSubSup 是否识别 ~x~ / ^x^
 */
export function toTyporaDom(root: HTMLElement, genericSubSup: boolean, imageCaptionExtension = true): void {
    const doc = root.ownerDocument;
    // The official runtime needs raw fragment keywords for its own localization/colors.
    processMermaid(root,{fragments:false});
    // Typora 中独占一段的原生播放器是 #write 的直接子节点，不包段落
    root.querySelectorAll('p').forEach(p => {
        const only = p.firstElementChild;
        if (p.childElementCount === 1 && only?.matches('audio:not([alt]),video:not([alt])') && !p.textContent?.trim()) p.replaceWith(only);
    });
    // Caption_genForMedia assigns an ID to the player's parent. A direct #write
    // child must not let that operation rename the whole document container.
    // Typora 不为无 alt 的原生播放器生成题注容器，因此只包装带 alt 的播放器。
    root.querySelectorAll('audio[alt],video[alt]').forEach(media => {
        if (media.parentElement?.tagName === 'FIGURE') return;
        const figure = newEl(root.ownerDocument, 'figure');
        media.replaceWith(figure); figure.append(media);
    });
    // 1) 拍平块包装：Obsidian 每个块外有一层 div（el-p、el-table...）
    root.querySelectorAll(":scope > div").forEach(div => {
        if (/(^|\s)el-/.test(div.className) || div.attributes.length === 0) {
            while (div.firstChild) root.insertBefore(div.firstChild, div);
            div.remove();
        }
    });
    // 2) 移除 Obsidian 的界面元素
    root.querySelectorAll(".heading-collapse-indicator, .collapse-indicator, .copy-code-button, .edit-block-button, .list-collapse-indicator, .frontmatter, .frontmatter-container, .metadata-container, .mod-header, .mod-footer, .markdown-preview-pusher, .embedded-backlinks").forEach(e => e.remove());
    root.querySelectorAll("[contenteditable]").forEach(e => e.removeAttribute("contenteditable"));
    // 3) 下标、上标语法；Typora 允许的目标含空格链接
    normalizeSubSup(root, genericSubSup);
    restoreSpacedLinks(root);
    if (imageCaptionExtension) prepareImageCaptions(root);
    // 4) 首个标题保留文本锚点；重复标题使用不与其他标题 / 元素冲突的 ID。
    const headings = Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));
    const bases = new Set(headings.map(hx => (hx.textContent || "").trim() || "heading"));
    const used = new Set(Array.from(root.querySelectorAll<HTMLElement>("[id]"))
        .filter(el => !/^H[1-6]$/.test(el.tagName)).map(el => el.id));
    headings.forEach(hx => {
        const base = (hx.textContent || "").trim() || "heading";
        let id = base, suffix = 2;
        if (used.has(id)) do { id = `${base}-${suffix++}`; } while (used.has(id) || bases.has(id));
        hx.id = id;
        used.add(id);
        hx.removeAttribute("data-heading");
        hx.removeAttribute("dir");
    });
    // 5) 代码块 → CodeMirror 结构；Mermaid / 公式
    root.querySelectorAll<HTMLElement>("pre").forEach(pre => {
        if (pre.closest(".md-fences")) return;
        // Mermaid 的合法输出容器也可能是 pre；不能先按普通代码清空 SVG。
        if (pre.matches(".mermaid") || pre.querySelector(".mermaid")) return;
        if (pre.classList.contains("frontmatter")) { pre.remove(); return; }
        pre.replaceWith(buildFence(pre));
    });
    root.querySelectorAll<HTMLElement>(".mermaid").forEach(m => {
        if (!root.contains(m) || m.classList.contains("md-diagram-panel")) return;
        const svg = m.querySelector("svg");
        if (!svg) return;
        // 与 Typora 导出一致：图表是裸的 div.md-diagram-panel；包在 pre.md-fences 里会被原版再算作代码块并抢走题注
        const panel = newEl(doc, "div");
        panel.className = `md-diagram-panel md-fences-adv-panel ${m.className}`;
        panel.setAttribute("lang", "mermaid");
        if (m.id) panel.id = m.id;
        // 部分渲染器将样式放在 SVG 外；只移动 SVG 会丢掉这些选择器。
        for (const style of Array.from(m.querySelectorAll("style"))) {
            if (!style.closest("svg")) panel.append(style);
        }
        for (const name of ["role", "aria-label", "aria-labelledby", "aria-describedby"])
            if (m.hasAttribute(name)) panel.setAttribute(name, m.getAttribute(name)!);
        panel.append(svg);
        const parent = m.parentElement;
        if (parent?.tagName === "PRE" && Array.from(parent.childNodes).every(node => node === m || node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()))
            parent.replaceWith(panel);
        else m.replaceWith(panel);
    });
    root.querySelectorAll<HTMLElement>(".math.math-block").forEach(m => {
        const div = newEl(doc, "div");
        div.className = "mathjax-block md-end-block md-math-block md-rawblock";
        div.setAttribute("mdtype", "math_block");
        const box = newEl(doc, "div");
        box.className = "md-math-container";
        box.append(...Array.from(m.childNodes));
        div.append(box);
        (m.closest("p") && m.closest("p")!.textContent.trim() === m.textContent.trim() ? m.closest("p")! : m).replaceWith(div);
    });
    // ```math 在 Typora 中是高级代码块（md-fences-math），运行时据此认领前置题注
    root.querySelectorAll<HTMLElement>("[data-vlook-math-fence]").forEach(wrapper => {
        const box = wrapper.querySelector(".md-math-container");
        if (!box) return;
        const fence = newEl(doc, "div");
        fence.className = "md-fences md-end-block md-fences-math md-fences-advanced ty-contain-cm modeLoaded";
        for (const [name, value] of [["spellcheck", "false"], ["contenteditable", "false"], ["lang", "math"], ["mdtype", "fences"]]) fence.setAttribute(name, value);
        fence.append(box);
        wrapper.replaceWith(fence);
    });
    root.querySelectorAll<HTMLElement>(".math.math-inline").forEach(m => {
        m.className = "md-inline-math";
    });
    // 6) 表格放入 figure.table-figure；对齐写成 Typora 的 style（原版数值列格式按 text-align 识别）
    root.querySelectorAll<HTMLElement>("th[align],td[align]").forEach(cell => {
        cell.style.textAlign = cell.getAttribute("align")!;
        cell.removeAttribute("align");
    });
    root.querySelectorAll("table").forEach(t => {
        if (t.parentElement?.tagName === "FIGURE") return;
        const f = newEl(doc, "figure");
        f.className = "table-figure";
        t.replaceWith(f);
        f.append(t);
    });
    // 7) GSA 与其他 callout
    convertCallouts(root);
    // 8) 任务清单
    root.querySelectorAll<HTMLElement>("li.task-list-item").forEach(li => {
        // A nested task's checkbox must never become its ancestor's checkbox.
        const input = Array.from(li.querySelectorAll<HTMLInputElement>('input[type=checkbox]')).find(input=>input.closest('li')===li);
        const checked = input ? input.checked : li.classList.contains("is-checked") || !!(li.dataset.task && li.dataset.task !== " ");
        li.classList.toggle("task-list-done",checked);
        li.classList.add("md-task-list-item");
        input?.removeAttribute("class");
        if(input){
            input.toggleAttribute('checked',checked);
            // indeterminate is a DOM property, so innerHTML alone would lose it.
            if(input.indeterminate)input.dataset.vlookIndeterminate='1';
            else delete input.dataset.vlookIndeterminate;
        }
        // 列表项内容放入 <p>
        if (!li.querySelector(":scope > p")) {
            const p = newEl(doc, "p");
            const nodes = Array.from(li.childNodes).filter(n => n !== input && !(n.nodeType === 1 && /^(UL|OL)$/.test((n as Element).tagName)));
            p.append(...nodes);
            input ? input.after(p) : li.prepend(p);
        }
    });
    root.querySelectorAll("ul.contains-task-list").forEach(ul => ul.classList.add("task-list"));
    // 9) 脚注
    root.querySelectorAll<HTMLElement>("sup.footnote-ref, sup[data-footnote-id]").forEach(s => {
        s.className = "md-footnote";
    });
    let footnoteCount = 0;
    root.querySelectorAll<HTMLElement>("section.footnotes").forEach(sec => {
        const area = newEl(doc, "div");
        area.className = "footnotes-area";
        area.append(newEl(doc, "hr"));
        sec.querySelectorAll<HTMLElement>(":scope > ol > li").forEach(li => {
            const number = ++footnoteCount;
            const name = `ref-footnote-${number}`;
            root.querySelectorAll<HTMLAnchorElement>("sup.md-footnote a[href]").forEach(ref => {
                let target = (ref.getAttribute("href") || "").slice(1);
                try { target = decodeURIComponent(target); } catch { /* 保留原始 ID */ }
                if (li.id && target === li.id) ref.setAttribute("name", name);
            });
            const line = newEl(doc, "div");
            line.className = "footnote-line";
            if (li.id) line.id = li.id;
            li.querySelectorAll("a.footnote-backref").forEach(back => back.remove());
            const anchor = newEl(doc, "a"); anchor.setAttribute("name", `df${name}`);
            const count = newEl(doc, "span"); count.className = "md-fn-count"; count.textContent = String(number);
            line.append(anchor, count, " ", ...Array.from(li.childNodes));
            area.append(line);
        });
        sec.replaceWith(area);
    });
    // 10) 内部链接：同文档标题锚点
    root.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach(a => {
        const href = a.getAttribute("data-href") || a.getAttribute("href") || "";
        if (href.startsWith("#")) a.setAttribute("href", "#" + href.slice(1).split("#").pop());
        a.removeAttribute("target");
        a.classList.remove("internal-link");
    });
    // 宿主为图片加的浏览器懒加载会让屏幕外的卡片/图标图片不加载，原版运行时等不到其处理；原版有自己的懒加载模式
    root.querySelectorAll<HTMLImageElement>('img[loading="lazy"][decoding="async"]').forEach(img => {
        img.removeAttribute("loading"); img.removeAttribute("decoding");
    });
    root.querySelectorAll<HTMLElement>(".internal-embed.image-embed").forEach(e => {
        const img = e.querySelector("img");
        if (img) e.replaceWith(img);
    });
    // Obsidian 把 #词 渲染为标签链接；Typora 中是普通文字，留作链接会被原版标为失效链接
    root.querySelectorAll<HTMLAnchorElement>("a.tag").forEach(a => a.replaceWith(a.ownerDocument.createTextNode(a.textContent || "")));
    root.querySelectorAll("[data-vlook]").forEach(e => e.removeAttribute("data-vlook"));
    // 11) 文本包 span
    wrapTextSpans(root);
    // 12) [TOC] 目录
    buildTyporaToc(root);
}

/** 导出时移除不发布的章节：标题整体为删除线（~~标题~~），到下一个同级或更高级标题为止 */
export function removeUnpublished(root: HTMLElement, configured?:unknown): void {
    const matches=unpublishedMatcher(configured);
    root.querySelectorAll<HTMLTableElement>('table').forEach(table=>{
        const grid=tableGrid(table),hidden=new Set<number>();
        for(const row of grid)row.forEach((cell,column)=>{
            if(cell.tagName==='TH'&&cell.querySelector(':scope > del:first-child,:scope > s:first-child'))hidden.add(column);
        });
        if(!hidden.size)return;
        const columns=new Map<HTMLTableCellElement,Set<number>>();
        for(const row of grid)row.forEach((cell,column)=>{
            if(!columns.has(cell))columns.set(cell,new Set());columns.get(cell)!.add(column);
        });
        for(const [cell,positions] of columns){
            const remaining=Array.from(positions).filter(column=>!hidden.has(column)).length;
            if(!remaining)cell.remove();else if(remaining!==positions.size)cell.colSpan=remaining;
        }
    });
    // 原版小标题位于首个或第二个段落内的独占 strong / mark，折叠标题为首个 h6。
    root.querySelectorAll('blockquote').forEach(quote=>{
        if(isUnpublishedQuote(quote,configured))quote.remove();
    });
    const isUnpub = (hx: Element) => !!hx.querySelector(":scope > del,:scope > s") || matches(hx.textContent||'');
    for (const hx of Array.from(root.querySelectorAll(":scope > :is(h1,h2,h3,h4,h5,h6)"))) {
        if (!root.contains(hx) || !isUnpub(hx)) continue;
        const level = Number(hx.tagName[1]);
        let next = hx.nextElementSibling;
        while (next && !next.classList.contains("footnotes-area") && !(/^H[1-6]$/.test(next.tagName) && Number(next.tagName[1]) <= level)) {
            const n = next.nextElementSibling;
            next.remove();
            next = n;
        }
        hx.remove();
    }
}

/** 兜底：导出时把仍为 Obsidian 资源地址（app://…）的图片 / 音视频改为相对路径，去掉 Obsidian 的时间戳参数 */
export function appUrlsToRelative(root: HTMLElement, basePath: string, dir: string): void {
    if(!basePath)return; // Without an adapter base, an absolute path must not be guessed.
    const normalized=basePath.replace(/\\/g,'/'),base=normalized.replace(/\/+$/, '')+'/';
    const windows=/^[a-z]:\//i.test(base);
    const relative=(url:string):string=>{
        const m=url.match(/^app:\/\/[^/]+(\/[^?#]*)(\?[^#]*)?(#.*)?$/i);
        if(!m)return url;
        let abs=decodeUrlPart(m[1]);
        if(windows)abs=abs.replace(/^\/(?=[a-z]:\/)/i,'').replace(/\\/g,'/');
        if(!(windows?abs.toLowerCase().startsWith(base.toLowerCase()):abs.startsWith(base)))return url;
        const query=(m[2]||'').slice(1).split('&').filter(kv=>kv&&!/^\d+$/.test(kv)).join('&');
        return encodeResourcePath(relativePath(dir,abs.slice(base.length)))+(query?'?'+query:'')+(m[3]||'');
    };
    const resolve=(url:string):string=>{
        const converted=relative(url),hashAt=converted.indexOf('#');
        const body=hashAt<0?converted:converted.slice(0,hashAt),fragment=hashAt<0?'':converted.slice(hashAt);
        const question=body.indexOf('?');if(question<0)return converted;
        const query=body.slice(question+1).split('&').map(part=>{
            const equal=part.indexOf('=');if(equal<0)return part;
            const key=decodeUrlPart(part.slice(0,equal)),raw=part.slice(equal+1),value=decodeUrlPart(raw);
            let next=value;
            if(key==='darksrc')next=relative(value);
            else if(key==='srcset'||key==='darksrcset')next=value.split(',').map(candidate=>{
                const match=candidate.match(/^(\s*)(.*?)(@[23]x)?(\s*)$/)!;
                return match[1]+relative(match[2])+(match[3]||'')+match[4];
            }).join(',');
            return next===value?part:part.slice(0,equal+1)+encodeURIComponent(next);
        }).join('&');
        return body.slice(0,question+1)+query+fragment;
    };
    root.querySelectorAll<HTMLElement>('img,audio,video,source,track').forEach(el=>{
        for(const attribute of el.tagName==='VIDEO'?['src','poster']:['src']){
            const value=el.getAttribute(attribute);if(value!==null){const next=resolve(value);if(next!==value)el.setAttribute(attribute,next);}
        }
        if(el.matches('img,source')&&el.hasAttribute('srcset')){
            const value=el.getAttribute('srcset')!,next=rewriteSrcset(value,resolve);
            if(next!==value)el.setAttribute('srcset',next);
        }
    });
}

export function relativePath(fromDir: string, to: string): string {
    const a = fromDir ? fromDir.split("/") : [], b = to.split("/");
    while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift(); }
    return [...a.map(() => ".."), ...b].join("/");
}

/** 只清除内部渲染标记，绝不能以“首段”位置推断它。 */
export function removeRenderingMarker(root: HTMLElement): void {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    const markers: Comment[] = [];
    while (walker.nextNode()) {
        const node = walker.currentNode as Comment;
        if (node.data.trim() === "vlook-raw-render") markers.push(node);
    }
    for (const marker of markers) {
        const parent = marker.parentElement;
        marker.remove();
        if (parent?.tagName === "P" && !parent.textContent?.trim() && !parent.children.length) parent.remove();
    }
}
