/** Palettes shared by editing, preview and export. Available themes come from the themes folders, not from a fixed list. */

export interface ThemeMeta { id: string; name: string; color: string; colors?: [string, string] }

/** 默认主题：随插件内置，目录里始终有它。 */
export const DEFAULT_THEME = "blue";
const DEFAULT_META: ThemeMeta = { id: DEFAULT_THEME, name: "Ignorance", color: "#4d81ef", colors: ["#4D81EF", "#1B2B48"] };

/** 当前可选主题（就地更新，引用方无需重新导入）：主题目录里的全部主题，加上发布页清单中尚未下载的。 */
export const THEMES: string[] = [DEFAULT_THEME];
const META = new Map<string, ThemeMeta>([[DEFAULT_THEME, DEFAULT_META]]);
const REMOTE = new Set<string>();

/** installed：扫描主题目录得到的主题；remote：发布页清单里列出的主题，未安装的在选用时下载。 */
export function setThemes(installed: ThemeMeta[], remote: ThemeMeta[] = []): void {
    const list = new Map<string, ThemeMeta>();
    for (const meta of installed) list.set(meta.id, meta);
    REMOTE.clear();
    for (const meta of remote) {
        REMOTE.add(meta.id);
        const have = list.get(meta.id);
        if (!have) list.set(meta.id, meta);
        // 已安装的文件没有写名称、色点时，用清单里的补上
        else if (have.name === have.id || !have.color) list.set(meta.id, { ...have, name: have.name === have.id ? meta.name : have.name, color: have.color || meta.color, colors: have.colors ?? meta.colors });
    }
    if (!list.has(DEFAULT_THEME)) list.set(DEFAULT_THEME, DEFAULT_META);
    // 默认主题在前，其余按 id 排序
    const ids = [...list.keys()].sort((a, b) => a === DEFAULT_THEME ? -1 : b === DEFAULT_THEME ? 1 : a.localeCompare(b));
    META.clear();
    for (const id of ids) META.set(id, list.get(id)!);
    THEMES.splice(0, THEMES.length, ...ids);
}

/** 发布页清单中列出的主题（可能尚未下载）。 */
export function isRemoteTheme(id: string): boolean { return REMOTE.has(id); }

export function themeLabel(id: string): string {
    return META.get(id)?.name ?? id[0].toUpperCase() + id.slice(1);
}
export function themeColor(id: string): string { return META.get(id)?.color ?? ""; }
export function themeColors(id: string): [string, string] | undefined { return META.get(id)?.colors; }

export function resolveThemeName(value:unknown,fallback=DEFAULT_THEME):string {
    const name=typeof value==='string'?value.trim().toLowerCase():'';
    if(THEMES.includes(name))return name;
    if(THEMES.includes(fallback))return fallback;
    return DEFAULT_THEME;
}

/** 旧版的 auto / none 一律回到内置默认主题。 */
export function resolveStyleName(value:unknown):string {
    return resolveThemeName(value);
}
