import { App, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinition, SettingDefinitionItem } from "obsidian";
import type VlookPlugin from "./main";
import type { VlookSettings } from "./core/context";
import { THEMES, themeLabel } from "./core/themes";

type ColorKey = "quoteDefault" | "tagDefault" | "badgeDefault" | "coatingDefault";
interface SwatchOptions { none?: boolean; solid?: boolean; extra?: [string, string, string][] }
const SWATCH_BASE: [string, string, string][] = [["t1", "主题色 1", "#356FD8"], ["t2", "主题色 2", "#4D81EF"], ["rd", "红", "#E5484D"], ["og", "橙", "#F5871F"], ["ye", "黄", "#F5C518"], ["gn", "绿", "#30A46C"], ["cy", "青", "#12A594"], ["bu", "蓝", "#3E63DD"], ["pu", "紫", "#8E4EC6"], ["pk", "粉", "#E93D82"], ["gy", "灰", "#8B8D98"], ["bk", "黑", "#1C1C1F"]];

/** 默认色号的色块选择器：旧版设置页与声明式设置页共用。 */
function renderSwatches(setting: Setting, key: ColorKey, opts: SwatchOptions, s: VlookSettings, save: () => Promise<void>): void {
    const wrap = setting.controlEl.createDiv({ cls: "vlook-swatches" });
    const current = wrap.createSpan({ cls: "vlook-swatch-name" });
    const group = wrap.createDiv({ cls: "vlook-swatch-group" });
    const items: { value: string; label: string; css: string }[] = [];
    if (opts.none) items.push({ value: "", label: "不着色", css: "" });
    for (const [code, label, hex] of [...(opts.extra ?? []), ...SWATCH_BASE]) {
        const base = code.replace(/-a$/, "");
        items.push({ value: opts.solid ? code + "!" : code, label: `${code[0].toUpperCase() + code.slice(1)}${opts.solid ? "!" : ""} · ${label}`, css: code.endsWith("-a") ? `color-mix(in srgb, var(--ac-${base}, ${hex}) 40%, white)` : `var(--ac-${code}, ${hex})` });
    }
    if (!items.some(i => i.value === s[key])) items.push({ value: s[key], label: `${s[key]} · 自定义`, css: `var(--ac-${s[key].replace(/!$/, "")}, #999)` });
    const buttons = items.map(item => {
        const button = group.createEl("button", { cls: "vlook-swatch" + (item.css ? "" : " is-none"), attr: { type: "button", "aria-label": item.label, title: item.label } });
        if (item.css) button.style.setProperty('background', item.css);
        button.onclick = () => { s[key] = item.value; refresh(); void save(); };
        return button;
    });
    const refresh = () => {
        items.forEach((item, i) => buttons[i].classList.toggle("is-selected", item.value === s[key]));
        current.setText(items.find(i => i.value === s[key])?.label ?? "");
    };
    refresh();
}

