import {isLiteralContent} from '../core/literal-dom';
// Sup/Sub Magic：上标式注音 _^注音^_、文本颜色 / 段落着色 / 单元格着色 _~色号~_
// 移植自 vlook.js「Sup/Sub Magic 模块」

import { COLOR_SYNTAX, COLOR_SYNTAX_OLD, COLOR_TOO_LIGHT, campColor, gradColors, isSolid, parseColor, splitColors } from "../core/color";
import { h } from "../core/dom";
import type { RenderCtx } from "../core/context";

export function openPhoneticLookup(text: string, symbol: string, ev: Event): void {
    ev.stopPropagation();
    const translator = "https://www.bing.com/translator/?from=&to=zh-chs&text=";
    let url = translator + encodeURI(text);
    if (/^[぀-ヿ]/.test(symbol)) url = translator + encodeURI(symbol);
    else if (/^[一-龥]/.test(text)) url = "https://www.zdic.net/hans/" + encodeURI(text);
    const target = (ev.currentTarget || ev.target) as Node | null;
    target?.ownerDocument?.defaultView?.open(url, text);
}

/** 上标式注音：字_^zì^_ */
function buildPhonetic(sup: HTMLElement): void {
    const em = sup.parentElement!;
    const prev = em.previousSibling;
    if (!prev) return;
    // 被注音的内容：拉丁文取前一个单词，其他取最后一个字符
    let textNode: Text | null = null;
    if (prev.nodeType === Node.TEXT_NODE) textNode = prev as Text;
    else {
        // 前一个是元素（如 strong），取其最后一个文本节点
        const w = sup.ownerDocument.createTreeWalker(prev, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) textNode = n as Text;
    }
    if (!textNode || !textNode.data) return;
    const t = textNode.data;
    let word: string;
    if (/[a-z]$/i.test(t)) word = (t.match(/(\b\w+\b)$/) || ["", t.slice(-1)])[1];
    else word = Array.from(t).slice(-1)[0];
    const symbol = sup.textContent || "";
    const before = t.slice(0, t.length - word.length);
    const ruby = h("ruby");
    ruby.append(word, h("rp", "", {}, "("), Object.assign(h("rt"), { textContent: symbol }), h("rp", "", {}, ")&nbsp;"));
    ruby.querySelector("rt")!.addEventListener("click", ev => openPhoneticLookup(word, symbol, ev));
    textNode.data = before;
    textNode.after(ruby);
    em.remove();
}

