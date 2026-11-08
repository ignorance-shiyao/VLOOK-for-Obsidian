import { embedRepairExtension } from './editor/embed-repair';
import { watchDuplicateMathLabels } from './features/math-labels';
import {registerPageSettings} from './page-settings';
import {typographyCss, resolveRemoteFonts} from './core/page-appearance';
import {diagramElements} from './core/diagram-dom';
import { EditorThemeRefresh } from './editor/theme-refresh';
import { DocumentAssets } from './core/document-assets';
import { supportsMermaidExtensions } from './core/diagram-extensions';
import { renderZenUmlFallback } from './features/zenuml-fallback';
import {watchFootnoteDiagrams} from './features/footnote-diagrams';
import { renderMathFence } from './features/math-fence';
import { registerLinkMap } from './link-map';
import { ResourceFailureHistory } from './core/resource-history';
import { MarkdownRenderChild, MarkdownPostProcessorContext, MarkdownView, Platform, Plugin, TAbstractFile, TFile, debounce, normalizePath, loadMermaid } from "obsidian";
import { DEFAULT_SETTINGS, Query, RenderCtx, VlookSettings, readCssVar } from "./core/context";
import { getSourceIndex } from "./core/source-index";
import { renderReadySection } from "./features/ready-section";
import { applyColorScheme } from "./features/image";
import { VlookSettingTab } from "./settings";
import { ICON_SPRITE } from "./generated/icons";
import { VLOOK_PREVIEW_VIEW, VlookPreviewView } from "./preview/view";
import { exportHtml, confirmExportPath } from "./preview/export";
import { VLOOK_HTML_VIEW, VlookHtmlFileView } from "./preview/html-file-view";
import { FileTypeIcons } from "./file-type-icons";
import { RAW_MARKER } from "./preview/document";
import { blockPreviewExtension } from "./editor/block-preview";
import { livePreviewExtension } from "./editor/live-preview";
import { registerNavigationHistory } from "./navigation-history";
import { ResumeReading } from "./resume-reading";
import { NativeSlides } from "./native-slides";
import { QuietView } from "./quiet-view";
import { ReadingProgress } from "./reading-progress";
import { ParagraphRoaming } from "./paragraph-roaming";
import { ReadingTools } from "./reading-tools";
import { DocumentOptions } from "./document-options";
import { registerNavigation } from "./navigation";
import { registerEditorCommands } from "./editor/commands";
import { ThemeSwitcher } from "./theme-switcher";
import { ThemeStore, type ThemePart } from "./core/theme-store";
import { BUILTIN_THEME_FILES } from "./core/builtin-themes";
import { downloadTheme, fetchThemeIndex } from "./core/theme-download";

import { THEMES, resolveStyleName, themeLabel } from "./core/themes";
import { notify } from "./notify";
export { THEMES } from "./core/themes";

export default class VlookPlugin extends Plugin {
    resourceHistory = new ResourceFailureHistory();
    tableSizes = new Map<string, import('./core/context').TableSizes>();
    settings: VlookSettings = { ...DEFAULT_SETTINGS };
    private documentAssets = new DocumentAssets(ICON_SPRITE);
    readonly fileTypeIcons = new FileTypeIcons();
    private styleRevision = 0;
    private editorThemeRefresh = new EditorThemeRefresh();
    private cssCache = new Map<string, string>();
    private mermaidHost: unknown;
    /** 正在为预览 / 导出做原始渲染（此时跳过插件自身的后处理） */
    rawRenderDepth = 0;
    themeSwitcher!: ThemeSwitcher;
    themeStore!: ThemeStore;