export class VlookSettingTab extends PluginSettingTab {
    constructor(app: App, private plugin: VlookPlugin) {
        super(app, plugin);
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        const s = this.plugin.settings;
        const save = async () => this.plugin.saveSettings();
        const themes = Object.fromEntries(THEMES.map(t => [t, themeLabel(t)]));
        const toggle = (name: string, desc: string, key: string): SettingDefinition => ({ name, desc, control: { type: "toggle", key, defaultValue: false } });
        const swatch = (name: string, desc: string, key: ColorKey, opts: SwatchOptions = {}): SettingDefinition =>
            ({ name, desc, searchable: true, render: setting => renderSwatches(setting, key, opts, s, save) });
        return [
            { type: "group", heading: "样式", items: [
                { name: "VLOOK 样式", control: { type: "dropdown", key: "style", options: themes } },
                { name: "预览 / 导出主题", desc: "用于「VLOOK 预览」「导出 HTML」。可在文档 YAML 中用 vlook-theme 单独指定。",
                    control: { type: "dropdown", key: "previewTheme", defaultValue: "auto", options: { auto: "跟随插件配色", ...themes } } },
                { name: "主题文件夹", render: setting => {
                    setting.addExtraButton(b => b.setIcon("folder-open").setTooltip("打开主题文件夹").onClick(() => void this.plugin.openThemeFolder()))
                        .addExtraButton(b => b.setIcon("cloud-download").setTooltip("获取更多主题").onClick(() => { void this.plugin.refreshRemoteThemes().then(() => this.update()); }));
                } },
                { name: "主题目录", control: { type: "text", key: "themeFolder", placeholder: this.plugin.themeStore.builtinDir, defaultValue: "" } },
                { name: "重新加载主题", render: setting => {
                    setting.addExtraButton(b => b.setIcon("refresh-cw").setTooltip("重新加载主题").onClick(() => { void this.plugin.reloadThemes().then(() => this.update()); }));
                } },
            ] },
            { type: "group", heading: "可选功能", items: [
                { name: "在线字体", desc: "从 openfonts.pages.dev 加载主题字体", control: { type: "toggle", key: "remoteFonts", defaultValue: false } },
            ] },
            { type: "group", heading: "导出", items: [
                { name: "PDF 面板配色", control: { type: "dropdown", key: "exportPrintPanel", defaultValue: "theme", options: { theme: "跟随主题", original: "原版配色" } } },
                { name: "加载页样式", control: { type: "dropdown", key: "exportLoadingPage", defaultValue: "theme", options: { theme: "跟随主题", original: "原版样式" } } },
                { name: "显示署名", control: { type: "toggle", key: "exportBranding", defaultValue: false } },
                { name: "署名内容", control: { type: "text", key: "exportBrandingText", placeholder: "Styled & Enhanced by VLOOK™", defaultValue: "" } },
            ] },
            { type: "group", heading: "语法与排版", items: [
                toggle("文件类型图标", "", "fileTypeIcons"),
                toggle("识别 ~下标~ 与 ^上标^", "与 Typora 一致；色号 _~Rd~_、页签组 _^tab^_、注音 _^zhù^_ 在关闭时仍然可用。", "genericSubSup"),
                toggle("标题自动编号", "使用主题配套格式，或文档 YAML 的 vlook-header-autonum。", "headerAutoNum"),
                toggle("题注与自动编号", "*==题注==* 置于表格 / 代码块 / 公式前；图片使用 ![题注](url \"第二题注\")。", "captions"),
                toggle("页签组", "_^tab^_ 独占一行，将其后连续的表格、插图、代码块、引用块等合并为页签组。", "tabGroups"),
                toggle("分栏", "在引用块 / 列表前添加 1~4 条 --- 实现 2~5 栏。", "columns"),
                toggle("封面与封底", "文档首个块为 ###### 标题时作为封面；最后一个块为 # 标题时作为封底；仅有 YAML 时生成小封面。", "cover"),
                toggle("编辑模式渲染行内语法", "在实时预览中渲染标签、多级标签、色号、进度条等。", "livePreview"),
            ] },
            { type: "group", heading: "默认色号", items: [
                swatch("引用块默认着色", "未指定色号的普通引用块自动使用的颜色，带 ! 为实心色块。", "quoteDefault", { none: true, solid: true }),
                swatch("标签默认色号", "未指定色号的标签（tag）使用的颜色。", "tagDefault", { extra: [["t2-a", "主题色 2 · 淡", "#4D81EF"]] }),
                swatch("多级标签默认色号", "未指定色号的多级标签（badge）使用的颜色。", "badgeDefault"),
                swatch("刮刮卡默认色号", "刮刮卡（coating）涂层的颜色。", "coatingDefault"),
            ] },
        ];
    }

    setControlValue(key: string, value: unknown): void | Promise<void> {
        const s = this.plugin.settings as unknown as Record<string, unknown>;
        s[key] = typeof value === "string" && (key === "themeFolder" || key === "exportBrandingText") ? value.trim() : value;
        if (key === "themeFolder") return this.plugin.saveData(this.plugin.settings);
        return this.plugin.saveSettings().then(() => { if (key === "fileTypeIcons") this.plugin.applyFileTypeIcons(); });
    }

