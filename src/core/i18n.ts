// 简易多语言：中文 / 英文（与 VLOOK 内置文本一致）
import { getLanguage } from "obsidian";

export function currentLang(): string {
    return (getLanguage() || "en").toLowerCase();
}

const zh = (): boolean => currentLang().startsWith("zh");

const TEXT = {
    table: ["表", "Table"],
    codeblock: ["代码块", "Code Block"],
    figure: ["图", "Figure"],
    audio: ["音频", "Audio"],
    video: ["视频", "Video"],
    formula: ["公式", "Formula"],
    postcard: ["明信片", "Postcard"],
    switchTabs: ["切换页签", "Switch tabs"],
    columnsOfQuote: ["栏引用块", "Columns of Quote"],
    columnsOfList: ["栏列表", "Columns of List"],
    note: ["提醒", "Note"],
    tip: ["建议", "Tip"],
    important: ["重要", "Important"],
    warning: ["警告", "Warning"],
    caution: ["注意", "Caution"],
} as const;

export type TextKey = keyof typeof TEXT;

export function t(key: TextKey): string {
    return TEXT[key][zh() ? 0 : 1];
}
