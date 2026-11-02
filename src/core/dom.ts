// DOM 小工具（替代原版的 jQuery 简写）

/** 惰性解析 HTML：DOMParser 文档不执行脚本、不加载资源，再导入到目标文档。 */
export function parseHtml(doc: Document, html: string): DocumentFragment {
    const Parser = doc.defaultView?.DOMParser ?? DOMParser;
    const parsed = new Parser().parseFromString(`<!doctype html><body>${html}`, "text/html");
    const fragment = doc.createDocumentFragment();
    for (const node of Array.from(parsed.body.childNodes)) fragment.append(doc.importNode(node, true));
    return fragment;
}

/** 以解析后的节点替换元素内容，替代 innerHTML 赋值。 */
export function setHtml(el: Element, html: string): void {
    el.replaceChildren(parseHtml(el.ownerDocument, html));
}

/** 解码 HTML 实体（与 textarea 相同：标签按原文保留）。 */
export function decodeEntities(raw: string, doc: Document = activeDocument): string {
    const Parser = doc.defaultView?.DOMParser ?? DOMParser;
    const parsed = new Parser().parseFromString(`<!doctype html><body><textarea>${raw.replace(/<\/textarea/gi, "&lt;/textarea")}</textarea>`, "text/html");
    return parsed.querySelector("textarea")?.value ?? raw;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, attrs?: Record<string, string>, html?: string): HTMLElementTagNameMap[K] {
    const el = activeDocument.createElement(tag);
    if (cls) el.className = cls;
    if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (html !== undefined) setHtml(el, html);
    return el;
}

export function wrap(target: Element, wrapper: HTMLElement): HTMLElement {
    target.parentNode?.insertBefore(wrapper, target);
    wrapper.appendChild(target);
    return wrapper;
}

export function unwrap(el: Element): void {
    const p = el.parentNode;
    if (!p) return;
    while (el.firstChild) p.insertBefore(el.firstChild, el);
    p.removeChild(el);
}

const copyFallbacks=new WeakMap<Document,{source:HTMLElement;close:(restoreFocus?:boolean)=>void}>();
const latestDocumentCopy=new WeakMap<Document,symbol>();
const latestElementCopy=new WeakMap<HTMLElement,symbol>();

/** 复制失败时显示准确的待复制文本，不用标签的显示文字代替原始值。 */
function manualCopy(el:HTMLElement,text:string){
    const doc=el.ownerDocument;
    if(!el.isConnected)return;
    copyFallbacks.get(doc)?.close(false);
    const previous=doc.activeElement as HTMLElement|null;
    const box=doc.createElement('span');box.className='vlook-copy-fallback';
    box.setAttribute('role','group');box.setAttribute('aria-label','手动复制');
    box.addEventListener('click',event=>event.stopPropagation());
    const message=doc.createElement('span');message.textContent='自动复制未成功，已选中文本，可手动复制。';
    message.setAttribute('aria-live','polite');
    const input=doc.createElement('textarea');input.readOnly=true;input.value=text;
    input.rows=Math.min(6,Math.max(2,text.split('\n').length));input.setAttribute('aria-label','待复制内容');
    const button=doc.createElement('button');button.type='button';button.textContent='关闭';
    const state={source:el,close:(restoreFocus=true)=>{
        box.remove();if(copyFallbacks.get(doc)===state)copyFallbacks.delete(doc);
        if(restoreFocus&&previous?.isConnected)previous.focus({preventScroll:true});
    }};
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();state.close();});
    box.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();state.close();}});
    box.append(message,input,button);el.after(box);copyFallbacks.set(doc,state);
    input.focus({preventScroll:true});input.select();
}

/** 复制文本到所属窗口的剪贴板，并给出视觉反馈或手动复制入口。 */
export async function copyText(el: HTMLElement, text: string): Promise<void> {
    const doc=el.ownerDocument,win=doc.defaultView,request=Symbol('copy');
    latestDocumentCopy.set(doc,request);latestElementCopy.set(el,request);
    copyFallbacks.get(doc)?.close(false);el.classList.remove('vlook-copied');
    const current=()=>latestDocumentCopy.get(doc)===request&&latestElementCopy.get(el)===request&&el.ownerDocument===doc&&el.isConnected;
    try {
        if(!win?.navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
        await win.navigator.clipboard.writeText(text);
        if(!current())return;
        el.classList.add("vlook-copied");
        win.setTimeout(() => {if(latestElementCopy.get(el)===request)el.classList.remove("vlook-copied");}, 800);
    } catch { if(current())manualCopy(el,text); }
}

const keyboardCopyValues=new WeakMap<HTMLElement,()=>string>();
/** Add keyboard copying only where it cannot replace native nested-link navigation. */
export function keyboardCopy(el:HTMLElement,value:()=>string,options:{role?:'button'|'group';label?:string}={}):void {
    if(el.closest('a[href],button,input,textarea,select,summary')||el.querySelector('a[href],button,input,textarea,select'))return;
    const role=options.role||'button';
    if(el.hasAttribute('role')&&el.getAttribute('role')!==role)return;
    const bound=keyboardCopyValues.has(el);keyboardCopyValues.set(el,value);
    el.setAttribute('role',role);el.tabIndex=0;el.classList.add('vlook-keyboard-copy');
    if(options.label)el.setAttribute('aria-label',options.label);
    if(bound)return;
    el.addEventListener('keydown',event=>{
        if(event.target!==el||!['Enter',' '].includes(event.key)||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||event.isComposing)return;
        if(el.closest('a[href],button,input,textarea,select,summary'))return;
        event.preventDefault();event.stopPropagation();
        if(!event.repeat)void copyText(el,keyboardCopyValues.get(el)!());
    });
}

export function svgIcon(icon: string, w: number, h: number, color: string, cls = "", ext = ""): string {
    return `<svg width="${w}px" height="${h}px" class="v-svg-i-small${cls ? " " + cls : ""}"${ext ? " " + ext : ""}><use class="v-svg-i-${color}" xlink:href="#${icon}"></use></svg>`;
}

/** 递归地给文本节点包上 <span>（Typora 的导出结构如此，VLOOK 的部分选择器依赖它） */
export function wrapTextSpans(root: HTMLElement) {
    const skip = new Set(["PRE", "CODE", "SCRIPT", "STYLE", "SVG", "MJX-CONTAINER", "TEXTAREA", "TITLE", "SPAN", "KBD", "RT", "RP", "OPTION"]);
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n as Text;
        // 行内纯空格（如 **举例** 后的空格）Typora 也包成 <span>；块之间的换行空白不处理
        if (!t.data.trim() && (!/^[ \u00a0]+$/.test(t.data) || !/^(P|H[1-6]|LI|TD|TH)$/.test(t.parentElement?.tagName || ""))) continue;
        let ok = true;
        for (let p = t.parentElement; p && p !== root; p = p.parentElement) {
            if (skip.has(p.tagName.toUpperCase()) || p.classList.contains("math")) { ok = false; break; }
        }
        if (ok && t.parentElement && !skip.has(t.parentElement.tagName.toUpperCase())) targets.push(t);
    }
    for (const t of targets) {
        const span = doc.createElement("span");
        t.replaceWith(span);
        span.appendChild(t);
    }
    // kbd 内也需要 span
    root.querySelectorAll("kbd").forEach(k => {
        if (k.children.length === 0 && k.textContent) { const sp = doc.createElement("span"); sp.textContent = k.textContent; k.replaceChildren(sp); }
    });
}
