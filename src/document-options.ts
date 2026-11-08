// 文档级调校参数（fw、gray 等）：阅读与编辑共用同一内容容器，按文档首次读取到的参数应用一次，之后以手动切换为准。
import { MarkdownView } from "obsidian";
import type VlookPlugin from "./main";
import { Query, readCssVar } from "./core/context";
import { currentLang } from "./core/i18n";
import { grayModeActive } from "./core/gray-mode";
import { parseFrontmatterYaml } from "./core/frontmatter";
import { sanitizeWelcome, welcomeMode } from "./core/welcome";

const CLASSES = ["vlook-reading-wide", "vlook-reading-gray", "vlook-debug", "vlook-fm-tolerant"];

export class DocumentOptions {
    private applied = new WeakMap<HTMLElement, string>();
    private opened = new WeakMap<HTMLElement, string>();
    private welcomes = new Set<HTMLElement>();
    private footers = new WeakMap<HTMLElement, string>();
    private footerWatch = new WeakMap<HTMLElement, MutationObserver>();
    constructor(private plugin: VlookPlugin) {}

    private apply(view: MarkdownView) {
        const file = view.file, host = view.contentEl;
        if (!file || !host?.isConnected) return;
        // 宿主 YAML 解析失败（如值含链接）时缓存没有属性，改用插件自己的解析
        const yaml = view.data?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
        const cached = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        const own = !cached && yaml ? parseFrontmatterYaml(yaml) : undefined;
        const fm = cached ?? own;
        const query = new Query(readCssVar("--vlook-query", host), typeof fm?.["vlook-query"] === "string" ? fm["vlook-query"] : undefined);
        const lang = String(fm?.lang ?? fm?.language ?? currentLang());
        const today = new Date();
        const gray = grayModeActive(query.get("gray"), fm?.["vlook-gray-mode"], today, lang);
        const fw = query.get("fw");
        const sts = query.get("sts") === "hide", debug = query.get("debug") === "on";
        host.dataset.vlookSts = sts ? "hide" : "show";
        this.ensureFooter(host, fm?.["vlook-footer"]);
        const key = [file.path, fw, gray, debug, today.toDateString()].join("|");
        if (this.applied.get(host) === key) return;
        this.applied.set(host, key);
        host.classList.toggle("vlook-reading-wide", fw === "full");
        host.classList.toggle("vlook-reading-gray", gray);
        host.classList.toggle("vlook-debug", debug);
        host.classList.toggle("vlook-fm-tolerant", !!own && Object.keys(own).some(k => k.startsWith("vlook-")));
        // 欢迎页只在文档打开时显示一次
        if (this.opened.get(host) !== file.path) {
            this.opened.set(host, file.path);
            this.showWelcome(host, fm?.["vlook-welcome"], query.get("ws"));
        }
    }

    /** 文档页脚（vlook-footer）：阅读视图正文末尾，内容经过与欢迎页相同的净化。 */
    private ensureFooter(host: HTMLElement, value: unknown) {
        const html = typeof value === "string" ? value.trim() : "";
        this.footers.set(host, html);
        if (!this.footerWatch.has(host)) {
            const win = host.win as Window & typeof globalThis;
            const watch: MutationObserver = new win.MutationObserver(() => { this.placeFooter(host); watch.takeRecords(); });
            watch.observe(host, { childList: true, subtree: true, attributes: false });
            this.footerWatch.set(host, watch);
            this.plugin.register(() => watch.disconnect());
        }
        this.placeFooter(host);
    }

    private placeFooter(host: HTMLElement) {
        const sizer = host.querySelector<HTMLElement>(".markdown-preview-sizer");
        if (!sizer) return;
        const html = this.footers.get(host) ?? "";
        const known = sizer.querySelector<HTMLElement>(":scope > .vlook-footer");
        if (!html) { known?.remove(); return; }
        if (known && known.dataset.source === html && sizer.lastElementChild === known) return;
        known?.remove();
        const footer = host.ownerDocument.createElement("div");
        footer.className = "vlook-footer";
        footer.dataset.source = html;
        footer.append(sanitizeWelcome(html, host.ownerDocument));
        sizer.append(footer);
    }

    private showWelcome(host: HTMLElement, custom: unknown, option: string | null) {
        host.querySelectorAll(":scope > .vlook-welcome").forEach(el => el.remove());
        const mode = welcomeMode(option);
        if (mode.kind === "off" || typeof custom !== "string" || !custom.trim()) return;
        const doc = host.ownerDocument;
        const overlay = doc.createElement("div");
        overlay.className = "vlook-welcome";
        const body = doc.createElement("div");
        body.className = "vlook-welcome-body";
        body.append(sanitizeWelcome(custom, doc));
        overlay.append(body);
        const close = () => {
            if (overlay.classList.contains("vlook-welcome-closing")) return;
            overlay.classList.add("vlook-welcome-closing");
            const done = () => { overlay.remove(); this.welcomes.delete(overlay); };
            overlay.addEventListener("animationend", done, { once: true });
            host.win.setTimeout(done, 400);
        };
        const button = doc.createElement("button");
        button.className = "vlook-welcome-close";
        button.textContent = "×";
        button.setAttribute("aria-label", "关闭");
        button.addEventListener("click", close);
        overlay.append(button);
        host.append(overlay);
        this.welcomes.add(overlay);
        if (mode.kind === "auto") host.win.setTimeout(close, 1200);
        else if (mode.kind === "delay") host.win.setTimeout(close, mode.seconds * 1000);
    }

    applyAll() {
        const ws = this.plugin.app.workspace;
        ws.getLeavesOfType("markdown").forEach(leaf => {
            try { this.apply(leaf.view as MarkdownView); } catch (error) { console.error("[VLOOK] document options", error); }
        });
        // 状态栏属于窗口：跟随当前文档的 sts
        const active = ws.getActiveViewOfType(MarkdownView);
        if (active?.contentEl) active.contentEl.ownerDocument.body.classList.toggle("vlook-status-hidden", active.contentEl.dataset.vlookSts === "hide");
    }

    register() {
        const p = this.plugin, ws = p.app.workspace;
        const refresh = () => this.applyAll();
        p.registerEvent(ws.on("file-open", refresh));
        p.registerEvent(ws.on("active-leaf-change", refresh));
        p.registerEvent(ws.on("layout-change", refresh));
        p.registerEvent(p.app.metadataCache.on("changed", refresh));
        p.registerEvent(p.app.metadataCache.on("resolved", refresh));
        p.registerEvent(ws.on("css-change", () => { this.applied = new WeakMap(); refresh(); }));
        ws.onLayoutReady(refresh);
        p.register(() => { activeDocument.body.classList.remove("vlook-status-hidden"); this.welcomes.forEach(el => el.remove()); this.welcomes.clear(); });
        p.register(() => ws.getLeavesOfType("markdown").forEach(leaf => (leaf.view as MarkdownView).contentEl.classList.remove(...CLASSES)));
    }
}
