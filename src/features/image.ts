import type { App } from "obsidian";
import { readResource } from "../core/resource";
import {isLiteralContent} from '../core/literal-dom';
import { figureSources } from '../core/figure-source';
import { renderedSourceImages, matchRenderedImages } from '../core/rendered-image-source';
import { isVideoEmbed } from '../core/video-embed';
// 图片「#魔法」与 URL 参数：#icon #logo #card #200w #invert ... / ?darksrc= ?srcset= ?fill=
// 大部分版式由主题 CSS 通过 img[src*=#xxx] 实现；这里负责：
// 1) Obsidian 解析本地图片时会丢掉 # 与 ? 后缀，从源码找回并补回到 src 上
// 2) 插图（独占段落的图片）生成题注容器
// 3) darksrc / srcset / fill / card / gif 等需要脚本的特性
// 移植自 vlook.js「插图增强类」

import { decodeUrlPart, resourceQuery } from "../core/url";
import { processMedia, AUDIO_EXT, VIDEO_EXT } from "./media";
import { h, newEl } from '../core/dom';
import type { RenderCtx } from "../core/context";
import { buildMediaCaption } from "./caption";


const hashOf = (raw: string) => { const i = raw.indexOf("#"); return i >= 0 ? raw.slice(i) : ""; };

