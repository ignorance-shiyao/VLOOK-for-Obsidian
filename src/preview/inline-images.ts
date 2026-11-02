// 导出时把文档引用的图片转为 webp 并内嵌：HTML 单文件即可分享，不依赖相对路径

import { Platform, TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { decodeUrlPart } from "../core/url";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon" };
const CONVERTIBLE = /^(png|jpe?g|bmp)$/i;
const SIDE_TOKENS = ["~", "_", "-"];

const pureOf = (url: string): string => url.split("#")[0].split("?")[0];
const join = (dir: string, rel: string): string => {
    const out = dir ? dir.split("/") : [];
    for (const part of rel.split("/")) { if (part === "..") out.pop(); else if (part && part !== ".") out.push(part); }
    return out.join("/");
};
const splitExt = (path: string): [string, string] => { const at = path.lastIndexOf("."); return at < 0 ? [path, ""] : [path.slice(0, at), path.slice(at)]; };

/** 一张图可能被运行时换成的其它文件：深色图、@2x/@3x、显式 darksrc / srcset 参数 */
function variants(rel: string, query: string): string[] {
    const [stem, ext] = splitExt(rel), dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
    const out = new Set<string>([rel]);
    for (const hd of ["", "@2x", "@3x"]) {
        out.add(stem + hd + ext);
        for (const token of SIDE_TOKENS) out.add(stem + token + "dark" + hd + ext);
    }
    for (const part of query.replace(/^\?/, "").split("&")) {
        const equal = part.indexOf("="); if (equal < 0) continue;
        const key = decodeUrlPart(part.slice(0, equal)), value = decodeUrlPart(part.slice(equal + 1));
        if (key !== "darksrc" && key !== "srcset" && key !== "darksrcset") continue;
        for (const candidate of value.split(",")) {
            const name = candidate.trim().split(/\s+/)[0].replace(/@[23]x$/, "");
            if (!name || name === "invert" || /^data:/i.test(name)) continue;
            out.add(name.includes("/") ? join(dir.replace(/\/$/, ""), name) : dir + name);
        }
    }
    return [...out];
}

const MAX_PIXELS = 12_000_000;
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

async function toDataUri(app: App, file: TFile): Promise<string | null> {
    const ext = file.extension.toLowerCase(), mime = MIME[ext];
    if (!mime) return null;
    const bytes = await app.vault.readBinary(file);
    let blob = new Blob([bytes], { type: mime });
    // 手机上解码/重编码大图容易卡死界面，直接保留原图
    if (CONVERTIBLE.test(ext) && !Platform.isMobile) {
        try {
            const bitmap = await createImageBitmap(blob);
            if (bitmap.width * bitmap.height > MAX_PIXELS) { bitmap.close?.(); throw new Error("too large"); }
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
            const webp = await canvas.convertToBlob({ type: "image/webp", quality: 0.88 });
            bitmap.close?.();
            if (webp.type === "image/webp" && webp.size < blob.size) blob = webp;
        } catch { /* 转换失败时保留原图 */ }
    }
    const buffer = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
    return `data:${blob.type};base64,${btoa(binary)}`;
}

/** 收集导出 DOM 里引用的图片（含各种变体），返回 相对路径 → data URI */
export async function collectInlineImages(app: App, root: HTMLElement, dir: string, onProgress?: (done: number, total: number) => void): Promise<Record<string, string>> {
    const wanted = new Set<string>();
    root.querySelectorAll<HTMLImageElement>("img").forEach(img => {
        const src = img.getAttribute("src") || "";
        if (!src || /^[a-z][\w+.-]*:/i.test(src)) return;
        const q = src.indexOf("?"), h = src.indexOf("#");
        const query = q < 0 ? "" : src.slice(q, h > q ? h : undefined);
        for (const rel of variants(decodeUrlPart(pureOf(src)), query)) wanted.add(rel);
        for (const part of (img.getAttribute("srcset") || "").split(",")) {
            const name = part.trim().split(/\s+/)[0];
            if (name && !/^[a-z][\w+.-]*:/i.test(name)) wanted.add(decodeUrlPart(pureOf(name)));
        }
    });
    const map: Record<string, string> = {};
    let done = 0;
    for (const rel of wanted) {
        onProgress?.(++done, wanted.size);
        await tick();
        const file = app.vault.getAbstractFileByPath(normalizePath(join(dir, rel)));
        if (!(file instanceof TFile)) continue;
        const uri = await toDataUri(app, file).catch(() => null);
        if (uri) map[rel] = uri;
    }
    return map;
}

/** 注入页面：把指向相对路径的 img src / srcset 换成内嵌数据；运行时改写 src 时也同步替换。须自包含（toString 注入）。 */
export function installInlineImages(map: Record<string, string>): void {
    const key = (u: string): string => { u = u.split("#")[0].split("?")[0]; try { return decodeURIComponent(u); } catch { return u; } };
    const fix = (img: Element): void => {
        const src = img.getAttribute("src");
        if (src && !/^data:/i.test(src)) { const d = map[key(src)]; if (d) img.setAttribute("src", d); }
        const set = img.getAttribute("srcset");
        if (set && !/data:/i.test(set)) {
            const next = set.split(",").map(part => {
                const bits = part.trim().split(/\s+/), d = map[key(bits[0])];
                return d ? d + (bits[1] ? " " + bits[1] : "") : part.trim();
            }).join(",");
            if (next !== set) img.setAttribute("srcset", next);
        }
    };
    const all = (): void => document.querySelectorAll("img").forEach(fix);
    new MutationObserver(records => records.forEach(r => { if (r.target instanceof Element && r.target.tagName === "IMG") fix(r.target); }))
        .observe(document, { attributes: true, attributeFilter: ["src", "srcset"], subtree: true });
    if (document.readyState === "complete") setTimeout(all, 0);
    else window.addEventListener("load", () => setTimeout(all, 0));
}
