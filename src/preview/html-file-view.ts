// 在 Obsidian 内打开库中的 HTML（如 VLOOK 导出文件）：沙箱隔离，页面脚本无法访问 Obsidian。

import { FileView, TFile, WorkspaceLeaf } from "obsidian";

export const VLOOK_HTML_VIEW = "vlook-html-file";

/** 沙箱页面没有可用的 Web Storage；原版运行时依赖 localStorage，按页面生命周期提供内存实现。 */
const STORAGE_SHIM = `<script>(function(){function make(){var m={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null},get length(){return Object.keys(m).length}}}["localStorage","sessionStorage"].forEach(function(n){try{window[n].getItem("");}catch(e){try{Object.defineProperty(window,n,{value:make(),configurable:true})}catch(_){}}})})();</script>`;

/** 注入资源基准地址与存储兼容脚本，让相对路径的图片、媒体按原文件位置加载。 */
export function prepareHtmlDocument(html: string, baseHref: string): string {
    const base = `<base href="${baseHref.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`;
    const head = /<head\b[^>]*>/i.exec(html);
    if (head) return html.slice(0, head.index + head[0].length) + base + STORAGE_SHIM + html.slice(head.index + head[0].length);
    return base + STORAGE_SHIM + html;
}

export class VlookHtmlFileView extends FileView {
    private frame: HTMLIFrameElement | null = null;
    private seq = 0;

    constructor(leaf: WorkspaceLeaf) { super(leaf); }
    getViewType() { return VLOOK_HTML_VIEW; }
    getDisplayText() { return this.file?.basename ?? "HTML"; }
    getIcon() { return "file-code"; }
    canAcceptExtension(extension: string) { return extension === "html" || extension === "htm"; }

    async onLoadFile(file: TFile) {
        const my = ++this.seq;
        const html = await this.app.vault.read(file);
        if (my !== this.seq) return;
        const resource = this.app.vault.getResourcePath(file).replace(/[?#].*$/, "");
        const frame = this.contentEl.ownerDocument.createElement("iframe");
        frame.className = "vlook-html-file-frame";
        // 不加 allow-same-origin：页面脚本拿不到 Obsidian 窗口与 Node 能力
        frame.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-forms");
        frame.srcdoc = prepareHtmlDocument(html, resource);
        this.frame?.remove();
        this.frame = frame;
        this.contentEl.replaceChildren(frame);
    }

    async onUnloadFile() {
        this.seq++;
        this.frame?.remove();
        this.frame = null;
    }
}
