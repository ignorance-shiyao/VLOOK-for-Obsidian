import type { App, TFile } from "obsidian";
import { relativePath } from "./typora-dom";
import { rewriteDocumentLibrary } from '../core/doc-library';

const XLINK='http://www.w3.org/1999/xlink';
type LinkElement=HTMLAnchorElement|SVGAElement;
/** Mermaid SVG may use only the namespaced legacy link attribute. */
function linkHref(anchor:Element):string {
    return anchor.getAttribute('href')??anchor.getAttributeNS(XLINK,'href')??anchor.getAttribute('xlink:href')??'';
}

export interface VaultLink { file: TFile; query: string; hash: string }

export function rewriteLibraryLinks(value:unknown,app:App,sourcePath:string,mode:'preview'|'export',extension='html',doc:Document=document,outDir?:string):unknown {
    return rewriteDocumentLibrary(value,href=>{
        if(mode==='preview'){
            const link=resolveVaultLink(app,href,sourcePath);
            return link?`app://obsidian.md/__vlook_vault__/${encodeURIComponent(link.file.path).replace(/%2F/g,'/')}${link.query}${link.hash}`:href;
        }
        const container=doc.createElement('div'),anchor=doc.createElement('a');
        anchor.setAttribute('href',href);container.append(anchor);
        rewriteExportLinks(container,app,sourcePath,extension,outDir);
        return anchor.getAttribute('href')||href;
    });
}

/** DocLib.init 会删除专用链接的 href，宿主仍需保留可解析的源地址。 */
export function preservePreviewLinks(root: HTMLElement): void {
    root.querySelectorAll<LinkElement>('a').forEach(anchor => {
        anchor.dataset.vlookSourceHref = anchor.dataset.href || linkHref(anchor);
    });
}

export function previewLinkHref(anchor: LinkElement): string {
    return anchor.dataset.vlookSourceHref || anchor.dataset.href || linkHref(anchor);
}

/** 在改写扩展名后仍能解析到库内 Markdown；先分隔再解码，保留编码文件名。 */
export function resolveVaultLink(app: App, href: string, sourcePath: string): VaultLink | null {
    return resolveVaultResource(app,href,sourcePath,true);
}

/** 附件同样通过库解析器还原真实路径，不能只依赖链接显示时的短文件名。 */
function resolveVaultResource(app: App, href: string, sourcePath: string,markdownOnly=false): VaultLink | null {
    // 官方文库把相对地址展开为绝对 URL；仅接受插件生成的 vault 命名空间。
    if (href.startsWith("app://obsidian.md/__vlook_vault__/")) {
        href = href.slice("app://obsidian.md/__vlook_vault__/".length);
        sourcePath = "";
    }
    if (!href || /^[#?]/.test(href) || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(href)) return null;
    const match = href.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
    if (!match) return null;
    let path = match[1];
    try { path = decodeURIComponent(path); } catch { /* 非法转义保持原值供 Obsidian 解析 */ }
    const paths = [path];
    if (/\.html?$/i.test(path)) paths.push(path.replace(/\.html?$/i, ".md"));
    for (const candidate of paths) {
        const file = app.metadataCache.getFirstLinkpathDest(candidate, sourcePath);
        if (file&&(!markdownOnly||file.extension==='md')) return {file, query:match[2] || "", hash:match[3] || ""};
    }
    return null;
}

/** 导出的 wiki / Markdown 链接统一使用实际文件路径，不依赖 vault 内部解析器。 */
export function rewriteExportLinks(root: HTMLElement, app: App, sourcePath: string, extension = "html", outDir?: string): void {
    // 相对链接以导出文件所在目录为基准；未指定时与源笔记同目录
    const dir = outDir ?? (sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "");
    root.querySelectorAll<LinkElement>("a").forEach(a => {
        const href = linkHref(a);
        if (href.startsWith("#")) return;
        const resolved = resolveVaultResource(app, a.dataset.href || href, sourcePath);
        if (!resolved) return;
        const options = new URLSearchParams(resolved.query);
        const xmd = extension === "off" ? "off" : options.get("xmd") || extension;
        const ext = xmd === "off" ? "md" : /^[\w-]+$/.test(xmd) ? xmd : "html";
        const target = resolved.file.extension==='md'?resolved.file.path.replace(/\.md$/i, `.${ext}`):resolved.file.path;
        const rewritten=encodeURI(relativePath(dir, target)).replace(/#/g, "%23").replace(/\?/g, "%3F") + resolved.query + resolved.hash;
        a.setAttribute("href", rewritten);
        if(a.hasAttributeNS(XLINK,'href')||a.hasAttribute('xlink:href'))a.setAttributeNS(XLINK,'xlink:href',rewritten);
        a.dataset.vlookResolvedLink='1';
        // data-href 是 Obsidian 的运行时路径，导出后不应再被插件当作旧地址使用。
        a.removeAttribute("data-href");
        a.classList.remove("internal-link", "is-unresolved");
    });
}