    display(): void {
        const { containerEl } = this;
        const s = this.plugin.settings;
        const save = async () => this.plugin.saveSettings();
        containerEl.empty();

        new Setting(containerEl).setName("样式").setHeading();
        new Setting(containerEl)
            .setName("VLOOK 样式")
            .addDropdown(d => {
                for (const t of THEMES) d.addOption(t, themeLabel(t));
                d.setValue(s.style).onChange(v => { s.style = v; void save(); });
            });
        new Setting(containerEl)
            .setName("预览 / 导出主题")
            .setDesc("用于「VLOOK 预览」「导出 HTML」。可在文档 YAML 中用 vlook-theme 单独指定。")
            .addDropdown(d => {
                d.addOption("auto", "跟随插件配色");
                for (const t of THEMES) d.addOption(t, themeLabel(t));
                d.setValue(s.previewTheme).onChange(v => { s.previewTheme = v; void save(); });
            });

        new Setting(containerEl)
            .setName("主题文件夹")
            .addExtraButton(b => b.setIcon("folder-open").setTooltip("打开主题文件夹").onClick(() => void this.plugin.openThemeFolder()))
            .addExtraButton(b => b.setIcon("cloud-download").setTooltip("获取更多主题").onClick(async () => {
                await this.plugin.refreshRemoteThemes();
                this.display();
            }));
        new Setting(containerEl)
            .setName("主题目录")
            .addText(t => t.setPlaceholder(this.plugin.themeStore.builtinDir).setValue(s.themeFolder ?? "")
                .onChange(async v => { s.themeFolder = v.trim(); await this.plugin.saveData(s); }))
            .addExtraButton(b => b.setIcon("refresh-cw").setTooltip("重新加载主题").onClick(async () => {
                await this.plugin.reloadThemes();
                this.display();
            }));

        new Setting(containerEl).setName("可选功能").setHeading();
        new Setting(containerEl).setName("在线字体").setDesc("从 openfonts.pages.dev 加载主题字体").addToggle(t =>
            t.setValue(!!s.remoteFonts).onChange(async v => { s.remoteFonts = v; await save(); }));

        new Setting(containerEl).setName("导出").setHeading();
        new Setting(containerEl).setName("PDF 面板配色").addDropdown(d => {
            d.addOption("theme", "跟随主题").addOption("original", "原版配色");
            d.setValue(s.exportPrintPanel ?? "theme").onChange(async v => { s.exportPrintPanel = v as "theme" | "original"; await save(); });
        });
        new Setting(containerEl).setName("加载页样式").addDropdown(d => {
            d.addOption("theme", "跟随主题").addOption("original", "原版样式");
            d.setValue(s.exportLoadingPage ?? "theme").onChange(async v => { s.exportLoadingPage = v as "theme" | "original"; await save(); });
        });
        new Setting(containerEl).setName("显示署名").addToggle(t =>
            t.setValue(!!s.exportBranding).onChange(async v => { s.exportBranding = v; await save(); }));
        new Setting(containerEl).setName("署名内容").addText(t =>
            t.setPlaceholder("Styled & Enhanced by VLOOK™").setValue(s.exportBrandingText ?? "").onChange(async v => { s.exportBrandingText = v.trim(); await save(); }));

        new Setting(containerEl).setName("语法与排版").setHeading();
        const toggle = (name: string, desc: string, key: keyof typeof s) =>
            new Setting(containerEl).setName(name).setDesc(desc).addToggle(t =>
                t.setValue(s[key] as boolean).onChange(async v => { (s as unknown as Record<string, unknown>)[key] = v; await save(); }));
        new Setting(containerEl).setName("文件类型图标").addToggle(t =>
            t.setValue(s.fileTypeIcons).onChange(async v => { s.fileTypeIcons = v; await save(); this.plugin.applyFileTypeIcons(); }));
        toggle("识别 ~下标~ 与 ^上标^", "与 Typora 一致；色号 _~Rd~_、页签组 _^tab^_、注音 _^zhù^_ 在关闭时仍然可用。", "genericSubSup");
        toggle("标题自动编号", "使用主题配套格式，或文档 YAML 的 vlook-header-autonum。", "headerAutoNum");
        toggle("题注与自动编号", "*==题注==* 置于表格 / 代码块 / 公式前；图片使用 ![题注](url \"第二题注\")。", "captions");
        toggle("页签组", "_^tab^_ 独占一行，将其后连续的表格、插图、代码块、引用块等合并为页签组。", "tabGroups");
        toggle("分栏", "在引用块 / 列表前添加 1~4 条 --- 实现 2~5 栏。", "columns");
        toggle("封面与封底", "文档首个块为 ###### 标题时作为封面；最后一个块为 # 标题时作为封底；仅有 YAML 时生成小封面。", "cover");
        toggle("编辑模式渲染行内语法", "在实时预览中渲染标签、多级标签、色号、进度条等。", "livePreview");

        new Setting(containerEl).setName("默认色号").setHeading();
        const color = (name: string, desc: string, key: ColorKey, opts: SwatchOptions = {}) =>
            renderSwatches(new Setting(containerEl).setName(name).setDesc(desc), key, opts, s, save);
        color("引用块默认着色", "未指定色号的普通引用块自动使用的颜色，带 ! 为实心色块。", "quoteDefault", { none: true, solid: true });
        color("标签默认色号", "未指定色号的标签（tag）使用的颜色。", "tagDefault", { extra: [["t2-a", "主题色 2 · 淡", "#4D81EF"]] });
        color("多级标签默认色号", "未指定色号的多级标签（badge）使用的颜色。", "badgeDefault");
        color("刮刮卡默认色号", "刮刮卡（coating）涂层的颜色。", "coatingDefault");
    }
}
