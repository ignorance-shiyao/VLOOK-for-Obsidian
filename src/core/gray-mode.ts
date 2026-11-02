// Gray Mode：按日期整页灰度显示。语法：月-日:标题@语言代码；多个日期以英文分号分隔。
export interface GrayDay { month: number; day: number; title: string; langs: string[] }

/** 原版内置：面向中文用户的国家公祭日与清明节 */
const BUILTIN_GRAY_DAYS = "12-13:国家公祭日@zh;04-05:清明节@zh";

export function parseGrayDays(value: unknown): GrayDay[] {
    const text = Array.isArray(value) ? value.join(";") : typeof value === "string" ? value : "";
    const days: GrayDay[] = [];
    for (const part of text.split(";")) {
        const m = part.trim().match(/^(\d{1,2})-(\d{1,2})(?::([^@]*))?(?:@(.+))?$/);
        if (!m) continue;
        const month = Number(m[1]), day = Number(m[2]);
        if (month < 1 || month > 12 || day < 1 || day > 31) continue;
        days.push({ month, day, title: (m[3] ?? "").trim(), langs: (m[4] ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean) });
    }
    return days;
}

function languageMatches(day: GrayDay, language: string): boolean {
    if (!day.langs.length) return true;
    const lang = language.toLowerCase();
    return day.langs.some(l => lang === l || lang.startsWith(l + "-") || lang.startsWith(l + "_"));
}

/** gray：off 关闭；force 强制开启；其余（on）按日期判断。 */
export function grayModeActive(option: string | null, custom: unknown, date: Date, language: string): boolean {
    if (option === "off") return false;
    if (option === "force") return true;
    return [...parseGrayDays(BUILTIN_GRAY_DAYS), ...parseGrayDays(custom)]
        .some(d => d.month === date.getMonth() + 1 && d.day === date.getDate() && languageMatches(d, language));
}
