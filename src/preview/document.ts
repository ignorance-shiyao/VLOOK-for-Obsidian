import {typographyCss} from '../core/page-appearance';
import {renderZenUmlFallback} from '../features/zenuml-fallback';
import {resolveThemeName} from '../core/themes';
import {normalizeVlookQuery,vlookQueryParams} from '../core/query-source';
import {restoreExportTaskStates} from './task-state';
// 生成完整的 VLOOK HTML 文档（Typora 导出结构 + 官方 VLOOK 插件）
// 用于「VLOOK 预览」与「导出 HTML」

import { Query, readCssVar } from "../core/context";
import { decodeUrlPart, encodeResourcePath } from "../core/url";
import { Component, MarkdownRenderer, TFile, getFrontMatterInfo } from "obsidian";
import type VlookPlugin from "../main";
import { collectInlineImages, installInlineImages } from "./inline-images";
import { installPopupGuard } from "./popup-guard";
import { appUrlsToRelative, relativePath, removeUnpublished, removeRenderingMarker, toTyporaDom } from "./typora-dom";
import { resolveBrokenEmbeds } from "../features/image";
import { normalizeLiteralInline } from "../core/normalize";
import runtime from "../generated/vlook-runtime.txt";
import typoraBase from "../generated/typora-base.txt";
import { ICON_SPRITE } from "../generated/icons";
import { preservePreviewLinks, rewriteExportLinks, rewriteLibraryLinks } from "./links";
import { currentLang } from "../core/i18n";
import { restoreImages } from "./image-restore";
import { sourceDiagramCount, waitForDiagrams } from "./diagram-ready";
import { sourceMathFenceCount, waitForMath } from './math-ready';
import { insertTyporaBlankParagraphs } from '../core/fenced-source';
import { parseFrontmatterYaml } from '../core/frontmatter';
import { collectMathStyles } from './math-styles';
import diagramInteractions from '../../styles/diagram-interaction.css';
import printCompat from '../../styles/print-compat.css';
import imageCompat from '../../styles/image-compat.css';
import { installExportGifControls } from './gif-control';
import { exportThemesHtml, installExportThemeSwitcher, installExportFade } from './theme-export';
import { FADE_CSS } from '../core/fade';
import { THEMES } from '../core/themes';
import { enhanceExportMiniAudio } from './mini-audio-access';

export const RAW_MARKER = "<!--vlook-raw-render-->";


