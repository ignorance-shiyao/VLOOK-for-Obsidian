// 文件树按类型显示图标：参考 Ignorance 主题，Lucide 图标作为 CSS 遮罩，颜色随明暗模式切换。
// 图标取自 Obsidian 自带的 Lucide，不额外打包；已安装 Ignorance Advanced 图标时让位给它。

import { getIcon } from "obsidian";

interface FileKind { id: string; icon: string; ext: string[]; light: string; dark: string }

export const FILE_KINDS: FileKind[] = [
    { id: "md", icon: "file-text", ext: ["md"], light: "#4D81EF", dark: "#78A3F5" },
    { id: "html", icon: "file-code-2", ext: ["html", "htm"], light: "#E8783A", dark: "#F39A63" },
    { id: "pdf", icon: "file-type", ext: ["pdf"], light: "#D9484B", dark: "#EE7B7D" },
    { id: "image", icon: "image", ext: ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico", "heic"], light: "#C2559A", dark: "#E08AC0" },
    { id: "audio", icon: "music", ext: ["mp3", "wav", "m4a", "ogg", "flac", "aac", "opus"], light: "#1E9BAE", dark: "#5CC4D3" },
    { id: "video", icon: "clapperboard", ext: ["mp4", "webm", "mov", "mkv", "m4v", "ogv", "avi"], light: "#D2603D", dark: "#EB8F72" },
    { id: "canvas", icon: "layout-dashboard", ext: ["canvas", "excalidraw"], light: "#8C6BE8", dark: "#A98AE5" },
    { id: "base", icon: "table-2", ext: ["base"], light: "#4AA477", dark: "#6ECBA4" },
    { id: "sheet", icon: "sheet", ext: ["csv", "tsv", "xls", "xlsx", "numbers"], light: "#2F9D62", dark: "#62C48F" },
    { id: "doc", icon: "file-pen", ext: ["doc", "docx", "pages", "rtf", "odt"], light: "#3567C9", dark: "#7099E6" },
    { id: "slide", icon: "presentation", ext: ["ppt", "pptx", "key", "odp"], light: "#D7832E", dark: "#EFA866" },
    { id: "code", icon: "file-code", ext: ["js", "mjs", "ts", "css", "json", "yml", "yaml", "py", "sh", "xml", "toml"], light: "#B08B2E", dark: "#D9B65C" },
    { id: "archive", icon: "archive", ext: ["zip", "rar", "7z", "tar", "gz", "tgz"], light: "#8A6A4F", dark: "#BC9B7E" },
];

function iconUrl(name: string): string | null {
    const svg = getIcon(name) ?? getIcon("file");
    if (!svg) return null;
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.removeAttribute("class");
    // 遮罩只取形状，描边统一为不透明黑色
    const markup = svg.outerHTML.replace(/currentColor/g, "#000");
    return `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
}

/** 生成全部规则；Excalidraw 的 .excalidraw.md 归入画板而非笔记。 */
export function fileIconCss(kinds: FileKind[] = FILE_KINDS, url: (name: string) => string | null = iconUrl): string {
    const fallback = url("file");
    const scope = ".nav-file-title:not(:has(> .ib-file-icon))";
    const rules = [
        `${scope} > .nav-file-title-content::before{content:"";display:inline-block;flex:0 0 auto;width:14px;height:14px;margin-inline-end:6px;vertical-align:-0.12em;background-color:var(--vlook-file-color,var(--text-faint));-webkit-mask:var(--vlook-file-icon) center/contain no-repeat;mask:var(--vlook-file-icon) center/contain no-repeat}`,
        fallback ? `.nav-file-title{--vlook-file-icon:${fallback}}` : "",
    ];
    const light: string[] = [], dark: string[] = [];
    for (const kind of kinds) {
        const icon = url(kind.icon);
        const selector = kind.ext.map(ext => `[data-path$=".${ext}" i]`).join(",");
        const extra = kind.id === "canvas" ? `,[data-path$=".excalidraw.md" i]` : "";
        rules.push(`.nav-file-title:is(${selector}${extra}){${icon ? `--vlook-file-icon:${icon};` : ""}--vlook-file-color:var(--vlook-file-${kind.id})}`);
        light.push(`--vlook-file-${kind.id}:${kind.light}`);
        dark.push(`--vlook-file-${kind.id}:${kind.dark}`);
    }
    rules.push(`body{${light.join(";")}}`, `body.theme-dark{${dark.join(";")}}`);
    return rules.filter(Boolean).join("\n");
}

/** 每个窗口文档挂一份样式；关闭功能或卸载插件时移除。 */
export class FileTypeIcons {
    private styles = new Map<Document, HTMLStyleElement>();
    private css = "";

    enable(docs: Document[]) {
        this.css ||= fileIconCss();
        for (const doc of docs) this.attach(doc);
    }

    attach(doc: Document) {
        if (!this.css || this.styles.has(doc)) return;
        const style = doc.createElement("style");
        style.id = "vlook-file-type-icons";
        style.textContent = this.css;
        doc.head.append(style);
        this.styles.set(doc, style);
    }

    detach(doc: Document) { this.styles.get(doc)?.remove(); this.styles.delete(doc); }

    disable() { for (const doc of [...this.styles.keys()]) this.detach(doc); this.css = ""; }
}
