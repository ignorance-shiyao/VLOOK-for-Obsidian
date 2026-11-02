// 章节标题自动编号（移植自 vlook.js「章节标题自动编号增强类」）
// 模板语法：h1{{前缀#格式#后缀}},h2{{...}}，格式：# zh ZH alpha ALPHA roman ROMAN none，
// 扩展：#00## 左补零，-min 单级显示，-sup 双级显示

const TPL_SYNTAX = /h([1-6]){{(.*)(#(0*)(#|zh|ZH|alpha|ALPHA|roman|ROMAN|none)(-min|-sup)?#)(.*)}}/;
const DEFAULT_TPL = "h1{{###. }},h2{{### }},h3{{### }},h4{{### }},h5{{### }},h6{{#none# }}";

const OPT_NONE = 0, OPT_MIN = 1, OPT_SUP = 2;

export interface HeaderTemplate {
    prefix: string[];
    leftPad: string[];
    format: string[];
    opt: number[];
    suffix: string[];
}

export function parseHeaderTemplate(tpl?: string | null): HeaderTemplate | null {
    if (!tpl || !tpl.trim())
        return null;
    const set = DEFAULT_TPL.split(",");
    for (const item of tpl.split(",")) {
        const lv = Number(item.trim().slice(1, 2));
        if (!isNaN(lv) && lv >= 1 && lv <= 6)
            set[lv - 1] = item.trim();
    }
    const t: HeaderTemplate = { prefix: [], leftPad: [], format: [], opt: [], suffix: [] };
    for (let lv = 0; lv < 6; lv++) {
        const m = set[lv].match(TPL_SYNTAX);
        t.prefix[lv] = m ? m[2] : "";
        t.leftPad[lv] = m ? m[4] : "";
        t.format[lv] = m ? m[5] : "#";
        t.opt[lv] = !m ? OPT_NONE : m[6] === "-min" ? OPT_MIN : m[6] === "-sup" ? OPT_SUP : OPT_NONE;
        t.suffix[lv] = m ? m[7] : "";
    }
    return t;
}

export class HeaderNumberer {
    private counter = [0, 0, 0, 0, 0, 0];
    private lastLevel = 1;
    private readonly t: HeaderTemplate;

    constructor(t: HeaderTemplate | null) {
        this.t = t ?? parseHeaderTemplate(DEFAULT_TPL)!;
    }

    next(level: number): { text: string; normal: string } {
        const diff = level - this.lastLevel;
        if (diff > 0)
            for (let i = 0; i < diff; i++) this.push();
        else if (diff < 0)
            for (let i = 0; i < -diff; i++) this.pop();
        else
            this.counter[this.lastLevel - 1]++;
        return { text: this.toString(), normal: this.toNormal() };
    }

    h6Prefix(): string {
        return this.t.prefix[5];
    }

    private push() {
        this.lastLevel++;
        this.counter[this.lastLevel - 1] = 1;
    }

    private pop() {
        this.counter[this.lastLevel - 1] = 0;
        this.lastLevel--;
        this.counter[this.lastLevel - 1]++;
    }

    private toNormal(): string {
        const lv = this.lastLevel - 1;
        let s = "";
        for (let i = 0; i < this.lastLevel; i++) {
            const str = this.formatNum(i, OPT_NONE, "#");
            s += str;
            if (i < lv && str.length > 0) s += ".";
        }
        return s;
    }

    private toString(): string {
        const lv = this.lastLevel - 1, superLv = lv > 0 ? lv - 1 : -1, opt = this.t.opt[lv];
        let s = "";
        if (opt > OPT_NONE) {
            if (opt === OPT_SUP && superLv >= 0)
                s = this.formatNum(superLv, opt) + ".";
            s += this.formatNum(lv, opt);
            return this.t.prefix[lv] + s + this.t.suffix[lv];
        }
        for (let i = 0; i < this.lastLevel; i++) {
            const str = this.formatNum(i, OPT_NONE);
            s += str;
            if (i < lv && str.length > 0) s += ".";
        }
        return this.t.prefix[lv] + s + this.t.suffix[lv];
    }

    private formatNum(i: number, opt: number, format?: string): string {
        const counter = this.counter[i];
        const upper = /[A-Z]/.test(this.t.format[i].slice(0, 1));
        const f = format ?? this.t.format[i].toLowerCase();
        const single = this.lastLevel === 1;
        switch (f) {
            case "#":
                return single ? this.pad(counter, i) : i === 0 ? String(counter) : this.pad(counter, i);
            case "zh":
                return single ? decimalToZh(counter, upper) : this.pad(counter, i);
            case "alpha":
                return single || opt > OPT_NONE ? decimalToAlpha(counter, upper) : this.pad(counter, i);
            case "roman":
                return single || opt > OPT_NONE ? decimalToRoman(counter, upper) : this.pad(counter, i);
            case "none":
            case "off":
                return "";
            default:
                return String(counter);
        }
    }

    private pad(value: number, lv: number): string {
        const gap = this.t.leftPad[lv].length - String(value).length;
        return (gap > 0 ? "0".repeat(gap) : "") + value;
    }
}

const ZH_NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const ZH_UNIT = ["", "十", "百", "千", "万"];

export function decimalToZh(num: number, upper: boolean): string {
    const numToZh = (value: number | string): string => {
        const arr = String(value).split("").reverse().map(Number);
        let out = "";
        for (let i = 0; i < arr.length; i++) {
            out = ((i === 0 && arr[i] === 0) ? ""
                : (i > 0 && arr[i] === 0 && arr[i - 1] === 0) ? ""
                    : ZH_NUM[arr[i]] + (arr[i] === 0 ? ZH_UNIT[0] : ZH_UNIT[i])) + out;
        }
        return out;
    };
    const overWan = Math.floor(num / 10000);
    let noWan: number | string = num % 10000;
    if (String(noWan).length < 4) noWan = "0" + noWan;
    let s = overWan ? numToZh(overWan) + "万" + numToZh(noWan) : numToZh(num);
    if (num >= 10 && num <= 19) s = s.replace("一十", "十");
    if (num % 10 === 0 && num < 100) s = s.replace("十零", "十");
    if (!upper)
        return s;
    const map: Record<string, string> = { 一: "壹", 二: "贰", 三: "叁", 四: "肆", 五: "伍", 六: "陆", 七: "柒", 八: "捌", 九: "玖", 十: "拾", 百: "佰", 千: "仟" };
    return s.replace(/[一二三四五六七八九十百千]/g, c => map[c]);
}

export function decimalToAlpha(value: number, upper: boolean): string {
    let s = "";
    while (value > 0) {
        let m = value % 26;
        if (m === 0) m = 26;
        s = String.fromCharCode(64 + m) + s;
        value = (value - m) / 26;
    }
    return upper ? s : s.toLowerCase();
}

const ROMAN = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"];
const ROMAN_AREA = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];

export function decimalToRoman(value: number, upper: boolean): string {
    if (value <= 0 || value >= 4000)
        return String(value);
    let s = "";
    for (let i = 0; i < ROMAN.length; i++)
        while (value >= ROMAN_AREA[i]) { value -= ROMAN_AREA[i]; s += ROMAN[i]; }
    return upper ? s : s.toLowerCase();
}
