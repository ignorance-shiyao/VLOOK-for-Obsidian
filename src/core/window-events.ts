import type { Plugin } from "obsidian";

/** 在主窗口和每个独立窗口的文档上执行 listen，窗口关闭或插件卸载时撤销。 */
export function registerEachDocument(plugin: Plugin, listen: (doc: Document) => () => void): void {
    const unlisten = new Map<Document, () => void>([[document, listen(document)]]);
    plugin.registerEvent(plugin.app.workspace.on("window-open", (_window, win) => { if (!unlisten.has(win.document)) unlisten.set(win.document, listen(win.document)); }));
    plugin.registerEvent(plugin.app.workspace.on("window-close", (_window, win) => { unlisten.get(win.document)?.(); unlisten.delete(win.document); }));
    plugin.register(() => { for (const off of unlisten.values()) off(); unlisten.clear(); });
}

/** 按窗口注册文档事件，替代只覆盖主窗口的 registerDomEvent(document, …)。 */
export function registerDocumentEvent<K extends keyof DocumentEventMap>(plugin: Plugin, type: K, handler: (event: DocumentEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void {
    registerEachDocument(plugin, doc => {
        doc.addEventListener(type, handler, options);
        return () => doc.removeEventListener(type, handler, options);
    });
}
