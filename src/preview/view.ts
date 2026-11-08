// 「VLOOK 预览」视图：在 iframe 中运行官方 VLOOK 插件，提供与导出 HTML 一致的完整交互
// （导航中心、目录/插图/表格索引、搜索、幻灯片、宁静视图、聚光灯、激光笔、画中画、内容助手、页签组…）

import { ItemView, TFile, WorkspaceLeaf, debounce, normalizePath, type ViewStateResult } from "obsidian";
import type VlookPlugin from "../main";
import { buildVlookHtml } from "./document";
import { previewLinkHref, resolveVaultLink } from "./links";
import { exportHtml } from "./export";
import { canWritePdfDirectly, writeFrameAsPdf } from "./pdf";
import { notify } from "../notify";

export const VLOOK_PREVIEW_VIEW = "vlook-preview";

export class VlookPreviewView extends ItemView {
    private filePath: string | null = null;
    private frame: HTMLIFrameElement | null = null;
    private seq = 0;
    private closed = false;
    private printMode = false;
    private pdfOut: string | null = null;
    private frameCleanups: (() => void)[] = [];

    constructor(leaf: WorkspaceLeaf, private plugin: VlookPlugin) {
        super(leaf);
    }

    getViewType() { return VLOOK_PREVIEW_VIEW; }
    getIcon() { return "book-open"; }
    getDisplayText() {
        const f = this.getFile();
        return f ? `${this.printMode ? "VLOOK PDF" : "VLOOK"} · ${f.basename}` : "VLOOK 预览";
    }

    getFile(): TFile | null {
        const f = this.filePath ? this.app.vault.getAbstractFileByPath(this.filePath) : null;
        return f instanceof TFile ? f : null;
    }

    async setState(state: { file?: string; print?: boolean; out?: string | null }, result: ViewStateResult) {
        if (state?.file) this.filePath = state.file;
        this.printMode = !!state?.print;
        this.pdfOut = state?.out ?? null;
        await super.setState(state, result);
        // 启动恢复布局时不能等待渲染完成（渲染依赖布局就绪，会互相等待导致卡在「加载工作区」）
        this.app.workspace.onLayoutReady(() => void this.refresh());
    }

    getState() {
        return { file: this.filePath ?? undefined, print:this.printMode, out:this.pdfOut };
    }

    async onOpen() {
        this.closed = false;
        this.contentEl.addClass("vlook-preview-container");
        // 状态栏悬浮在工作区底部时，缩短 iframe，避免其内的幻灯片控件被遮挡。
        const doc = this.contentEl.ownerDocument;
        let status: HTMLElement | null = null;
        const updateBottomSpace = () => {
            const nextStatus = this.contentEl.ownerDocument.querySelector<HTMLElement>(".status-bar");
            if (nextStatus !== status) {
                if (status) observer.unobserve(status);
                status = nextStatus;
                if (status) observer.observe(status);
            }
            const area = this.contentEl.getBoundingClientRect();
            const bar = status?.getBoundingClientRect();
            const overlaps = bar && bar.width > 0 && bar.height > 0
                && bar.left < area.right && bar.right > area.left
                && bar.top < area.bottom && bar.bottom > area.top;
            const space = overlaps ? Math.ceil(Math.min(area.height, area.bottom - bar.top)) + 8 : 0;
            this.contentEl.style.setProperty("--vlook-preview-bottom-space", `${space}px`);
        };
        const Observer = doc.defaultView?.ResizeObserver ?? ResizeObserver;
        const observer = new Observer(updateBottomSpace);
        observer.observe(this.contentEl);
        this.register(() => observer.disconnect());
        this.registerEvent(this.app.workspace.on("layout-change", updateBottomSpace));
        this.registerEvent(this.app.workspace.on("css-change", updateBottomSpace));
        updateBottomSpace();
        this.addAction("download", "导出为 VLOOK HTML", () => {
            const f = this.getFile();
            if (f) void exportHtml(this.plugin, f).catch(error => notify(`导出失败：${(error as Error).message || String(error)}`));
        });
        this.addAction("printer", "发布为 PDF（原版打印选项）", () => {
            const file = this.getFile();
            if (file) void this.plugin.openPreview(file, {print:true});
        });
        this.addAction("refresh-cw", "刷新", () => this.refresh());
        const onChange = debounce((file: TFile) => {
            if (file.path === this.filePath) void this.refresh();
        }, 800, true);
        this.registerEvent(this.app.vault.on("modify", f => f instanceof TFile && onChange(f)));
        // Obsidian 切换明暗模式或主题时，预览跟随
        const look = () => `${this.contentEl.ownerDocument.body.classList.contains("theme-dark")}|${this.plugin.resolvePreviewTheme()}|${this.plugin.settings.textFont}|${this.plugin.settings.pageWidth}|${this.plugin.settings.textSize}`;
        let last = look();
        this.registerEvent(this.app.workspace.on("css-change", () => {
            const now = look();
            if (now !== last) { last = now; void this.refresh(); }
        }));
        this.registerEvent(this.app.vault.on("rename", (f, old) => {
            if (old === this.filePath) { this.filePath = f.path; void this.refresh(); }
        }));
    }

