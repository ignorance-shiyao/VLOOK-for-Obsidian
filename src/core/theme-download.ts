/** 主题下载：只从 VLOOK 主题仓库的最新发布页取纯样式文件与一份主题清单，不涉及任何用户数据。 */
import { requestUrl } from "obsidian";
import { parseThemeHeader, type ThemeRemote } from "./theme-store";

export const THEME_RELEASE_BASE = "https://github.com/ignorance-shiyao/VLOOK-for-Obsidian-themes/releases/latest/download";
export const THEME_INDEX_NAME = "themes.json";

export const themeAssetName = (id: string) => `theme-${id}.css`;

async function get(name: string): Promise<string> {
    const response = await requestUrl({ url: `${THEME_RELEASE_BASE}/${name}`, throw: false });
    if (response.status !== 200) throw Error(`HTTP ${response.status}`);
    return response.text;
}

export async function downloadTheme(id: string, file = themeAssetName(id)): Promise<string> {
    const text = await get(file);
    if (!parseThemeHeader(text, `${id}.css`)) throw Error("文件不是有效的 VLOOK 主题");
    return text;
}

/** 发布页上的主题清单：[{ id, name, color, colors?, file? }]。 */
export async function fetchThemeIndex(): Promise<ThemeRemote[]> {
    const data = JSON.parse(await get(THEME_INDEX_NAME)) as unknown;
    if (!Array.isArray(data)) throw Error("主题清单格式不正确");
    const items = data as Record<string, unknown>[];
    return items.filter(item => item && typeof item.id === "string" && item.id).map(item => {
        const id = item.id as string, colors = item.colors;
        return {
            id: id.toLowerCase(),
            name: typeof item.name === "string" && item.name ? item.name : id,
            color: typeof item.color === "string" ? item.color : "",
            colors: Array.isArray(colors) && colors.length === 2 ? [String(colors[0]), String(colors[1])] as [string, string] : undefined,
            file: typeof item.file === "string" ? item.file : undefined,
        };
    });
}