    async onload() {
        this.themeStore = new ThemeStore(this.app.vault.adapter, this.manifest.dir ?? "", () => this.settings.themeFolder ?? "", { version: this.manifest.version, files: BUILTIN_THEME_FILES });
        await this.loadSettings();
        const diagrams: unknown = await loadMermaid();
        this.mermaidHost = diagrams;
        if(!supportsMermaidExtensions(diagrams)){
            const watched=new Map<HTMLElement,()=>void>();
            let active=true;
            const refresh=()=>{
                if(!active)return;
                const hosts=new Set<HTMLElement>();
                this.app.workspace.iterateAllLeaves(leaf=>{
                    if(!(leaf.view instanceof MarkdownView))return;
                    const view=leaf.view,host=view.contentEl;hosts.add(host);
                    if(!watched.has(host))watched.set(host,watchFootnoteDiagrams(host,async()=>{
                        const file=view.file;if(!file)return null;
                        const source=await this.app.vault.cachedRead(file);
                        return view.file===file?source:null;
                    }));
                });
                for(const [host,dispose] of watched)if(!hosts.has(host)){dispose();watched.delete(host);}
            };
            this.app.workspace.onLayoutReady(refresh);
            this.registerEvent(this.app.workspace.on('layout-change',refresh));
            this.register(()=>{active=false;for(const dispose of watched.values())dispose();watched.clear();});
        }
        if (supportsMermaidExtensions(diagrams)) { /* 宿主自带图表引擎 */ }
        else this.registerMarkdownPostProcessor(async(el,ctx)=>{
            const child=new MarkdownRenderChild(el);ctx.addChild(child);
            let active=true;child.register(()=>{active=false});
            const info=ctx.getSectionInfo(el);
            let source=info?.text.split('\n').slice(info.lineStart,info.lineEnd+1).join('\n')||'';
            const diagrams=diagramElements(el);
            if(diagrams.length&&diagrams.every(node=>!!node.closest('.footnotes'))){
                const file=this.app.vault.getAbstractFileByPath(ctx.sourcePath);
                const full=info?.text||(file instanceof TFile?await this.app.vault.cachedRead(file):'');
                const index=getSourceIndex(full,{captionGroup:false,captionNumber:true});
                source=index.blocks.filter(block=>block.type==='paragraph'&&/^ {0,3}\[\^[^\]]+\]:/.test(block.text)).map(block=>block.text).join('\n\n');
            }
            if(!active)return;
            await renderZenUmlFallback(el,child,undefined,source);
        }, -100);
        this.injectSprite();
        const mathLabelWatchers=new Map<Document,()=>void>();
        const watchMath=(doc:Document)=>{if(!mathLabelWatchers.has(doc))mathLabelWatchers.set(doc,watchDuplicateMathLabels(doc));};
        watchMath(activeDocument);
        this.registerEvent(this.app.workspace.on('window-open',(_workspaceWindow,win)=>watchMath(win.document)));
        this.registerEvent(this.app.workspace.on('window-close',(_workspaceWindow,win)=>{mathLabelWatchers.get(win.document)?.();mathLabelWatchers.delete(win.document);}));
        this.register(()=>{for(const dispose of mathLabelWatchers.values())dispose();mathLabelWatchers.clear();});
        this.registerEvent(this.app.workspace.on('window-open', (_workspaceWindow, win) => {this.documentAssets.attach(win.document);if(this.settings.fileTypeIcons)this.fileTypeIcons.attach(win.document);}));
        this.registerEvent(this.app.workspace.on('window-close', (_workspaceWindow, win) => {this.documentAssets.detach(win.document);this.fileTypeIcons.detach(win.document);}));
        this.app.workspace.onLayoutReady(() => this.applyFileTypeIcons());
        this.register(() => this.fileTypeIcons.disable());
        this.app.workspace.onLayoutReady(() => {
            this.app.workspace.iterateAllLeaves(leaf => this.documentAssets.attach(leaf.view.containerEl.ownerDocument));
        });
        await this.applyStyle();
        this.lastRenderSignature = this.renderSignature();

        this.registerMarkdownCodeBlockProcessor('math',async(source,el,ctx)=>{
            const child=new MarkdownRenderChild(el);ctx.addChild(child);
            await renderMathFence(this.app,source,el,ctx.sourcePath,child);
        });
        this.registerMarkdownPostProcessor((el, ctx) => this.postProcess(el, ctx), 100);
        this.registerEditorExtension([this.editorThemeRefresh.extension(), livePreviewExtension(this), blockPreviewExtension(this), embedRepairExtension(this)]);
        registerEditorCommands(this);
        registerNavigation(this);
        registerLinkMap(this);
        registerNavigationHistory(this);
        new ResumeReading(this).register();
        new NativeSlides(this).register();
        new ReadingTools(this).register();
        new DocumentOptions(this).register();
        new ParagraphRoaming(this).register();
        new ReadingProgress(this).register();
        new QuietView(this).register();