    async refresh() {
        if (this.closed) return;
        const my = ++this.seq;
        const file = this.getFile();
        if (!file) {
            this.disposeFrame();
            this.frame = null;
            this.contentEl.setText("未找到文档");
            return;
        }
        try {
            const { html } = await buildVlookHtml(this.plugin, file, { mode: "preview", print:this.printMode, document:this.contentEl.ownerDocument });
            if (my !== this.seq) return;
            // 保留滚动位置
            let scroll = 0;
            try { scroll = this.frame?.contentWindow?.scrollY ?? 0; } catch { /* 忽略 */ }
            const frame = this.contentEl.ownerDocument.createElement("iframe");
            frame.className = "vlook-preview-frame";
            frame.srcdoc = html;
            const onLoad = () => {
                if (this.frame !== frame) return;
                try {
                    const w = frame.contentWindow!;
                    const timer = w.setTimeout(() => { if (this.frame === frame) w.scrollTo(0, scroll); }, 600);
                    this.frameCleanups.push(() => w.clearTimeout(timer));
                    this.bindLinks(frame);
                    if (this.printMode) this.bindPdfWriter(frame);
                } catch { /* 忽略 */ }
            };
            frame.addEventListener("load", onLoad);
            this.disposeFrame();
            this.frameCleanups.push(() => frame.removeEventListener("load", onLoad));
            this.contentEl.empty();
            this.contentEl.append(frame);
            this.frame = frame;
            (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
        } catch (error) {
            if (my !== this.seq) return;
            this.disposeFrame();
            this.frame = null;
            this.contentEl.setText(`VLOOK 预览失败：${(error as Error).message || String(error)}`);
        }
    }

    /** 打印视图确认后由 Chromium 直接写入 PDF，不经系统打印对话框。 */
    private bindPdfWriter(frame: HTMLIFrameElement) {
        const w = frame.contentWindow as unknown as { __vlookPrintToPdf?: () => Promise<boolean> } | null;
        if (!w || !canWritePdfDirectly(frame.ownerDocument.defaultView!)) return;
        w.__vlookPrintToPdf = async () => {
            const file = this.getFile();
            if (!file || this.frame !== frame) return false;
            const dir = file.parent && file.parent.path !== "/" ? `${file.parent.path}/` : "";
            const out = this.pdfOut ?? normalizePath(`${dir}${file.basename}.pdf`);
            const notice = notify("VLOOK：正在写入 PDF…", 0);
            try {
                await writeFrameAsPdf(this.app, frame, out);
                notify(`VLOOK：已导出到 ${out}`);
            } finally { notice.hide(); }
            return true;
        };
    }

    private disposeFrame() {
        for (const cleanup of this.frameCleanups.splice(0)) cleanup();
    }

    async onClose() {
        this.closed = true;
        this.seq++;
        this.disposeFrame();
        this.frame = null;
    }

    /** iframe 内点击外部链接 / Obsidian 内部链接 */
    private bindLinks(frame: HTMLIFrameElement, sourcePath = this.filePath ?? "", nested = false) {
        const doc = frame.contentDocument;
        if (!doc) return;
        let disposed = false;
        const onClick = (ev: MouseEvent) => {
            if (disposed) return;
            const target = ev.target as Element;
            if (!target?.closest) return;
            if (!this.printMode && target.closest(".v-print")) {
                ev.preventDefault(); ev.stopImmediatePropagation();
                const file = this.getFile();
                if (file) void this.plugin.openPreview(file, {print:true});
                return;
            }
            if (this.printMode && target.closest(".v-print-tip .cancel")) {
                ev.preventDefault(); ev.stopImmediatePropagation(); this.leaf.detach(); return;
            }
            const a = target.closest("a");
            if (!a) return;
            const href = previewLinkHref(a);
            if (/^https?:/i.test(href)) {
                ev.preventDefault(); ev.stopImmediatePropagation();
                this.contentEl.ownerDocument.defaultView?.open(href, "_blank", "noopener,noreferrer");
            } else if (!href.startsWith("#")) {
                const raw = href;
                if (!nested && (a.target === "vdl" || /[?&]target=vdl(?:[&#]|$)/i.test(raw))) return;
                const resolved = resolveVaultLink(this.app, raw, sourcePath);
                if (!resolved) return;
                ev.preventDefault(); ev.stopImmediatePropagation();
                void this.app.workspace.openLinkText(resolved.file.path + resolved.hash, "", ev.ctrlKey || ev.metaKey);
            }
        };
        doc.addEventListener("click", onClick, true);
        // 原版文库使用 iframe.src 加载 HTML；vault 内文档须先构建为 VLOOK HTML。
        const versions = new WeakMap<HTMLIFrameElement, number>();
        const hydrate = (child: HTMLIFrameElement) => {
            if (disposed || !doc.contains(child)) return;
            const version = (versions.get(child) || 0) + 1;
            versions.set(child, version);
            const raw = child.getAttribute("src") || "";
            // srcdoc 优先于 src；换成远程文档时也必须撤销旧本地渲染。
            child.removeAttribute("srcdoc");
            const resolved = resolveVaultLink(this.app, raw, sourcePath);
            if (!resolved) return;
            const query = new URLSearchParams(resolved.query);
            query.set("pagemode", "mini");
            query.set("vdl", "off"); // 文库内不再自动加载下一层文库，避免相互引用递归。
            void buildVlookHtml(this.plugin, resolved.file, {mode:"preview", query:query.toString(),document:this.contentEl.ownerDocument}).then(({html}) => {
                if (disposed || !child.isConnected || versions.get(child) !== version) return;
                child.addEventListener("load", () => {
                    if (disposed || versions.get(child) !== version || !doc.contains(child)) return;
                    this.bindLinks(child, resolved.file.path, true);
                    if (resolved.hash) child.contentWindow?.setTimeout(() => {
                        if (disposed || versions.get(child) !== version || !doc.contains(child)) return;
                        let id = resolved.hash.slice(1);
                        try { id = decodeURIComponent(id); } catch { /* 原锚点 */ }
                        child.contentDocument?.getElementById(id)?.scrollIntoView();
                    }, 600);
                }, {once:true});
                child.srcdoc = html;
            }).catch(error => { if (!disposed) notify(`文库加载失败：${(error as Error).message || String(error)}`); });
        };
        const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
        const observer = new Observer(records => {
            if (disposed) return;
            for (const record of records) {
                if (record.type === "attributes") {
                    if ((record.target as Element).matches('iframe[name="vlook-doc-lib"]')) hydrate(record.target as HTMLIFrameElement);
                }
                else for (const node of Array.from(record.addedNodes)) {
                    if (node.nodeType !== 1) continue;
                    const el = node as Element;
                    if (el.matches('iframe[name="vlook-doc-lib"]')) hydrate(el as HTMLIFrameElement);
                    el.querySelectorAll<HTMLIFrameElement>('iframe[name="vlook-doc-lib"]').forEach(hydrate);
                }
            }
        });
        observer.observe(doc, {subtree:true, childList:true, attributes:true, attributeFilter:["src"]});
        doc.querySelectorAll<HTMLIFrameElement>('iframe[name="vlook-doc-lib"]').forEach(hydrate);
        this.frameCleanups.push(() => {disposed = true; observer.disconnect(); doc.removeEventListener("click", onClick, true);});
    }
}