function buildRainbow(colorCode: HTMLElement, colorRaw: string, emStyle: boolean): void {
    const color = colorRaw.toLowerCase().replace(/!$/, "");
    const cellMode = emStyle;
    const solid = isSolid(color);
    const grad = solid ? [] : splitColors(color);
    // 渲染目标：色号前紧邻的内容；若色号前没有内容，则为整个段落 / 单元格
    let target: HTMLElement | null = null;
    let whole = false;
    let prev = colorCode.previousSibling;
    while (prev && prev.nodeType === Node.TEXT_NODE && prev.textContent === "") prev = prev.previousSibling;
    if (!cellMode) {
        if (!prev || (prev.nodeType === Node.TEXT_NODE && prev.textContent!.trim() === "" && !prev.previousSibling)) {
            target = colorCode.parentElement;
            whole = true;
        } else if (prev.nodeType === Node.TEXT_NODE) {
            // Typora 中纯文本会被 span 包裹，这里补一个 span 以对齐行为
            const span = h("span");
            prev.parentNode!.insertBefore(span, prev);
            span.appendChild(prev);
            target = span;
        } else {
            target = prev as HTMLElement;
        }
    }
    const tag = target?.tagName.toLowerCase();

    const disposeText = (obj: HTMLElement) => {
        if (solid) {
            const tt = COLOR_TOO_LIGHT.test(color) ? "-tt" : "";
            obj.style.color = `var(--ac-${color}${tt})`;
        } else {
            const spans = obj.querySelectorAll<HTMLElement>("span");
            const list = spans.length ? Array.from(spans) : [obj];
            for (const s of list) {
                s.style.setProperty("background-image", `linear-gradient(90deg,${gradColors(grad)})`, "important");
                s.classList.add("vlook-gradient-text");
            }
        }
        obj.setAttribute(whole ? "data-rb-whole-text" : "data-rb-text", campColor(color));
    };
    const disposeUnderline = (obj: HTMLElement) => {
        if (solid) obj.style.borderColor = `var(--ac-${color})`;
        else obj.style.borderImage = `linear-gradient(90deg,${gradColors(grad)}) 0 0 1 0`;
    };
    const disposeMark = (obj: HTMLElement) => {
        if (solid) obj.style.boxShadow = `0 var(--mark-bg-h-inset) 0 0 var(--ac-${color}-fd) inset`;
        else {
            obj.style.setProperty("background", `linear-gradient(90deg,${gradColors(grad, "-fd")})0 .4375em/100% var(--mark-bg-h) no-repeat`, "important");
            obj.classList.add("vlook-no-shadow");
        }
    };
    const disposeCell = (obj: HTMLElement) => {
        if (solid) obj.style.backgroundColor = `var(--ac-${color}-fd)`;
        else obj.style.setProperty("background-image", `linear-gradient(135deg,${gradColors(grad, "-fd")})`, "important");
        obj.classList.add("vlook-no-shadow");
        obj.setAttribute("data-rb-cell-bg", campColor(color));
    };

    if (!cellMode && target) {
        if (whole) {
            target.querySelectorAll<HTMLElement>("u").forEach(disposeUnderline);
            target.querySelectorAll<HTMLElement>("mark").forEach(disposeMark);
        }
        if (tag === "mark") disposeMark(target);
        else {
            disposeText(target);
            if (tag === "u") disposeUnderline(target);
        }
    } else if (cellMode) {
        const cell = colorCode.parentElement;
        if (cell && (cell.tagName === "TD" || cell.tagName === "TH")) disposeCell(cell);
        else {
            // 非单元格中的强调色号：按文本颜色处理
            buildRainbow(colorCode, colorRaw.replace(/!$/, ""), false);
            return;
        }
    }
    colorCode.remove();
}

export function processSupSubMagic(root: HTMLElement, _ctx: RenderCtx): void {
    // 注音：em 不独占父元素，且 em 内只有 sup
    root.querySelectorAll<HTMLElement>("em > sup:only-child").forEach(sup => {
        if(isLiteralContent(sup))return;
        const em = sup.parentElement!;
        if ((em.textContent || "").trim() !== (sup.textContent || "").trim()) return;
        const p = em.parentElement!;
        const alone = Array.from(p.childNodes).every(n => n === em || (n.nodeType === Node.TEXT_NODE && !n.textContent!.trim()));
        if (!alone) buildPhonetic(sup);
    });

    // 旧语法：sub 内为 (Rd)
    root.querySelectorAll<HTMLElement>("sub").forEach(sub => {
        if(isLiteralContent(sub))return;
        const m = (sub.textContent || "").match(COLOR_SYNTAX_OLD);
        if (m && sub.textContent !== sub.parentElement?.textContent) buildRainbow(sub, m[1] + (m[m.length - 1] || ""), m[m.length - 1] === "!");
    });

    // 新语法：_~色号~_（非独占一行；独占一行的由引用块着色处理）
    root.querySelectorAll<HTMLElement>("em > sub:only-child").forEach(sub => {
        if(isLiteralContent(sub))return;
        const em = sub.parentElement!;
        if (!root.contains(em) || (em.textContent || "").trim() !== (sub.textContent || "").trim()) return;
        const set = parseColor(sub.textContent || "");
        if (!set) return;
        const p = em.parentElement!;
        if ((p.textContent || "").trim() === (sub.textContent || "").trim()) return;
        buildRainbow(em, set.color + (set.em ? "!" : ""), set.em);
    });
}

export { COLOR_SYNTAX };
