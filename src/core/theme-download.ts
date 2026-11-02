/** 主题下载：只从本插件 GitHub 发布页取与当前版本一致的文件（纯样式与一份主题清单），不涉及任何用户数据。 */
import { requestUrl } from "obsidian";
import { parseThemeHeader, type ThemeRemote } from "./theme-store";

export const THEME_RELEASE_BASE = "https://github.com/ignorance-shiyao/VLOOK-for-Obsidian/releases/download";
export const THEME_INDEX_NAME = "themes.json";

export const themeAssetName = (id: string) => `theme-${id}.css`;

async function get(version: string, name: string): Promise<string> {
    const response = await requestUrl({ url: `${THEME_RELEASE_BASE}/${version}/${name}`, throw: false });
    if (response.status !== 200) throw Error(`HTTP ${response.status}`);
    return response.text;
}

export async function downloadTheme(id: string, version: string, file = themeAssetName(id)): Promise<string> {
    const text = await get(version, file);
    if (!parseThemeHeader(text, `${id}.css`)) throw Error("文件不是有效的 VLOOK 主题");
    return text;
}

/** 发布页上的主题清单：[{ id, name, color, colors?, file? }]。 */
export async function fetchThemeIndex(version: string): Promise<ThemeRemote[]> {
    const data = JSON.parse(await get(version, THEME_INDEX_NAME));
    if (!Array.isArray(data)) throw Error("主题清单格式不正确");
    return data.filter(item => item && typeof item.id === "string" && item.id).map(item => ({
        id: String(item.id).toLowerCase(),
        name: typeof item.name === "string" && item.name ? item.name : String(item.id),
        color: typeof item.color === "string" ? item.color : "",
        colors: Array.isArray(item.colors) && item.colors.length === 2 ? [String(item.colors[0]), String(item.colors[1])] as [string, string] : undefined,
        file: typeof item.file === "string" ? item.file : undefined,
    }));
}
