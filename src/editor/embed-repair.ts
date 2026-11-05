import { ViewPlugin, type EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type VlookPlugin from "../main";
import { resolveBrokenEmbeds } from "../features/image";

// 原生实时预览把 `![](a.svg?darksrc=invert#icon)` 的整段地址当作文件名查找而显示“找不到”；
// 与阅读视图一致，去掉 URL 参数后定位文件并还原为图片。
export function embedRepairExtension(plugin: VlookPlugin) {
    return ViewPlugin.fromClass(class {
        private observer: MutationObserver;
        private queued = false;
        constructor(private view: EditorView) {
            const win = view.dom.ownerDocument.defaultView ?? window;
            this.observer = new win.MutationObserver(() => this.queue());
            this.observer.observe(view.contentDOM, { subtree: true, childList: true });
            this.queue();
        }
        queue() {
            if (this.queued) return;
            this.queued = true;
            (this.view.dom.ownerDocument.defaultView ?? window).setTimeout(() => {
                this.queued = false;
                if (!plugin.settings.livePreview) return;
                const path = this.view.state.field(editorInfoField, false)?.file?.path;
                if (path) resolveBrokenEmbeds(this.view.contentDOM, plugin.app, path);
                // 丢弃修复自身引起的变更记录，避免与编辑器重绘互相触发而空转
                this.observer.takeRecords();
            }, 120);
        }
        destroy() { this.observer.disconnect(); }
    });
}