export interface BuildOptions {
    /** 图片地址的处理：preview 使用 Obsidian 资源地址；export 使用相对路径或内嵌 */
    mode: "preview" | "export";
    /** 导出阶段提示。 */
    onProgress?: (stage: string) => void;
    theme?: string;
    /** 发起预览/导出的宿主文档，用于离屏渲染与主题配置。 */
    document?: Document;
    /** 启用原版发布为 PDF 的打印准备界面。 */
    print?: boolean;
    /** iframe 原 URL 的参数；在 srcdoc 中通过 meta 传给原版运行时。 */
    query?: string;
    /** 导出时一并内嵌的主题，多于一套时页面中提供切换。 */
    themes?: string[];
    /** 导出文件所在的库内文件夹；资源相对路径据此换算，默认为源文档所在文件夹。 */
    outDir?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** 让界面先绘制出进度提示，再进入耗时步骤。 */
const paint = (doc: Document): Promise<void> => new Promise(resolve => { const win = doc.defaultView || window; const next = () => win.setTimeout(resolve, 30); if (win.requestAnimationFrame) win.requestAnimationFrame(next); else next(); });

function waitFor(ms: number, doc: Document) {
    return new Promise(r => (doc.defaultView || window).setTimeout(r, ms));
}

/** 等待宿主异步图表与公式输出完成。 */
async function settle(el: HTMLElement, source: string): Promise<number> {
    await waitForDiagrams(el,15000,100,sourceDiagramCount(source));
    const mathErrors=await waitForMath(el,15000,100,undefined,sourceMathFenceCount(source));
    await waitFor(50,el.ownerDocument);
    return mathErrors;
}


/** 预览 iframe 与宿主同源：只放行本页生成的脚本（带一次性随机数），内联事件属性、javascript: 地址与外部脚本都不会执行。 */
function lockScripts(html: string): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const nonce = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    const csp = `<meta http-equiv="Content-Security-Policy" content="script-src 'nonce-${nonce}' 'unsafe-eval' blob:; object-src 'none'; base-uri 'none'">`;
    return html
        .replace(/<head>/, `<head>${csp}`)
        .replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`);
}

/** 预览 iframe 与宿主同源：YAML 里的 HTML（如欢迎页）去掉脚本、事件属性与 javascript: 地址 */
function sanitizeHtml(value: string, doc: Document): string {
    if (!value.includes("<")) return value;
    const tpl = { content: new DOMParser().parseFromString(value, "text/html").body };
    tpl.content.querySelectorAll("script,iframe,object,embed,base,meta[http-equiv]").forEach(el => el.remove());
    tpl.content.querySelectorAll("*").forEach(el => {
        for (const attr of [...el.attributes]) {
            if (/^on/i.test(attr.name) || (/^(href|src|xlink:href|formaction|action|srcdoc)$/i.test(attr.name) && /^(javascript|vbscript|data:text\/html)/i.test(attr.value.replace(/[\u0000-\u0020\u007f-\u009f]/g, "")))) el.removeAttribute(attr.name);
        }
    });
    return tpl.content.innerHTML;
}

function sanitizeFrontMatter<T>(value: T, doc: Document): T {
    if (typeof value === "string") return sanitizeHtml(value, doc) as T;
    if (Array.isArray(value)) return value.map(item => sanitizeFrontMatter(item, doc)) as T;
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeFrontMatter(v, doc)])) as T;
    return value;
}

/** 导出页的 VLOOK 署名（侧栏底部、文末）：默认隐藏；开启后可替换为自定义内容 */
function brandingCss(show?: boolean, text?: string): string {
    if (!show) return ".v-copyright,.sidebar-content::after{display:none!important}";
    if (!text) return "";
    const literal = JSON.stringify(text).replace(/</g, "\\3c ");
    return `.sidebar-content::after{content:${literal}!important}.v-copyright>*{display:none!important}.v-copyright::after{content:${literal};font-size:12px;opacity:.7}`;
}

export async function buildVlookHtml(plugin: VlookPlugin, file: TFile, opts: BuildOptions): Promise<{ html: string; title: string; mathErrors: number }> {
    if (opts.mode === "export") plugin.clearAssetCache?.();
    const app = plugin.app;
    const doc = opts.document || document;
    const cssVar = (name:string) => readCssVar(name,doc.body);
    const themeQuery = cssVar("--vlook-query");
    const source = await app.vault.cachedRead(file);
    const fmInfo = getFrontMatterInfo(source);
    let fm: Record<string, unknown> = {};
    fm = fmInfo.exists ? parseFrontmatterYaml(fmInfo.frontmatter) : {};
    if (opts.mode === "preview") fm = sanitizeFrontMatter(fm, doc);
    if(typeof fm["vlook-query"] === "string") fm["vlook-query"] = normalizeVlookQuery(fm["vlook-query"]);
    const body = source.slice(fmInfo.contentStart);

    // 渲染到离屏容器（标记为原始渲染，插件自身的后处理会跳过）
    const host = doc.createElement("div");
    host.className = "vlook-offscreen markdown-rendered";
    doc.body.append(host);
    host.classList.add("vlook-offscreen-render");
    const comp = new Component();
    comp.load();
    let mathErrors = 0;
    try {
        plugin.rawRenderDepth++;
        // 宿主 MathJax 全局保留 \label 登记，阅读视图渲染过的公式再次渲染会报 multiply defined
        (doc.defaultView as (Window & { MathJax?: { texReset?: () => void } }) | null)?.MathJax?.texReset?.();
        try {
            opts.onProgress?.("渲染正文"); await paint(doc);
            await MarkdownRenderer.render(app, `${RAW_MARKER}\n${insertTyporaBlankParagraphs(body)}`, host, file.path, comp);
            await renderZenUmlFallback(host,comp,undefined,body);
            opts.onProgress?.("渲染图表与公式"); await paint(doc);
            mathErrors=await settle(host,body);
        } finally {
            plugin.rawRenderDepth--;
        }

        // 图片地址：补回 #魔法 / URL 参数；导出时改为相对路径
        const dir = opts.outDir ?? (file.parent?.path === "/" ? "" : (file.parent?.path ?? ""));
        normalizeLiteralInline(host);
        // Obsidian 原生的音视频嵌入还原为 Typora 的 <img>（由 VLOOK 运行时转换为音视频，导出时路径可改为相对路径）
        host.querySelectorAll<HTMLElement>(".internal-embed.media-embed").forEach(span => {
            const media = span.querySelector<HTMLMediaElement>("audio, video");
            if (!media) return;
            const img = doc.createElement("img");
            img.setAttribute("src", media.getAttribute("src") || "");
            const alt = span.getAttribute("alt");
            if (alt && alt !== span.getAttribute("src")) img.alt = alt;
            span.replaceWith(img);
        });
        resolveBrokenEmbeds(host, app, file.path, true);
        restoreImages(host, body, (raw, current) => {
            if (/^[a-z][\w+.-]*:/i.test(raw)) return null; // 网络图片保持原样
            if (opts.mode !== "export") return current;
            const target = app.metadataCache.getFirstLinkpathDest(decodeUrlPart(raw.split(/[?#]/)[0]), file.path);
            return target ? encodeResourcePath(relativePath(dir, target.path)) : current;
        });

        if (opts.mode === "export") appUrlsToRelative(host, (app.vault.adapter as any).basePath ?? "", dir);

        if (opts.query) {
            const query = vlookQueryParams(String(fm["vlook-query"] || ""));
            for (const [key, value] of new URLSearchParams(opts.query)) query.set(key, value);
            fm["vlook-query"] = query.toString();
        }
        // These defaults already govern destructive preprocessing. Persist them so the
        // iframe runtime cannot reinterpret the result using another palette's defaults.
        const inherited = new Query(themeQuery);
        const structuralQuery = vlookQueryParams(String(fm["vlook-query"] || ""));
        let inheritedStructure = false;
        for (const key of ["unpub", "xmd"]) {
            const value = inherited.get(key);
            if (!structuralQuery.has(key) && value !== null) {
                structuralQuery.set(key, value); inheritedStructure = true;
            }
        }
        if (inheritedStructure) fm["vlook-query"] = structuralQuery.toString();
        removeRenderingMarker(host);
        toTyporaDom(host, plugin.settings.genericSubSup);
        if (opts.mode === "preview") preservePreviewLinks(host);
        if ((opts.mode === "export" || opts.print) && new Query(themeQuery, String(fm["vlook-query"]||"")).get("unpub") !== "off") {
            removeUnpublished(host, fm["vlook-unpub"]);
            const ids = new Set(Array.from(host.querySelectorAll("h1,h2,h3,h4,h5,h6"), h => h.id));
            host.querySelectorAll<HTMLAnchorElement>(".md-toc-inner").forEach(a => {
                let id = (a.getAttribute("href") || "").slice(1);
                try { id = decodeURIComponent(id); } catch { /* 原 ID */ }
                if (!ids.has(id)) a.closest(".md-toc-item")?.remove();
            });
        }
        if (opts.mode === "export") {
            const query = new Query(themeQuery, String(fm["vlook-query"] || ""));
            rewriteExportLinks(host, app, file.path, query.get("xmd") || "html", opts.outDir);
        }
        if (opts.print) {
            const query = vlookQueryParams(String(fm["vlook-query"] || ""));
            for (const [key, value] of Object.entries({print:"on", cs:"light", fold:"off", fillw:"on"})) query.set(key, value);
            fm["vlook-query"] = query.toString();
        }

        if (!plugin.settings.headerAutoNum) {
            fm["vlook-header-autonum"] = [1,2,3,4,5,6].map(level => `h${level}{{#none#}}`).join(",");
        }
        const theme = resolveThemeName(opts.theme, resolveThemeName(fm["vlook-theme"], resolveThemeName(plugin.resolvePreviewTheme())));
        opts.onProgress?.("加载主题"); await paint(doc);
        const themeCss = (await plugin.readThemeCss(theme, "export")) ?? (theme !== "blue" ? await plugin.readThemeCss("blue", "export") : null) ?? (await plugin.readThemeCss("joint", "export")) ?? "";
        const rawTitle = fm["title"];
        const title = rawTitle === undefined || rawTitle === null || rawTitle === "" || typeof rawTitle === "object" ? file.basename : String(rawTitle);
        const picked = opts.mode === "export" ? [...new Set([theme, ...(opts.themes ?? [])])].filter(name => THEMES.includes(name)) : [];
        const themes = picked.length > 1 ? await exportThemesHtml(plugin, theme, picked) : "";

        if(fm['vlook-doc-lib']!==undefined){
            const query=new Query(themeQuery,String(fm['vlook-query']||''));
            fm['vlook-doc-lib']=rewriteLibraryLinks(fm['vlook-doc-lib'],app,file.path,opts.mode,query.get('xmd')||'html',host.ownerDocument,opts.outDir);
        }
        const metas = Object.entries(fm)
            .filter(([, v]) => v !== null && typeof v !== "object" || Array.isArray(v))
            .map(([k, v]) => `<meta name="${esc(k)}" content="${esc(Array.isArray(v) ? v.join(k === "vlook-unpub" || k === "vlook-header-dup" ? ";" : ", ") : String(v))}">`)
            .join("\n");
        opts.onProgress?.("内嵌图片");
        const inlineImages = opts.mode === "export" ? await collectInlineImages(app, host, dir, (done, total) => opts.onProgress?.(`内嵌图片 ${done}/${total}`)) : {};
        const mathCss=await collectMathStyles(host);
        const writeHtml = host.innerHTML;

        const lang = currentLang().startsWith("zh") ? "zh-CN" : "en";
        let html = `<!doctype html>
    <html lang="${lang}"${opts.mode === "export" && plugin.settings.exportPrintPanel === "original" ? ' data-print-panel="original"' : ""}${opts.mode === "export" && plugin.settings.exportLoadingPage === "original" ? ' data-loading-page="original"' : ""}>
    <head>
    <meta charset="UTF-8">${opts.mode === "preview" ? `<script>window.addEventListener("error",function(e){if(parent!==window)parent.console.error("[VLOOK preview]",e.message,e.error&&e.error.stack)});window.addEventListener("unhandledrejection",function(e){if(parent!==window)parent.console.error("[VLOOK preview promise]",String(e.reason))});</script>` : ""}
    <meta name="viewport" content="width=device-width initial-scale=1">${opts.mode === "preview" ? `
    <meta name="vlook-document-url" content="app://obsidian.md/__vlook_vault__/${esc(encodeURIComponent(file.path).replace(/%2F/g, "/"))}">` : ""}
    <title>${esc(title)}</title>${opts.mode === "preview" ? `
    <script>try{localStorage.setItem("color-scheme","${!opts.print && doc.body.classList.contains("theme-dark") ? "dark" : "light"}")}catch(e){}</script>` : ""}
    <style type="text/css" id="style-base">${typoraBase}</style>
    <style type="text/css" id="style-theme_css">${themeCss}</style>${themes?`
    ${themes}`:''}
    <style id="vlook-diagram-interactions">${diagramInteractions}</style>
    <style id="vlook-image-compat">${imageCompat}</style>
    <style id="vlook-print-compat">${printCompat}</style>
    ${opts.mode === "export" ? `<style id="vlook-fade">${FADE_CSS}</style><script>(${installExportFade.toString()})(document);</script>` : ""}
    ${opts.mode === "export" ? `<style id="vlook-branding">${brandingCss(plugin.settings.exportBranding, plugin.settings.exportBrandingText)}</style>` : ""}
    <style id="vlook-user-typography">${typographyCss(plugin.settings.textFont,plugin.settings.textSize)}</style>
    ${mathCss?`<style id="vlook-mathjax-styles">${mathCss}</style>`:''}
    ${metas}
    ${plugin.settings.remoteFonts ? runtime : runtime.replace(/<link rel="(?:preconnect|dns-prefetch)"[^>]*>\s*|<meta name="vlook-fs"[^>]*>\s*/g, "")}
    </head>
    <body class="typora-export">
    <div style="display:none">${ICON_SPRITE}</div>
    <div class="typora-export-content">
    <div id="write" class="">${writeHtml}</div>
    </div>
    ${host.querySelector('input[data-vlook-indeterminate="1"]')?`<script>(${restoreExportTaskStates.toString()})(document);</script>`:''}
    ${Object.keys(inlineImages).length?`<script>(${installInlineImages.toString()})(${JSON.stringify(inlineImages).replace(/</g,'\\u003c')});</script>`:''}
    <script>(function(){var m=new MutationObserver(function(){var d=document.querySelector('details.v-print-tip');if(d){d.open=true;m.disconnect()}});m.observe(document.documentElement,{childList:true,subtree:true})})()</script>
    <script>(${installPopupGuard.toString()})()</script>
    ${themes?`<script>(${installExportThemeSwitcher.toString()})(document);</script>`:''}
    ${host.querySelector('img[src*="#gif"]')?`<script>(${installExportGifControls.toString()})(document);</script>`:''}
    ${host.querySelector('img[src*="controls=mini"],.v-audio-mini-control')?`<script>(${enhanceExportMiniAudio.toString()})(document);</script>`:''}
    </body>
    </html>`;
        if (opts.mode === "preview") html = lockScripts(html);
        return { html, title, mathErrors };
    } finally {
        host.remove();
        comp.unload();
    }
}
