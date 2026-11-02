// 主题快捷切换：状态栏按钮 + 功能区按钮 + 命令（选择 / 下一个）
// 直接切换插件内配色，无需独立 Obsidian 主题包。

import { FuzzySuggestModal, MarkdownView, Menu, setIcon } from "obsidian";
import { keepReadingPosition } from "./core/reading-position";
import type VlookPlugin from "./main";
import { THEMES, resolveStyleName, themeLabel } from "./core/themes";
import { fade, observeSchemeFade } from "./core/fade";

const label = (t: string) => `VLOOK ${themeLabel(t)}`;

export class ThemeSwitcher {
    private statusEl: HTMLElement | null = null;

    constructor(readonly plugin: VlookPlugin) {}

    current(): string | null {
        const style = resolveStyleName(this.plugin.settings.style);
        return style === "none" ? null : style;
    }

    /** 所有打开的笔记视图，切换外观时统一保持阅读位置 */
    private views(): MarkdownView[] {
        const views: MarkdownView[] = [];
        this.plugin.app?.workspace?.iterateAllLeaves?.(leaf => { if (leaf.view instanceof MarkdownView) views.push(leaf.view); });
        return views;
    }

    async apply(t: string) {
        fade(activeDocument);
        this.plugin.settings.style = t;
        await keepReadingPosition(this.views(), () => this.plugin.saveSettings());
        this.update();
    }

    async next() {
        const cur = this.current();
        const i = cur ? THEMES.indexOf(cur) : -1;
        await this.apply(THEMES[(i + 1) % THEMES.length]);
    }

    toggleDark(doc: Document = this.plugin.app.workspace.activeLeaf?.view.containerEl.ownerDocument ?? document) {
        const app = this.plugin.app as any;
        const dark = doc.body.classList.contains("theme-dark");
        return keepReadingPosition(this.views(), () => app.changeTheme?.(dark ? "moonstone" : "obsidian"));
    }

    openMenu(ev: MouseEvent) {
        const doc = ev.view?.document ?? (ev.currentTarget as Element | null)?.ownerDocument ?? document;
        const menu = new Menu();
        const cur = this.current();
        for (const t of THEMES) {
            menu.addItem(item => item
                .setTitle(label(t))
                .setChecked(t === cur)
                .onClick(() => this.apply(t)));
        }
        menu.addSeparator();
        menu.addItem(item => item
            .setTitle(doc.body.classList.contains("theme-dark") ? "切换到浅色模式" : "切换到深色模式")
            .setIcon("sun-moon")
            .onClick(() => this.toggleDark(doc)));
        menu.showAtMouseEvent(ev);
    }

    register() {
        const p = this.plugin;
        p.addCommand({
            id: "switch-theme", name: "切换 VLOOK 主题",
            callback: () => new ThemeModal(this).open(),
        });
        p.addCommand({ id: "next-theme", name: "下一个 VLOOK 主题", callback: () => this.next() });
        p.addCommand({ id: "toggle-dark", name: "切换浅色 / 深色模式", callback: () => this.toggleDark() });
        p.registerEvent(p.app.workspace.on("css-change", () => this.update()));
        p.register(observeSchemeFade(activeDocument));
        p.app.workspace.onLayoutReady(() => this.update());
    }

    update() {
        if (!this.statusEl) return;
        const cur = this.current();
        this.statusEl.empty();
        setIcon(this.statusEl.createSpan({ cls: "status-bar-item-icon" }), "palette");
        this.statusEl.createSpan({ text: cur ? label(cur) : "VLOOK 未启用配色" });
    }
}

class ThemeModal extends FuzzySuggestModal<string> {
    constructor(private switcher: ThemeSwitcher) {
        super(switcher.plugin.app);
        this.setPlaceholder("选择 VLOOK 主题");
    }
    getItems() { return THEMES; }
    getItemText(t: string) { return label(t); }
    onChooseItem(t: string) { void this.switcher.apply(t); }
}
