import { App, PluginSettingTab, Setting } from "obsidian";
import type VlookPlugin from "./main";
import { THEMES, themeLabel } from "./core/themes";

export class VlookSettingTab extends PluginSettingTab {
    constructor(app: App, private plugin: VlookPlugin) {
        super(app, plugin);
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
                THEMES.forEach(t => d.addOption(t, themeLabel(t)));
                d.setValue(s.style).onChange(v => { s.style = v; void save(); });
            });
        new Setting(containerEl)
            .setName("预览 / 导出主题")
            .setDesc("用于「VLOOK 预览」「导出 HTML」。可在文档 YAML 中用 vlook-theme 单独指定。")
            .addDropdown(d => {
                d.addOption("auto", "跟随插件配色");
                THEMES.forEach(t => d.addOption(t, themeLabel(t)));
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
        const BASE: [string, string, string][] = [["t1", "主题色 1", "#356FD8"], ["t2", "主题色 2", "#4D81EF"], ["rd", "红", "#E5484D"], ["og", "橙", "#F5871F"], ["ye", "黄", "#F5C518"], ["gn", "绿", "#30A46C"], ["cy", "青", "#12A594"], ["bu", "蓝", "#3E63DD"], ["pu", "紫", "#8E4EC6"], ["pk", "粉", "#E93D82"], ["gy", "灰", "#8B8D98"], ["bk", "黑", "#1C1C1F"]];
        const color = (name: string, desc: string, key: "quoteDefault" | "tagDefault" | "badgeDefault" | "coatingDefault", opts: { none?: boolean; solid?: boolean; extra?: [string, string, string][] } = {}) => {
            const setting = new Setting(containerEl).setName(name).setDesc(desc);
            const wrap = setting.controlEl.createDiv({ cls: "vlook-swatches" });
            const current = wrap.createSpan({ cls: "vlook-swatch-name" });
            const group = wrap.createDiv({ cls: "vlook-swatch-group" });
            const items: { value: string; label: string; css: string }[] = [];
            if (opts.none) items.push({ value: "", label: "不着色", css: "" });
            for (const [code, label, hex] of [...(opts.extra ?? []), ...BASE]) {
                const base = code.replace(/-a$/, "");
                items.push({ value: opts.solid ? code + "!" : code, label: `${code[0].toUpperCase() + code.slice(1)}${opts.solid ? "!" : ""} · ${label}`, css: code.endsWith("-a") ? `color-mix(in srgb, var(--ac-${base}, ${hex}) 40%, white)` : `var(--ac-${code}, ${hex})` });
            }
            if (!items.some(i => i.value === s[key])) items.push({ value: s[key], label: `${s[key]} · 自定义`, css: `var(--ac-${s[key].replace(/!$/, "")}, #999)` });
            const buttons = items.map(item => {
                const button = group.createEl("button", { cls: "vlook-swatch" + (item.css ? "" : " is-none"), attr: { type: "button", "aria-label": item.label, title: item.label } });
                if (item.css) button.style.setProperty('background', item.css);
                button.onclick = async () => { s[key] = item.value; await save(); refresh(); };
                return button;
            });
            const refresh = () => {
                items.forEach((item, i) => buttons[i].classList.toggle("is-selected", item.value === s[key]));
                current.setText(items.find(i => i.value === s[key])?.label ?? "");
            };
            refresh();
        };
        color("引用块默认着色", "未指定色号的普通引用块自动使用的颜色，带 ! 为实心色块。", "quoteDefault", { none: true, solid: true });
        color("标签默认色号", "未指定色号的标签（tag）使用的颜色。", "tagDefault", { extra: [["t2-a", "主题色 2 · 淡", "#4D81EF"]] });
        color("多级标签默认色号", "未指定色号的多级标签（badge）使用的颜色。", "badgeDefault");
        color("刮刮卡默认色号", "刮刮卡（coating）涂层的颜色。", "coatingDefault");
    }
}
