// 主题目录：common.css（公共样式）+ 每套主题一个 .css，文件名（去掉扩展名）即主题 id。
// 可用主题完全由目录内容决定：插件目录 themes/ 放内置与下载的主题；设置中的「主题目录」可放定制主题，同名时覆盖。
import { normalizePath, type DataAdapter } from "obsidian";
import { setThemes, type ThemeMeta } from "./themes";

export type ThemePart = "obsidian" | "export";

export interface ThemeInfo extends ThemeMeta { path: string; /** 不依赖 common.css 的单文件主题 */ standalone: boolean }

const HEADER = /^\s*\/\*@vlook-theme (\{.*?\})\*\/\n?/;
const PART = /\/\*@vlook-part (\w+)\*\//g;
const IMPORT = /@import\s+(?:url\(\s*)?(?:"[^"]*"|'[^']*'|[^"';)]+)\s*\)?[^;]*;/g;

/**
 * 识别主题文件：id 取文件名，文件头（名称、色点、standalone）可有可无；
 * 既没有文件头、也没有 /*@vlook-part …*\/ 段标记的 CSS 不算主题。
 */
export function parseThemeHeader(text: string, path: string): ThemeInfo | null {
    const id = path.slice(path.lastIndexOf("/") + 1).replace(/\.css$/i, "").trim().toLowerCase();
    if (!id) return null;
    let meta: Partial<ThemeInfo> = {};
    const match = text.match(HEADER);
    if (match) { try { meta = JSON.parse(match[1]) as Partial<ThemeInfo>; } catch { return null; } }
    else if (!/\/\*@vlook-part \w+\*\//.test(text)) return null;
    return {
        id, path,
        name: typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : id,
        color: typeof meta.color === "string" ? meta.color : "",
        colors: Array.isArray(meta.colors) && meta.colors.length === 2 ? [String(meta.colors[0]), String(meta.colors[1])] : undefined,
        standalone: meta.standalone === true,
    };
}

/** 文件 → 各部分原文（common.css 与主题文件结构相同）。 */
export function themeParts(text: string): Partial<Record<ThemePart | "shared", string>> {
    const body = text.replace(HEADER, "");
    const out: Partial<Record<ThemePart | "shared", string>> = {};
    const marks = Array.from(body.matchAll(PART));
    marks.forEach((mark, i) => {
        out[mark[1] as ThemePart | "shared"] = body.slice(mark.index + mark[0].length, marks[i + 1]?.index ?? body.length);
    });
    return out;
}

/** 公共样式在前、主题在后；@import 只在样式表最前才有效，统一提到最前。 */
export function assembleTheme(common: string, theme: string): string {
    const imports: string[] = [];
    const body = (common + theme).replace(IMPORT, m => { imports.push(m); return ""; });
    return imports.length ? imports.join("\n") + "\n" + body : body;
}

/** 发布页清单中的一项：主题元数据与发布页上的文件名。 */
export interface ThemeRemote extends ThemeMeta { file?: string }
interface ThemeState { seed: string; downloaded: Record<string, string> }
interface IndexEntry { mtime: number; size: number; meta: ThemeInfo | null }

export class ThemeStore {
    private themes = new Map<string, ThemeInfo>();
    private texts = new Map<string, string>();
    private index: Record<string, IndexEntry> = {};
    private state: ThemeState | null = null;
    private remote: ThemeRemote[] = [];

    /** seed：随插件内置的文件（默认主题与公共样式），首次运行或插件升级后写入插件目录。 */
    constructor(private adapter: DataAdapter, private pluginDir: string, private userDir: () => string, private seed?: { version: string; files: Record<string, string> }) {}

    get builtinDir(): string { return normalizePath(`${this.pluginDir}/themes`); }
    private get indexPath(): string { return normalizePath(`${this.pluginDir}/themes-index.json`); }
    private get remotePath(): string { return normalizePath(`${this.pluginDir}/themes-remote.json`); }
    private get statePath(): string { return normalizePath(`${this.pluginDir}/themes-state.json`); }

    private async loadState(): Promise<ThemeState> {
        if (this.state) return this.state;
        let state: ThemeState = { seed: "", downloaded: {} };
        try { state = { ...state, ...(JSON.parse(await this.adapter.read(this.statePath)) as Partial<ThemeState>) }; } catch { /* 首次运行 */ }
        return this.state = state;
    }
    private async saveState(): Promise<void> {
        await this.adapter.write(this.statePath, JSON.stringify(this.state)).catch(() => {});
    }

    /** 内置文件缺失或插件升级后写入；插件目录下的主题由插件维护，自行修改请放进设置中的主题目录。 */
    private async plant(): Promise<void> {
        if (!this.seed) return;
        const state = await this.loadState();
        const missing: string[] = [];
        for (const name of Object.keys(this.seed.files))
            if (!(await this.adapter.exists(normalizePath(`${this.builtinDir}/${name}`)))) missing.push(name);
        if (state.seed === this.seed.version && !missing.length) return;
        if (!(await this.adapter.exists(this.builtinDir))) await this.adapter.mkdir(this.builtinDir);
        for (const [name, text] of Object.entries(this.seed.files))
            await this.adapter.write(normalizePath(`${this.builtinDir}/${name}`), text);
        state.seed = this.seed.version;
        await this.saveState();
    }

    /** 发布页清单：列出可下载的主题，保存在本地，启动时不联网。 */
    remoteList(): ThemeRemote[] { return this.remote; }
    remoteEntry(id: string): ThemeRemote | undefined { return this.remote.find(item => item.id === id); }
    async setRemote(list: ThemeRemote[]): Promise<void> {
        this.remote = list;
        await this.adapter.write(this.remotePath, JSON.stringify(list)).catch(() => {});
    }

    /** 已下载的主题与当前插件版本不一致：需要刷新。手动放入的主题不受影响。 */
    isStale(id: string): boolean {
        const version = this.state?.downloaded[id];
        return version !== undefined && version !== this.seed?.version;
    }

    /** 保存下载的主题文件并记录版本。 */
    async install(id: string, text: string): Promise<void> {
        const state = await this.loadState();
        if (!(await this.adapter.exists(this.builtinDir))) await this.adapter.mkdir(this.builtinDir);
        await this.adapter.write(normalizePath(`${this.builtinDir}/${id}.css`), text);
        state.downloaded[id] = this.seed?.version ?? "";
        await this.saveState();
    }

    /** 主题文件是否在插件目录（由插件维护），而不是用户的主题目录。 */
    isBuiltin(id: string): boolean {
        return !!this.themes.get(id)?.path.startsWith(`${this.builtinDir}/`);
    }

    list(): ThemeInfo[] { return [...this.themes.values()]; }
    get(id: string): ThemeInfo | undefined { return this.themes.get(id); }

    private listed = "";

    /** 两个主题目录里的文件及其修改时间：用于发现用户放入、替换或删除了主题文件。 */
    private async listing(): Promise<string> {
        const user = this.userDir().trim();
        const out: string[] = [];
        for (const dir of [this.builtinDir, ...(user ? [normalizePath(user)] : [])]) {
            let files: string[] = [];
            try { if (await this.adapter.exists(dir)) files = (await this.adapter.list(dir)).files; } catch { files = []; }
            for (const path of files.filter(f => /\.css$/i.test(f)).sort()) {
                const stat = await this.adapter.stat(path).catch(() => null);
                out.push(`${path}:${stat?.mtime ?? 0}:${stat?.size ?? 0}`);
            }
        }
        return out.join("\n");
    }

    /** 自上次扫描后主题目录是否有变化。 */
    async changed(): Promise<boolean> { return (await this.listing()) !== this.listed; }

    /** 扫描内置与用户主题目录。文件头按修改时间缓存，启动时不必读完整个主题文件。 */
    async scan(): Promise<ThemeInfo[]> {
        this.texts.clear();
        if (!this.remote.length) { try { this.remote = JSON.parse(await this.adapter.read(this.remotePath)) as typeof this.remote; } catch { this.remote = []; } }
        await this.loadState();
        await this.plant();
        if (!Object.keys(this.index).length) {
            try { this.index = JSON.parse(await this.adapter.read(this.indexPath)) as typeof this.index; } catch { this.index = {}; }
        }
        const next = new Map<string, ThemeInfo>();
        const seen: Record<string, IndexEntry> = {};
        const user = this.userDir().trim();
        for (const dir of [this.builtinDir, ...(user ? [normalizePath(user)] : [])]) {
            let files: string[] = [];
            try { if (await this.adapter.exists(dir)) files = (await this.adapter.list(dir)).files; } catch { files = []; }
            for (const path of files.filter(f => /\.css$/i.test(f)).sort()) {
                const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
                if (name === "common.css") continue;
                const stat = await this.adapter.stat(path).catch(() => null);
                const cached = this.index[path];
                let entry: IndexEntry;
                if (cached && stat && cached.mtime === stat.mtime && cached.size === stat.size) entry = cached;
                else {
                    const text = await this.adapter.read(path).catch(() => "");
                    entry = { mtime: stat?.mtime ?? 0, size: stat?.size ?? 0, meta: parseThemeHeader(text, path) };
                }
                seen[path] = entry;
                if (entry.meta) next.set(entry.meta.id, entry.meta);
            }
        }
        const changed = JSON.stringify(seen) !== JSON.stringify(this.index);
        this.index = seen;
        if (changed) await this.adapter.write(this.indexPath, JSON.stringify(this.index)).catch(() => {});
        // 内置主题在前、保持构建顺序；定制主题按名称排在其后
        this.themes = next;
        setThemes(this.list(), this.remote);
        this.listed = await this.listing();
        return this.list();
    }

    private async read(path: string): Promise<string | null> {
        if (this.texts.has(path)) return this.texts.get(path)!;
        if (!(await this.adapter.exists(path))) return null;
        const text = await this.adapter.read(path);
        this.texts.set(path, text);
        return text;
    }

    /** 主题依赖的公共样式：同目录的 common.css，其次内置目录的。 */
    async common(info: ThemeInfo, part: ThemePart): Promise<string> {
        if (info.standalone) return "";
        const dir = info.path.slice(0, info.path.lastIndexOf("/"));
        for (const path of new Set([normalizePath(`${dir}/common.css`), normalizePath(`${this.builtinDir}/common.css`)])) {
            const text = await this.read(path);
            if (text !== null) return themeParts(text)[part] ?? "";
        }
        return "";
    }

    /** 某部分的两层样式：公共（在前）与主题独有。 */
    async layers(id: string, part: ThemePart): Promise<{ info: ThemeInfo; common: string; theme: string } | null> {
        const info = this.themes.get(id);
        if (!info) return null;
        const parts = themeParts((await this.read(info.path)) ?? "");
        if (parts[part] === undefined) return null;
        // shared：两部分共用的大体积声明，排在该部分之前
        return { info, common: await this.common(info, part), theme: (parts.shared ?? "") + parts[part] };
    }

    /** 某部分的完整 CSS。 */
    async css(id: string, part: ThemePart): Promise<string | null> {
        const layers = await this.layers(id, part);
        return layers ? assembleTheme(layers.common, layers.theme) : null;
    }

    clear(): void { this.texts.clear(); }
}
