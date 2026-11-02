import {vlookQueryParams} from './query-source';
import type { App } from "obsidian";
import type { Block, SourceIndex } from "./source-index";
import type { ReadingPosition } from "../resume-reading";

export interface VlookSettings {
    readingPositions?: Record<string, ReadingPosition>;
    /** 注入的 VLOOK 样式：主题名 / none（旧 auto 兼容为 blue） */
    style: string;
    textFont?: string;
    textSize?: number;
    pageWidth?: number;
    /** 导出的 HTML 是否显示 VLOOK 署名（默认不显示）及自定义内容 */
    exportBranding?: boolean;
    exportBrandingText?: string;
    /** 导出页「发布为 PDF」面板配色：跟随主题（默认）或原版红黑 */
    exportPrintPanel?: "theme" | "original";
    /** 导出页首次加载页：跟随主题（默认）或原版 */
    exportLoadingPage?: "theme" | "original";
    /** 可选功能：默认关闭，避免默认行为涉及动态执行代码或联网 */
    enableZenUml?: boolean;
    remoteFonts?: boolean;
    /** 将 ~x~、^x^ 识别为下标、上标（Typora 语法） */
    genericSubSup: boolean;
    headerAutoNum: boolean;
    captions: boolean;
    tabGroups: boolean;
    columns: boolean;
    cover: boolean;
    fileTypeIcons: boolean;
    /** 默认引用块着色（如 T1!），留空表示不自动着色 */
    quoteDefault: string;
    tagDefault: string;
    badgeDefault: string;
    coatingDefault: string;
    /** 实时预览（编辑模式）中渲染标签、色号等行内语法 */
    livePreview: boolean;
    /** 预览/导出使用的主题 */
    previewTheme: string;
    /** 定制主题所在的库内文件夹，同 id 时覆盖插件内置主题 */
    themeFolder?: string;
}

export const DEFAULT_SETTINGS: VlookSettings = {
    style: "blue",
    genericSubSup: true,
    headerAutoNum: true,
    captions: true,
    tabGroups: true,
    columns: true,
    cover: true,
    fileTypeIcons: true,
    quoteDefault: "",
    tagDefault: "t2-a",
    badgeDefault: "t1",
    coatingDefault: "gy",
    livePreview: true,
    previewTheme: "auto",
};

/** VLOOK「插件调校参数」：主题 --vlook-query < YAML vlook-query */
export class Query {
    private params = new Map<string, string>();

    constructor(themeQuery: string, yamlQuery?: string) {
        this.append(themeQuery);
        if (yamlQuery) this.append(yamlQuery);
    }

    private append(q: string) {
        for (const [k, v] of vlookQueryParams(q))
            this.params.set(k, v);
    }

    get(key: string): string | null {
        const v = this.params.get(key);
        return v == null ? null : v.toLowerCase();
    }
}

export interface RenderCtx {
    resourceHistory?: import('./resource-history').ResourceFailureHistory;
    /** 阅读视图里拖动调整过的表格列宽与行高，重新渲染后恢复（仅本次运行）。 */
    tableSizes?: Map<string, TableSizes>;
    app: App | null;
    settings: VlookSettings;
    query: Query;
    sourcePath: string;
    index?: SourceIndex;
    /** 内部内容浏览渲染时不重复添加浮窗入口。 */
    suppressContentViewers?: boolean;
    /** 当前渲染区块卸载时释放媒体等资源。 */
    registerCleanup?(cleanup: () => void): void;
    block?: Block;
    /** 解析 CSS 变量（来自当前主题） */
    cssVar(name: string): string;
}

export function readCssVar(name: string, el: Element = activeDocument.body): string {
    return (el.ownerDocument.defaultView?.getComputedStyle(el).getPropertyValue(name) || "").trim().replace(/^["']|["']$/g, "");
}

export interface TableSizes { cols: (string | null)[]; rows: (string | null)[] }
