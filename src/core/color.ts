// VLOOK™ 预置色号相关工具（移植自 vlook.js「Code Code 模块」）

export const COLOR_CODE = "(rd|ro|og|ye|la|lm|g[nyd]|aq|au|cf|cy|wt|b[unk]|se|sk|vn|p[luk]|mn|wn|ol|t[12u])";
/** 色号语法：Rd / RdGn / Rd! */
export const COLOR_SYNTAX = new RegExp(`^(${COLOR_CODE}+)(!)?$`, "i");
/** 旧色号语法：(Rd) */
export const COLOR_SYNTAX_OLD = new RegExp(`^\\((${COLOR_CODE}+)(!)?\\)$`, "i");
/** 亮度较高、用于文字时需要降低亮度的色号 */
export const COLOR_TOO_LIGHT = /ye|lm|aq|sk|la|pl|pk|gd|cy/i;

export interface ColorSet {
    /** 小写色号，如 rd、rdgn、t1 */
    color: string;
    /** 是否为强调风格（带 !） */
    em: boolean;
}

export function parseColor(text: string): ColorSet | null {
    const m = text.trim().match(COLOR_SYNTAX);
    if (!m)
        return null;
    return { color: m[1].toLowerCase(), em: m[m.length - 1] === "!" };
}

/** 是否为单色（含 t2-a 这类带后缀的主题色） */
export function isSolid(color: string): boolean {
    return color.length < 4 || color.includes("-");
}

/** 拆分渐变色：rdgnbu → [rd, gn, bu] */
export function splitColors(color: string): string[] {
    return color.toLowerCase().split(/(\S{2})/i).filter(c => c !== "");
}

/** 生成渐变色 CSS 颜色列表 */
export function gradColors(colors: string[], fade = ""): string {
    return colors.map(c => `var(--ac-${c}${fade})`).join(",");
}

/** 色号的展示格式：rdgn → RdGn */
export function campColor(color: string): string {
    if (color.length > 3)
        return splitColors(color).map(c => c[0].toUpperCase() + c.slice(1)).join("");
    return color[0].toUpperCase() + color.slice(1);
}

/** 若元素是「斜体 + 下标色号」(em>sub:only-child) 则返回色号，供标签/多级标签/刮刮卡使用 */
export function colorCodeOf(el: Element | null | undefined): ColorSet | null {
    if (!el || el.tagName !== "EM")
        return null;
    const sub = el.children.length === 1 && el.firstElementChild?.tagName === "SUB" ? el.firstElementChild : null;
    if (!sub || el.textContent!.trim() !== sub.textContent!.trim())
        return null;
    return parseColor(sub.textContent || "");
}
