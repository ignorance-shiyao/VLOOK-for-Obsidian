// 直接写入 PDF：系统打印对话框（macOS Quartz）会把部分页面文字轮廓化，导致中文无法搜索；
// 改用 Chromium printToPDF（与 Obsidian 自带导出相同的 Skia 管线），保留文字层。

import { Platform, type App } from "obsidian";

type Remote = { BrowserWindow: new (options: object) => any };

function electronRemote(win: Window): Remote | null {
    if (!Platform.isDesktopApp) return null;
    try {
        const remote = (win as any).require?.("electron")?.remote;
        return remote?.BrowserWindow ? remote : null;
    } catch { return null; }
}

export function canWritePdfDirectly(win: Window) { return !!electronRemote(win); }

/** 快照以 file:// 页面加载，Obsidian 的 app:// 资源地址在其中不可用；换成对应的本地 file:// 路径。 */
export function appUrlsToFileUrls(html: string): string {
    return html
        .replace(/app:\/\/[0-9a-f]{16,}\/(?=[A-Za-z]:[\\/])/gi, "file:///")
        .replace(/app:\/\/[0-9a-f]{16,}(?=\/)/gi, "file://");
}

/** 打印选项生效后的页面快照：去掉脚本，并把只存在于 CSSOM 的规则（如 MathJax 动态规则）写回文本。 */
export function snapshotPrintDocument(doc: Document): string {
    const clone = doc.documentElement.cloneNode(true) as HTMLElement;
    const sources = Array.from(doc.querySelectorAll("style"));
    const targets = Array.from(clone.querySelectorAll("style"));
    sources.forEach((style, index) => {
        try {
            const rules = style.sheet?.cssRules;
            if (rules && targets[index]) targets[index].textContent = Array.from(rules, rule => rule.cssText).join("\n");
        } catch { /* 保留原文本 */ }
    });
    const adopted = (doc as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
    const head = clone.querySelector("head") ?? clone;
    for (const sheet of adopted) {
        const style = doc.createElement("style");
        style.textContent = Array.from(sheet.cssRules, rule => rule.cssText).join("\n");
        head.append(style);
    }
    const canvases = Array.from(doc.querySelectorAll("canvas"));
    Array.from(clone.querySelectorAll("canvas")).forEach((canvas, index) => {
        try {
            const img = doc.createElement("img");
            img.src = canvases[index].toDataURL();
            img.style.cssText = canvases[index].style.cssText;
            img.width = canvases[index].width; img.height = canvases[index].height;
            canvas.replaceWith(img);
        } catch { /* 跨源画布无法读取，保留空白 */ }
    });
    const inputs = Array.from(doc.querySelectorAll("input"));
    Array.from(clone.querySelectorAll("input")).forEach((input, index) => {
        if (inputs[index]?.checked) input.setAttribute("checked", "");
        else input.removeAttribute("checked");
    });
    clone.querySelectorAll("script, iframe[name='vlook-doc-lib']").forEach(node => node.remove());
    if (!clone.querySelector("base")) {
        const base = doc.createElement("base");
        base.href = doc.baseURI;
        head.prepend(base);
    }
    return appUrlsToFileUrls("<!doctype html>\n" + clone.outerHTML);
}

export async function writeFrameAsPdf(app: App, frame: HTMLIFrameElement, out: string): Promise<void> {
    const host = frame.ownerDocument.defaultView!;
    const remote = electronRemote(host);
    const doc = frame.contentDocument;
    if (!remote || !doc) throw new Error("当前环境不支持直接写入 PDF");
    const req = (host as any).require;
    const fs = req("fs"), os = req("os"), path = req("path");
    const temp = path.join(os.tmpdir(), `vlook-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    await fs.promises.writeFile(temp, snapshotPrintDocument(doc), "utf8");
    const win = new remote.BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { offscreen: false } });
    try {
        await win.loadFile(temp);
        await win.webContents.executeJavaScript(`Promise.race([
            Promise.all([document.fonts.ready, ...Array.from(document.images, i => i.decode().catch(() => {}))]),
            new Promise(r => setTimeout(r, 15000))
        ]).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`);
        const data: Uint8Array = await win.webContents.printToPDF({ pageSize: "A4", printBackground: true, preferCSSPageSize: true });
        const bytes = new Uint8Array(data);
        await app.vault.adapter.writeBinary(out, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    } finally {
        win.destroy();
        fs.promises.unlink(temp).catch(() => {});
    }
}