/** 将 @2x / 文件名形式的 srcset 转为 <img srcset> 格式 */
function transSrcSet(src: string, srcset: string): string {
    const pure = src.split(/[?#]/)[0];
    const path = pure.slice(0, pure.lastIndexOf("/") + 1);
    if (/^@2x(,@3x)?$/.test(srcset)) {
        const dot = pure.lastIndexOf(".");
        const name = pure.slice(0, dot), ext = pure.slice(dot);
        return srcset.replace("@2x", `${name}@2x${ext} 2x`).replace("@3x", `${name}@3x${ext} 3x`);
    }
    return srcset.split(",").map(s => {
        const m = s.match(/^(.*)@([23]x)$/);
        const file = m ? m[1] : s;
        return (file.includes("/") ? file : path + file) + (m ? ` ${m[2]}` : "");
    }).join(",");
}

function resolveSibling(img: HTMLImageElement, name: string): string {
    // 本地图片：相对当前 img 的真实地址替换文件名
    const cur = img.src.split(/[?#]/)[0];
    if (/^[a-z]+:/i.test(name)) return name;
    try { return new URL(name, cur).href; } catch { return name; }
}

function setupDarkSrc(img: HTMLImageElement, q: Record<string, string>) {
    const dark = q["darksrc"];
    if (!dark) return;
    if (dark === "invert") {
        img.dataset.darksrc = "invert";
        return;
    }
    img.dataset.darksrc = "alter";
    const light = img.src;
    let darkName: string;
    const base = light.split(/[?#]/)[0];
    // 保留路径编码，避免文件名中的 %23/%3F 变成 URL 分隔符。
    const file = base.slice(base.lastIndexOf("/") + 1);
    if ("~_-".includes(dark)) {
        const dot = file.lastIndexOf(".");
        darkName = file.slice(0, dot) + dark + "dark" + file.slice(dot);
    } else darkName = dark;
    img.dataset.srcLight = light;
    const resolved = resolveSibling(img, darkName);
    img.dataset.srcDark = resolved.includes("#") ? resolved : resolved + hashOf(light);
}

/** 根据 Obsidian 当前明暗模式切换图片 */
export function applyColorScheme(root: ParentNode = activeDocument): void {
    root.querySelectorAll<HTMLImageElement>("img[data-darksrc]").forEach(img => {
        if(isLiteralContent(img,{allowKbd:true}))return;
        const dark = img.ownerDocument.body.classList.contains("theme-dark");
        if (img.dataset.darksrc === "invert") {
            img.classList.toggle("v-img-invert-dark", dark && !img.dataset.imgFill);
        } else if (img.dataset.darksrc === "alter") {
            const want = dark ? img.dataset.srcDark : img.dataset.srcLight;
            // 没有对应图片集时删除旧 srcset，避免浏览器继续选择另一模式的资源。
            const set = dark ? img.dataset.srcsetDark : img.dataset.srcsetLight;
            if (want) setImageSource(img, want, set || null);
        }
    });
}

const svgReplacementHandlers = new WeakMap<HTMLImageElement, (svg: SVGSVGElement) => void>();
const svgFillRequests = new WeakMap<HTMLImageElement, object>();
async function fillSvg(img: HTMLImageElement, fill: string, root: HTMLElement, ctx: RenderCtx) {
    const owner = img.ownerDocument, src = img.getAttribute("src"), request = {};
    const controller = new AbortController();
    svgFillRequests.set(img, request);
    const current = () => svgFillRequests.get(img) === request && root.contains(img) && img.ownerDocument === owner && img.getAttribute("src") === src && img.dataset.imgFill === fill;
    ctx.registerCleanup?.(() => {
        controller.abort();
        if (svgFillRequests.get(img) === request) svgFillRequests.delete(img);
    });
    try {
        const res = await readResource(img.src, controller.signal);
        if (!res.ok || !current()) return;
        const text = await res.text();
        if (!current()) return;
        const Parser = owner.defaultView?.DOMParser || DOMParser;
        const doc = new Parser().parseFromString(text, "image/svg+xml");
        const svg = doc.documentElement as unknown as SVGSVGElement;
        if (svg.tagName.toLowerCase() !== "svg") return;
        for (const a of Array.from(img.attributes)) if (a.name !== "src") svg.setAttribute(a.name === "class" ? "class" : `data-img-${a.name}`, a.value);
        svg.setAttribute("data-inject-url", img.getAttribute("src") || "");
        svg.setAttribute("data-img-fill", fill);
        const color = fill === "text" ? "currentColor" : `var(--ac-${fill.toLowerCase()})`;
        svg.querySelectorAll<SVGElement>("path,rect,ellipse,polygon,circle").forEach(p => p.style.setProperty('fill', color));
        if (!svg.getAttribute("width") && img.width) svg.setAttribute("width", String(img.width));
        if (current()) {
            const imported = owner.importNode(svg, true);
            const focused = owner.activeElement === img;
            if (!imported.hasAttribute("role")) imported.setAttribute("role", "img");
            if (img.alt && !imported.hasAttribute("aria-label") && !imported.hasAttribute("aria-labelledby")) imported.setAttribute("aria-label", img.alt);
            img.replaceWith(imported);
            svgReplacementHandlers.get(img)?.(imported);
            svgReplacementHandlers.delete(img);
            if (focused && imported.hasAttribute("tabindex")) imported.focus({preventScroll:true});
        }
    } catch { /* 跨域、卸载等失败时保持原图 */ }
    finally { if (svgFillRequests.get(img) === request) svgFillRequests.delete(img); }
}

function setupFill(img: HTMLImageElement, q: Record<string, string>, raw: string, root: HTMLElement, ctx: RenderCtx) {
    const fill = q["fill"];
    if (!fill) return;
    img.dataset.imgFill = fill;
    if (!/\.svg($|[?#])/i.test(raw)) img.classList.add("enabled");
    else if (img.closest("kbd") === null) void fillSvg(img, fill, root, ctx);
}

function setupPostcard(img: HTMLImageElement, hash: string, root: HTMLElement, ctx: RenderCtx) {
    if (!hash.includes("card")) return;
    const quote = img.closest("blockquote") as HTMLElement | null;
    if (quote) { quote.classList.add("vlook-card-quote"); }
    const title = img.getAttribute("title");
    let alt = img.getAttribute("alt") || "";
    const dual = hash.includes("#cardd"), border = hash.includes("#border"), fitMax = hash.includes("#fitmax");
    img.removeAttribute("title");
    const card = h("article", "v-post-card v-backdrop-blurs");
    if (title) card.append(Object.assign(h("header", "v-card-title"), { textContent: title }));
    const body = img.closest("p")?.nextElementSibling;
    if (body?.tagName === "BLOCKQUOTE" && root.contains(body)) {
        const content = h("section", "v-card-text");
        content.append(...Array.from(body.childNodes));
        card.append(content);
        body.remove();
    } else if (alt) card.append(Object.assign(h("section", "v-card-text"), { textContent: alt }));
    img.after(card);
    card.id = `${img.id}-postcard`;
    let disposers: Array<() => void> = [];
    const dispose = () => { disposers.forEach(fn => fn()); disposers = []; };
    const bind = (visual: HTMLImageElement | SVGSVGElement) => {
        dispose();
        bindPostcardVisual(visual, card, {dual, border, fitMax, inQuote: !!quote, observe: !!ctx.registerCleanup}, {...ctx, registerCleanup: fn => disposers.push(fn)});
    };
    bind(img);
    svgReplacementHandlers.set(img, bind);
    ctx.registerCleanup?.(() => {
        if (svgReplacementHandlers.get(img) === bind) svgReplacementHandlers.delete(img);
        dispose();
    });
}

function bindPostcardVisual(img: HTMLImageElement | SVGSVGElement, card: HTMLElement, options: {dual:boolean;border:boolean;fitMax:boolean;inQuote:boolean;observe:boolean}, ctx: RenderCtx) {
    const {dual, border, fitMax, inQuote: quote} = options;
    const events = (node: HTMLElement | SVGSVGElement) => node as HTMLElement;
    const imageWidth = () => "offsetWidth" in img ? img.offsetWidth : img.getBoundingClientRect().width;
    const imageBottom = () => {
        if ("offsetTop" in img) return img.offsetTop + img.offsetHeight;
        const parent = card.offsetParent || img.parentElement;
        return img.getBoundingClientRect().bottom - (parent?.getBoundingClientRect().top || 0) + (parent?.scrollTop || 0);
    };
    if (dual) {
        const size = () => { card.style.setProperty('width', quote ? "100%" : img.ownerDocument.defaultView?.getComputedStyle(img).width || ""); };
        events(img).addEventListener("load", size);
        size(); // 缓存图片可能已经触发 load，不能只等待下一次事件。
        const Observer = img.ownerDocument.defaultView?.ResizeObserver;
        const observer = Observer && options.observe ? new Observer(size) : null;
        observer?.observe(img);
        ctx.registerCleanup?.(() => { events(img).removeEventListener("load", size); observer?.disconnect(); });
    } else {
        const trigger: HTMLElement | SVGSVGElement = img.closest<HTMLAnchorElement>("a[href]") || img;
        const tabindex = trigger.getAttribute("tabindex"), details = trigger.getAttribute("aria-details");
        if (trigger === img && tabindex === null) img.tabIndex = 0;
        const ownedDetails = details ? `${details} ${card.id}` : card.id;
        trigger.setAttribute("aria-details", ownedDetails);
        const inside = (node: Node | null) => !!node && (node === trigger || node === img || card.contains(node));
        const show = () => {
            if (card.classList.contains("vlook-card-open")) return;
            img.classList.add("vlook-img-dim");
            const w = fitMax ? (img.parentElement?.offsetWidth ?? imageWidth()) : imageWidth();
            card.style.setProperty('width', `${w}px`);
            card.classList.add("vlook-card-open");
            card.style.setProperty('top', `${imageBottom() - card.offsetHeight + (border ? 1 : 0)}px`);
        };
        const close = () => { img.classList.remove("vlook-img-dim"); card.classList.remove("vlook-card-open"); };
        const leave = (ev: MouseEvent) => {
            if (inside(ev.relatedTarget as Node | null) || inside(img.ownerDocument.activeElement)) return;
            close();
        };
        const blur = (ev: FocusEvent) => { if (!inside(ev.relatedTarget as Node | null)) close(); };
        const escape = (ev: KeyboardEvent) => {
            if (ev.key !== "Escape" || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey || ev.isComposing) return;
            ev.preventDefault(); ev.stopPropagation();
            if (card.contains(img.ownerDocument.activeElement)) trigger.focus({preventScroll:true});
            close();
        };
        events(img).addEventListener("mouseenter", show);
        events(img).addEventListener("mouseleave", leave);
        card.addEventListener("mouseleave", leave);
        events(trigger).addEventListener("focusin", show);
        card.addEventListener("focusin", show);
        events(trigger).addEventListener("focusout", blur);
        card.addEventListener("focusout", blur);
        events(trigger).addEventListener("keydown", escape);
        card.addEventListener("keydown", escape);
        ctx.registerCleanup?.(() => {
            events(img).removeEventListener("mouseenter", show); events(img).removeEventListener("mouseleave", leave);
            card.removeEventListener("mouseleave", leave);
            events(trigger).removeEventListener("focusin", show); card.removeEventListener("focusin", show);
            events(trigger).removeEventListener("focusout", blur); card.removeEventListener("focusout", blur);
            events(trigger).removeEventListener("keydown", escape); card.removeEventListener("keydown", escape);
            if (trigger === img && tabindex === null && trigger.getAttribute("tabindex") === "0") trigger.removeAttribute("tabindex");
            if (trigger.getAttribute("aria-details") === ownedDetails) {
                if (details === null) trigger.removeAttribute("aria-details"); else trigger.setAttribute("aria-details", details);
            }
            img.classList.remove("vlook-img-dim");
        });
    }
}

type GifState = { cover: string; srcset: string | null; playing: boolean; render: () => void };
const gifStates = new WeakMap<HTMLImageElement, GifState>();
function setImageSource(img: HTMLImageElement, src: string, srcset: string | null) {
    const state = gifStates.get(img);
    if (state) { state.cover = src; state.srcset = srcset; state.render(); }
    else {
        if (img.src !== src) img.src = src;
        if (srcset) img.srcset = srcset; else img.removeAttribute("srcset");
    }
}

function setupGif(img: HTMLImageElement, hash: string, ctx: RenderCtx) {
    if (!hash.includes("#gif")) return;
    const state: GifState = {cover: img.src, srcset: img.getAttribute("srcset"), playing: false, render: () => {}};
    const linked = !!img.closest('a[href],button');
    const previous = new Map(["role", "tabindex", "aria-pressed"].map(name => [name, img.getAttribute(name)]));
    const changedTabindex = !linked && previous.get("tabindex") !== "0";
    state.render = () => {
        // 保留资源查询及魔法片段，不让播放破坏版式或访问参数。
        const src = state.playing ? state.cover.replace(/\.[^./?#]+(?=[?#]|$)/, ".gif") : state.cover;
        if (img.src !== src) img.src = src;
        if (state.playing || !state.srcset) img.removeAttribute("srcset"); else img.srcset = state.srcset;
        img.dataset.playing = String(state.playing);
        if (!linked) img.setAttribute("aria-pressed", String(state.playing));
    };
    const toggle = () => { state.playing = !state.playing; state.render(); };
    const key = (event: KeyboardEvent) => {
        if (linked || !["Enter", " "].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return;
        event.preventDefault(); event.stopPropagation(); if (!event.repeat) toggle();
    };
    gifStates.set(img, state);
    img.classList.add("v-gif-cover", "vlook-clickable");
    if (!linked) {img.setAttribute("role", "button"); if (changedTabindex) img.tabIndex = 0;}
    img.addEventListener("click", toggle); img.addEventListener("keydown", key);
    state.render();
    ctx.registerCleanup?.(() => {
        img.removeEventListener("click", toggle); img.removeEventListener("keydown", key);
        if (gifStates.get(img) === state) gifStates.delete(img);
        img.classList.remove("vlook-clickable");
        for (const [name, value] of previous) {
            if (linked || (name === "tabindex" && !changedTabindex)) continue;
            const owned = name === "role" ? "button" : name === "tabindex" ? "0" : String(state.playing);
            if (img.getAttribute(name) !== owned) continue;
            if (value === null) img.removeAttribute(name); else img.setAttribute(name, value);
        }
    });
}

let imgCount = 0;

/**
 * 带 ?参数 的本地图片（如 pic/a.png?darksrc=~#logo）会被 Obsidian 当作附件嵌入并解析失败，
 * 显示为「找不到…」。按去掉参数后的路径找到文件，替换为 <img>，参数保留在 src 上供后续处理
 */
/** missingAsImage：导出时把找不到的本地图片还原为原地址的 <img>，交给 VLOOK 运行时标记失效（与 Typora 一致）。 */
export function resolveBrokenEmbeds(root: HTMLElement, app: App | null, sourcePath: string, missingAsImage = false): void {
    if (!app?.metadataCache) return;
    // 阅读视图为 span；实时预览为 div，且是编辑器组件的根节点，只能替换其内容。
    const place = (embed: HTMLElement, img: HTMLImageElement) => {
        if (embed.tagName !== "DIV") { embed.replaceWith(img); return; }
        embed.dataset.vlookResolved = "1";
        embed.classList.remove("file-embed", "mod-empty-attachment", "mod-empty");
        embed.classList.add("image-embed", "is-loaded");
        embed.replaceChildren(img);
    };
    root.querySelectorAll<HTMLElement>(".internal-embed[src]:not([data-vlook-resolved])").forEach(span => {
        if(isLiteralContent(span,{allowKbd:true}))return;
        const src = span.getAttribute("src") || "";
        const path = src.split(/[?#]/)[0];
        if ((path === src && !span.dataset.vlookLiteral) || !/\.(png|jpe?g|gif|svg|webp|bmp|avif|mp3|m4a|ogg|wav|mp4|webm|ogv|mov|m4v)$/i.test(path)) return;
        const file = app.metadataCache.getFirstLinkpathDest(decodeUrlPart(path), sourcePath);
        if (!file && !missingAsImage) return;
        const img = newEl(span.ownerDocument, "img");
        if (!file) {
            img.setAttribute("src", src);
            const alt = span.getAttribute("alt");
            if (alt && alt !== src && alt !== path) img.alt = alt;
            place(span, img);
            return;
        }
        img.setAttribute('loading',span.getAttribute('loading')||'lazy');
        img.setAttribute('decoding',span.getAttribute('decoding')||'async');
        const res: string = app.vault.getResourcePath(file);
        const rest = src.slice(path.length);
        img.setAttribute("src", rest.startsWith("?") && res.includes("?") ? res + "&" + rest.slice(1) : res + rest);
        const alt = span.getAttribute("alt");
        if (alt && alt !== path) img.alt = alt;
        const title=span.getAttribute('title');if(title)img.title=title;
        place(span, img);
    });
    // 引用式 Markdown 图片由 Obsidian 直接生成相对 img，而非 internal-embed。
    root.querySelectorAll<HTMLImageElement>("img[src]").forEach(img => {
        if(isLiteralContent(img,{allowKbd:true}))return;
        const src=img.getAttribute("src")||"";
        if(!src||/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(src))return;
        const path=src.split(/[?#]/)[0];
        const file=app.metadataCache.getFirstLinkpathDest(decodeUrlPart(path),sourcePath);
        if(!file)return;
        const res:string=app.vault.getResourcePath(file),rest=src.slice(path.length);
        img.setAttribute("src",rest.startsWith("?")&&res.includes("?")?res+"&"+rest.slice(1):res+rest);
    });
}

export function processImages(root: HTMLElement, ctx: RenderCtx): void {
    // 播放器转换前按媒体源码顺序还原各自的 title，不能从整块中取第一个题注。
    if(ctx.block){
        const isMedia=(src:string)=>{const path=decodeUrlPart(src.split(/[?#]/)[0]);return AUDIO_EXT.test(path)||VIDEO_EXT.test(path);};
        const refs=renderedSourceImages(ctx.block.text,root.ownerDocument,ctx.index?.text).filter(ref=>isMedia(ref.raw));
        const targets=Array.from(root.querySelectorAll<HTMLElement>('img[src],span.internal-embed[src]')).filter(el=>!isLiteralContent(el)&&isMedia(el.getAttribute('src')||''));
        const paired=matchRenderedImages(targets,refs);
        targets.forEach((target,n)=>{
            const ref=paired[n];if(!ref)return;
            if(ref.title&&!target.getAttribute('title'))target.setAttribute('title',ref.title);
            if(ref.alt&&!target.getAttribute('alt'))target.setAttribute('alt',ref.alt);
        });
    }
    resolveBrokenEmbeds(root, ctx.app, ctx.sourcePath);
    processMedia(root, ctx);
    // 按实际 DOM 顺序对齐每种媒体的源码编号，不让同一段的多个播放器共用编号。
    const mediaPositions={audio:0,video:0};
    const mediaContext=(type:'audio'|'video',target:HTMLElement):RenderCtx=>{
        const info=ctx.block?.mediaCaptions?.filter(item=>item.mediaType===type)[mediaPositions[type]++];
        if(info){target.dataset.vlookContentKind='media';target.dataset.vlookContentIndex=String(ctx.block!.mediaCaptions!.indexOf(info));}
        return info&&ctx.block?{...ctx,block:{...ctx.block,caption:info}}:ctx;
    };
    root.querySelectorAll<HTMLElement>('span.internal-embed[src],audio,video,iframe[src]').forEach(media=>{
        if(isLiteralContent(media))return;
        if(media.closest('.v-caption')||media.id.startsWith('vk-id-mini-audio'))return;
        if(media.matches('span.internal-embed')){
            const src=(media.getAttribute('src')||'').split(/[?#]/)[0];
            const type=AUDIO_EXT.test(src)?'audio':VIDEO_EXT.test(src)?'video':undefined;
            if(!type)return;
            const alt=media.getAttribute('alt');
            if(!alt||alt===src||alt===media.getAttribute('src'))media.removeAttribute('alt');
            const context=mediaContext(type,media);
            if(ctx.settings.captions)buildMediaCaption(media,'media',context,type);
            return;
        }
        if(media.tagName==='IFRAME'&&!isVideoEmbed(media.getAttribute('src')||''))return;
        const type=media.tagName==='AUDIO'?'audio':'video';
        if(media.dataset.caption)media.setAttribute('alt',media.dataset.caption);
        const context=mediaContext(type,media);
        if(ctx.settings.captions)buildMediaCaption(media,'media',context,type);
    });
    // 转成播放器的引用已不在下面的 img 集合中，不能继续占用图片序号。
    const refs = ctx.block ? renderedSourceImages(ctx.block.text,root.ownerDocument,ctx.index?.text).filter(ref => {
        let path = ref.raw.split(/[?#]/)[0];
        try { path = decodeURIComponent(path); } catch { /* 保持原路径 */ }
        return !AUDIO_EXT.test(path) && !VIDEO_EXT.test(path);
    }) : [];
    const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img")).filter(i => !i.closest(".v-post-card") && !isLiteralContent(i,{allowKbd:true}));
    const paired=matchRenderedImages(imgs,refs);
    const figureRefs=ctx.block?figureSources(ctx.block,ctx.index?.text||ctx.block.text):[];
    imgs.forEach((img, i) => {
        if(!img.hasAttribute('loading'))img.setAttribute('loading','lazy');
        if(!img.hasAttribute('decoding'))img.setAttribute('decoding','async');
        if (img.dataset.vlook) return;
        img.dataset.vlook = "1";
        let raw = img.getAttribute("src") || "";
        const ref = paired[i];
        // 找回被 Obsidian 去掉的 # 与 ? 后缀
        if (ref) {
            const q = ref.raw.split("#")[0].split("?")[1] || "";
            const hs = hashOf(ref.raw);
            let s = raw;
            if (q && !s.includes(q)) {
                const [base, frag] = [s.split("#")[0], s.includes("#") ? "#" + s.split("#").slice(1).join("#") : ""];
                s = base + (base.includes("?") ? "&" : "?") + q + frag;
            }
            if (hs && !s.includes(hs)) s = s.split("#")[0] + hs;
            if (s !== raw) img.setAttribute("src", s);
            raw = ref.raw;
            if (ref.title && !img.title) img.title = ref.title;
            if (ref.alt && !img.alt) img.alt = ref.alt;
        }
        // Obsidian 嵌入的 alt 默认为文件名，视为无题注
        if (img.alt && /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i.test(img.alt)) img.alt = "";
        const q = resourceQuery(raw), hash = hashOf(raw);
        img.id = img.id || `vk-id-img${imgCount++}`;
        if (img.hasAttribute("srcset")) img.dataset.srcsetLight = img.getAttribute("srcset")!;
        setupDarkSrc(img, q);
        if (q["srcset"]) {
            const set = transSrcSet(img.src, q["srcset"]);
            img.dataset.srcsetLight = set;
            img.srcset = set;
        }
        if (q["darksrcset"] && img.dataset.srcDark) {
            img.dataset.srcsetDark = transSrcSet(img.dataset.srcDark, q["darksrcset"]);
        }
        setupPostcard(img, hash, root, ctx);
        setupGif(img, hash, ctx);
        setupFill(img, q, raw, root, ctx);
        // 非插图：图标、Logo、明信片、按钮内的图片
        const container = img.parentElement!;
        const notFigure = /#(icon|card|logo)/.test(hash) || container.tagName === "KBD" || !!img.closest("kbd, a kbd");
        if (notFigure) {
            if (hash.includes("#icon") && container.childNodes.length > 1 && !container.classList.contains("v-icon")) {
                const span = h("span", "v-icon");
                img.replaceWith(span);
                span.append(img);
            }
            return;
        }
        const figureIndex=ref?figureRefs.findIndex(item=>item.pos===ref.pos):-1;
        if(figureIndex>=0){img.dataset.vlookContentKind='figure';img.dataset.vlookContentIndex=String(figureIndex);}
        const info=figureIndex>=0?ctx.block?.figureCaptions?.[figureIndex]:undefined;
        const figureCtx=info&&ctx.block?{...ctx,block:{...ctx.block,caption:info}}:ctx;
        if (ctx.settings.captions) buildMediaCaption(img, "figure", figureCtx);
    });
    applyColorScheme(root);
}