        this.registerView(VLOOK_PREVIEW_VIEW, leaf => new VlookPreviewView(leaf, this));
        this.registerView(VLOOK_HTML_VIEW, leaf => new VlookHtmlFileView(leaf));
        // 其他插件已接管 .html 时不抢占
        try { this.registerExtensions(["html", "htm"], VLOOK_HTML_VIEW); } catch (error) { console.warn("[VLOOK] html 已由其他插件打开", error); }
        this.addRibbonIcon("book-open", "VLOOK 预览", () => this.openPreview());
        this.addCommand({ id: "open-preview", name: "打开预览（完整交互）", callback: () => this.openPreview() });
        this.addCommand({
            id: "export-html", name: "导出为 HTML",
            checkCallback: checking => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== "md") return false;
                if (!checking) exportHtml(this, file).catch(e => notify(`导出失败：${(e as Error).message}`));
                return true;
            },
        });
        this.addCommand({
            id: "export-html-themes", name: "导出为 HTML（含全部主题）",
            checkCallback: checking => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== "md") return false;
                if (!checking) exportHtml(this, file, true).catch(e => notify(`导出失败：${(e as Error).message}`));
                return true;
            },
        });
        if (Platform.isDesktopApp) this.addCommand({ id: "publish-pdf", name: "发布为 PDF（原版打印选项）", callback: () => this.openPreview(undefined, {print:true}) });
        else this.addCommand({
            id: "publish-pdf", name: "发布为 PDF（导出后用系统浏览器打印）",
            checkCallback: checking => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== "md") return false;
                if (!checking) exportHtml(this, file).then(out => {
                    if (out) void (this.app as unknown as {openWithDefaultApp?: (path: string) => Promise<void>}).openWithDefaultApp?.(out);
                }).catch(e => notify(`导出失败：${(e as Error).message}`));
                return true;
            },
        });
        this.addCommand({ id: "rerender", name: "刷新渲染", callback: () => this.rerenderAll() });
        this.addCommand({ id: "reload-themes", name: "重新加载主题", callback: () => this.reloadThemes() });
        this.addCommand({ id: "refresh-remote-themes", name: "获取更多主题", callback: () => void this.refreshRemoteThemes() });
        this.addCommand({ id: "open-theme-folder", name: "打开主题文件夹", callback: () => void this.openThemeFolder() });
        // 在系统文件管理器里放入主题文件后回到 Obsidian，自动识别并生效
        const refocus = debounce(() => { void this.themeStore.changed().then(changed => { if (changed) void this.reloadThemes(); }); }, 600, true);
        this.registerDomEvent(window, "focus", refocus);
        // 主题目录在库内时，增删或替换主题文件后自动生效
        const themeFileChanged = debounce(() => void this.reloadThemes(), 800, true);
        const inThemeFolder = (file: TAbstractFile, old?: string) => {
            const dir = normalizePath(this.settings.themeFolder ?? "").replace(/\/$/, "");
            return !!dir && dir !== "/" && [file.path, old ?? ""].some(path => path.startsWith(`${dir}/`) && /\.css$/i.test(path));
        };
        for (const event of ["create", "modify", "delete"] as const)
            this.registerEvent(this.app.vault.on(event as "create", file => { if (inThemeFolder(file)) themeFileChanged(); }));
        this.registerEvent(this.app.vault.on("rename", (file, old) => { if (inThemeFolder(file, old)) themeFileChanged(); }));
        this.themeSwitcher = new ThemeSwitcher(this);
        this.themeSwitcher.register();
        registerPageSettings(this);

        this.addSettingTab(new VlookSettingTab(this.app, this));
        // 明暗模式、主题切换
        this.registerEvent(this.app.workspace.on("css-change", async () => {
            const documents = new Set<Document>([activeDocument]);
            this.app.workspace.iterateAllLeaves(leaf => documents.add(leaf.view.containerEl.ownerDocument));
            documents.forEach(doc => applyColorScheme(doc));
            this.themeVars = new WeakMap();
            await this.applyStyle();
            this.editorThemeRefresh.refresh();
        }));
    }

    onunload() {
        this.resourceHistory.clear();
        this.styleRevision++;
        this.editorThemeRefresh.dispose();
        this.documentAssets.dispose();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<typeof DEFAULT_SETTINGS>);
        // 先扫描主题目录，定制主题名才不会被当作无效值改回默认主题
        await this.themeStore.scan();
        this.settings.style = resolveStyleName(this.settings.style);
    }

    async saveSettings() {
        this.settings.style = resolveStyleName(this.settings.style);
        const optional = `${!!this.settings.remoteFonts}`;
        if (optional !== this.lastOptional) {
            this.lastOptional = optional;
            this.clearAssetCache();
            this.documentAssets.setStyle(null, "");
        }
        await this.saveData(this.settings);
        await this.applyStyle();
        this.themeSwitcher?.update();
        this.app.workspace.trigger("css-change");
        // 只换配色、字体时渲染结果不变，只有影响渲染的设置或主题变量变了才重渲染所有视图
        const signature = this.renderSignature();
        if (signature !== this.lastRenderSignature) {
            this.lastRenderSignature = signature;
            this.rerenderAll();
        }
    }

    private lastRenderSignature = "";
    private lastOptional = "";
    private renderSignature(): string {
        const { style, themeFolder, textFont, textSize, pageWidth, exportBranding, exportBrandingText, exportPrintPanel, exportLoadingPage, ...rendering } = this.settings;
        const body = activeDocument.body;
        const vars = ["--vlook-query", "--vlook-header-autonum", "--v-cap-up-symbol", "--v-cap-down-symbol", "--tbl-freeze-column"].map(name => readCssVar(name, body));
        return JSON.stringify([rendering, vars]);
    }

    /** 图标集：VLOOK 的 SVG 图标都通过 <use xlink:href="#ico..."> 引用 */
    private injectSprite() {
        this.documentAssets.attach(activeDocument);
    }

    /** 导出前丢弃已缓存的样式文件，确保更新插件后无需重启即可用上新样式。 */
    clearAssetCache(): void { this.cssCache.clear(); this.themeStore?.clear(); }

    /** 重新扫描主题目录：替换主题文件后无需重启即可应用。 */
    async reloadThemes(): Promise<void> {
        this.clearAssetCache();
        const list = await this.themeStore.scan();
        this.documentAssets.setStyle(null, "");
        await this.saveSettings();
        const folder = (this.settings.themeFolder ?? "").trim();
        const missing = folder && !(await this.app.vault.adapter.exists(normalizePath(folder)));
        notify(missing ? `VLOOK：找不到主题目录 ${folder}` : `VLOOK：已加载 ${list.length} 套主题`, 4000, missing ? "warning" : "success");
    }

    private themeFailures = new Set<string>();
    private themeDownloads = new Map<string, Promise<boolean>>();

    /** 确保主题可用：插件目录里没有（或与插件版本不一致）时从发布页下载；失败时沿用已有文件。 */
    async ensureTheme(id: string): Promise<boolean> {
        const have = !!this.themeStore.get(id);
        const owned = this.themeStore.isBuiltin(id);
        if (have && (!owned || !this.themeStore.isStale(id))) return true;
        const listed = this.themeStore.remoteEntry(id);
        // 清单里有它，或它是此前下载过、现需随插件版本刷新的主题
        if (!(listed || (owned && this.themeStore.isStale(id))) || this.themeFailures.has(id)) return have;
        let job = this.themeDownloads.get(id);
        if (!job) {
            job = this.fetchTheme(id).finally(() => this.themeDownloads.delete(id));
            this.themeDownloads.set(id, job);
        }
        return (await job) || have;
    }

    private async fetchTheme(id: string): Promise<boolean> {
        const label = themeLabel(id);
        const progress = notify(`VLOOK：正在下载主题 ${label}…`, 0, "info");
        try {
            await this.themeStore.install(id, await downloadTheme(id, this.manifest.version, this.themeStore.remoteEntry(id)?.file));
            for (const key of [...this.cssCache.keys()]) if (key.startsWith(`${id}:`)) this.cssCache.delete(key);
            await this.themeStore.scan();
            progress.hide();
            return true;
        } catch (error) {
            progress.hide();
            this.themeFailures.add(id);
            notify(`VLOOK：无法下载主题 ${label}（${(error as Error).message}）。可手动将 ${id}.css 放入 ${this.themeStore.builtinDir}`, 0, "warning");
            return false;
        }
    }

    /** 从发布页获取可下载的主题清单；之后清单里的主题即可在列表中选用，选用时才下载文件。 */
    async refreshRemoteThemes(): Promise<void> {
        const progress = notify("VLOOK：正在获取主题清单…", 0, "info");
        try {
            const list = await fetchThemeIndex(this.manifest.version);
            await this.themeStore.setRemote(list);
            await this.themeStore.scan();
            this.themeFailures.clear();
            progress.hide();
            notify(`VLOOK：现有 ${THEMES.length} 套主题可选`, 4000, "success");
        } catch (error) {
            progress.hide();
            notify(`VLOOK：无法获取主题清单（${(error as Error).message}）`, 0, "warning");
        }
    }

    /** 在系统文件管理器中打开插件目录下的主题文件夹（不存在时先创建）。 */
    async openThemeFolder(): Promise<void> {
        const dir = this.themeStore.builtinDir;
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
        const app = this.app as unknown as { openWithDefaultApp?: (path: string) => Promise<void> };
        if (!app.openWithDefaultApp) { notify(`VLOOK：主题文件夹位于库内 ${dir}，当前设备无法直接打开`, 6000, "info"); return; }
        await app.openWithDefaultApp(dir);
    }

    /** 读取主题样式：obsidian 用于编辑/阅读视图，export 用于预览与导出 HTML。 */
    async readThemeCss(name: string, part: ThemePart): Promise<string | null> {
        await this.ensureTheme(name);
        const key = `${name}:${part}${this.settings.remoteFonts ? "#fonts" : ""}`;
        if (this.cssCache.has(key)) return this.cssCache.get(key)!;
        let text: string | null;
        try { text = await this.themeStore.css(name, part); }
        catch (error) { notify(`VLOOK：主题 ${name} 无法加载，${(error as Error).message}`); return null; }
        if (text === null) return null;
        // 默认不加载在线字体：去掉引用 http(s) 字体文件的 @font-face，改用系统字体
        text = resolveRemoteFonts(text, !!this.settings.remoteFonts);
        this.cssCache.set(key, text);
        return text;
    }

    /** 预览和导出默认跟随插件配色。 */
    resolvePreviewTheme(): string {
        if (THEMES.includes(this.settings.previewTheme)) return this.settings.previewTheme;
        return THEMES.includes(this.settings.style) ? this.settings.style : "blue";
    }

    /** 文件树类型图标：所有窗口同步开关。 */
    applyFileTypeIcons() {
        if (!this.settings.fileTypeIcons) { this.fileTypeIcons.disable(); return; }
        const docs = new Set<Document>([activeDocument]);
        this.app.workspace.iterateAllLeaves(leaf => docs.add(leaf.view.containerEl.ownerDocument));
        this.fileTypeIcons.enable([...docs]);
    }

    /** 注入插件内配色；none 显式关闭注入。 */
    async applyStyle() {
        const revision = ++this.styleRevision;
        this.themeVars = new WeakMap();
        this.documentAssets.attach(activeDocument);
        this.app.workspace.iterateAllLeaves(leaf => this.documentAssets.attach(leaf.view.containerEl.ownerDocument));
        const style = resolveStyleName(this.settings.style);
        let name: string | null = null;
        if (style === "none") name = null;
        else if (style === "auto") name = "blue";
        else name = style;
        if (!name) {
            const custom=typographyCss(this.settings.textFont,this.settings.textSize,this.settings.pageWidth);
            this.documentAssets.setStyle(custom ? "custom" : null,custom);
            this.themeVars = new WeakMap();
            return;
        }
        const css = await this.readThemeCss(name, "obsidian");
        if (revision !== this.styleRevision) return;
        if (!css) {
            notify(`VLOOK：未找到主题 ${name}，请将主题文件放入 ${this.themeStore.builtinDir}`);
            return;
        }
        this.documentAssets.setStyle(name, css+typographyCss(this.settings.textFont,this.settings.textSize,this.settings.pageWidth));
        this.themeVars = new WeakMap();
    }

    /** 主题变量按元素缓存：同一轮渲染里每个区块都读，样式变化（applyStyle）后失效。 */
    private themeVars = new WeakMap<Element, Map<string, string>>();
    private themeVar(name: string, scope: Element): string {
        let vars = this.themeVars.get(scope);
        if (!vars) this.themeVars.set(scope, vars = new Map<string, string>());
        let value = vars.get(name);
        if (value === undefined) vars.set(name, value = readCssVar(name, scope));
        return value;
    }

    private makeCtx(sourcePath: string, text?: string, frontmatter?: Record<string, unknown>, scope: Element = activeDocument.body): RenderCtx {
        const fmQuery = (frontmatter?.["vlook-query"] as string | undefined) ?? undefined;
        const query = new Query(this.themeVar("--vlook-query", scope), fmQuery);
        const ctx: RenderCtx = {
            resourceHistory: this.resourceHistory,
            tableSizes: this.tableSizes,
            app: this.app,
            settings: this.settings,
            query,
            sourcePath,
            cssVar: (n: string) => this.themeVar(n, scope),
        };
        if (text !== undefined) {
            const fmTpl = frontmatter?.["vlook-header-autonum"] as string | undefined;
            ctx.index = getSourceIndex(text, {
                headerEnabled: this.settings.headerAutoNum,
                headerTemplate: fmTpl || this.themeVar("--vlook-header-autonum", scope) || undefined,
                captionGroup: query.get("capgroup") !== "off",
                captionNumber: query.get("capnum") !== "off",
            });
        }
        return ctx;
    }

    private postProcess(el: HTMLElement, mdCtx: MarkdownPostProcessorContext) {
        try {
            const info = mdCtx.getSectionInfo(el);
            // 预览 / 导出用的原始渲染：不做 VLOOK 处理（交给官方运行时）。
            // 嵌入内容可能在渲染结束后才异步回调，此时已挂在离屏容器内，按容器判断
            if (info?.text.startsWith(RAW_MARKER) || el.closest(".vlook-offscreen, .vlook-editor-render") || (this.rawRenderDepth > 0 && !info && !el.isConnected)) return;
            const ctx = this.makeCtx(mdCtx.sourcePath, info?.text, mdCtx.frontmatter as Record<string, unknown> | undefined, el.ownerDocument.body);
            if (info && ctx.index) ctx.block = ctx.index.blockAt(info.lineStart);
            let child:MarkdownRenderChild|undefined;
            ctx.registerCleanup=cleanup=>{
                if(!child){child=new MarkdownRenderChild(el);mdCtx.addChild(child);}
                child.register(cleanup);
            };
            void renderReadySection(el,ctx).catch(error=>{
                if((error as Error)?.name!=='AbortError')console.error('[VLOOK] async render error',error);
            });
        } catch (e) {
            console.error("[VLOOK] render error", e);
        }
    }

    rerenderAll() {
        this.editorThemeRefresh.refresh();
        this.app.workspace.updateOptions();
        this.app.workspace.getLeavesOfType("markdown").forEach(leaf => {
            const view = leaf.view as MarkdownView;
            view.previewMode?.rerender(true);
        });
        this.app.workspace.getLeavesOfType(VLOOK_PREVIEW_VIEW).forEach(leaf => void (leaf.view as VlookPreviewView).refresh());
    }

    async openPreview(file?: TFile, options: { print?: boolean } = {}) {
        const target = file ?? this.app.workspace.getActiveFile() ?? this.app.workspace.getActiveViewOfType(VlookPreviewView)?.getFile();
        if (!target || target.extension !== "md") {
            notify("VLOOK：请先打开一篇 Markdown 文档");
            return;
        }
        let out:string|null=null;
        if(options.print){
            const dir=target.parent&&target.parent.path!=="/"?`${target.parent.path}/`:"";
            out=await confirmExportPath(this,`${dir}${target.basename}.pdf`,"PDF");
            if(!out)return;
        }
        const leaf = this.app.workspace.getLeaf("split");
        await leaf.setViewState({ type: VLOOK_PREVIEW_VIEW, active: true, state: { file: target.path, print: !!options.print, out } });
    }
}
