import {isLiteralContent} from '../core/literal-dom';
// Code Magic：标签、多级标签、刮刮卡、代码式注音、普通行内代码点击复制
// 移植自 vlook.js「Code Magic 模块」

import { colorCodeOf, gradColors, isSolid, splitColors } from "../core/color";
import { copyText, keyboardCopy, h, unwrap } from "../core/dom";
import type { RenderCtx } from "../core/context";
import { openPhoneticLookup } from "./sup-sub-magic";

const BADGE_SYNTAX = /^#([^|]*)\|([^|]+)(\|([^|]+))?#$/i; // 旧语法 `#名|值|值2#`
const BADGE_VAR = /^(.*)({{.+}}|%.+%|\${.+}|#{.+}|\$.+\$|var\(.+\))(.*)$/i;
const PHONETIC_CODE = /^{(.+)}\((.+)\)$/;

let counter = 0;
const nextId = () => ++counter;

/** 读取并移除紧随其后的色号 _~Rd~_ */
function takeColor(after: Node | null): { color: string; em: boolean } | null {
    let n = after;
    // 跳过空白文本
    while (n && n.nodeType === Node.TEXT_NODE && n.textContent!.trim() === "") n = n.nextSibling;
    if (!n || n.nodeType !== Node.ELEMENT_NODE) return null;
    const set = colorCodeOf(n as Element);
    if (set) (n as Element).remove();
    return set;
}

function gradientCss(color: string): string {
    const colors = splitColors(color);
    return `background-image:linear-gradient(135deg,${gradColors(colors)})!important;`
        + (color.includes("wt") ? "border-color:var(--db)!important;" : "")
        + "box-shadow:none!important;";
}

export function buildTag(code: HTMLElement, ctx: RenderCtx): void {
    const set = takeColor(code.nextSibling);
    let color = set ? set.color : ctx.query.get("tag") ?? ctx.settings.tagDefault;
    let em = set?.em ? " em" : "";
    const id = ` id-${nextId()}`;
    if (!isSolid(color)) {
        em = " em";
        code.className = `v-tag ${splitColors(color)[0]}${em}${id}`;
        code.style.cssText += gradientCss(color);
    } else {
        code.className = `v-tag ${color}${em}${id}`;
    }
    code.setAttribute("value", code.textContent || "");
    code.addEventListener("click", () => void copyText(code, code.getAttribute("value") || ""));
    keyboardCopy(code,()=>code.getAttribute('value')||'');
}

/**
 * 多级标签：*名称`值`值2*，名称或值2 可省略
 * @param host 外层 code（替换原 em）
 * @param name 第 1 段
 * @param value 第 2 段（code 内容）
 * @param value2 第 3 段
 */
export function buildBadge(target: HTMLElement, name: string, value: string, value2: string | undefined, ctx: RenderCtx): void {
    const set = takeColor(target.nextSibling);
    let color = set ? set.color : ctx.query.get("badge") ?? ctx.settings.badgeDefault;
    // 封面（h6 首块）内未指定颜色的多级标签默认为 t2
    if (!set && target.closest(".vlook-cover")) color = "t2";
    const id = `id-${nextId()}`;
    const outer = h("code", "");
    target.replaceWith(outer);
    outer.appendChild(target);
    if (!isSolid(color) && color.length >= 4) {
        outer.className = `v-badge-name ${splitColors(color)[0]} ${id}`;
        outer.style.cssText += gradientCss(color);
    } else {
        outer.className = `v-badge-name ${color} ${id}`;
    }
    if (name.length > 0) {
        const label = h("label");
        label.textContent = name;
        outer.prepend(label);
    }
    // 第 2 段
    target.className = `v-badge-value ${id}`;
    const vm = value.match(BADGE_VAR);
    if (vm) {
        target.textContent = "";
        target.append(vm[1], Object.assign(h("span", "var"), { textContent: vm[2] }), vm[3]);
    } else {
        target.textContent = value;
    }
    target.addEventListener("click", ev => {
        ev.stopPropagation();
        void copyText(target, (target.textContent || "") + (value2 ? " " + value2 : ""));
    });
    keyboardCopy(target,()=>(target.textContent||'')+(value2?' '+value2:''),{label:'复制值及后缀'});
    // 第 3 段
    if (value2 !== undefined) {
        const v2 = h("span", `v-badge-value2 ${id}`);
        v2.textContent = value2;
        target.after(v2);
        outer.classList.add("hastwo");
        if (name.length > 0) target.classList.add("hastwo");
        v2.addEventListener("click", ev => { ev.stopPropagation(); void copyText(v2, value2); });
        keyboardCopy(v2,()=>value2,{label:'复制后缀'});
    }
    const plain = [name, value, value2].filter(Boolean).join(" ");
    outer.setAttribute("value", plain);
    outer.addEventListener("click", () => void copyText(outer, plain));
    if(name)keyboardCopy(outer,()=>plain,{role:'group',label:'复制完整徽章'});
    else {outer.setAttribute('role','group');outer.setAttribute('aria-label','徽章');}
}

export function buildScratchCard(target: HTMLElement, tip: string, hidden: string, ctx: RenderCtx): void {
    const set = takeColor(target.nextSibling);
    const color = `var(--ac-${set ? set.color : ctx.query.get("coating") ?? ctx.settings.coatingDefault})`;
    tip = tip || "••••";
    target.className = `v-coating id-${nextId()}`;
    target.dataset.coatingTip = tip;
    target.dataset.coatingHidden = hidden;
    target.dataset.coatingShow = "false";
    target.textContent = tip;
    target.style.background = coatingBg(tip.length, color);
    target.style.borderColor = color;
    target.setAttribute('role','button');
    target.tabIndex=0;
    target.setAttribute('aria-expanded','false');
    const toggle=()=>{
        const show = target.dataset.coatingShow !== "true";
        target.classList.toggle("opened", show);
        target.textContent = show ? hidden : tip;
        target.dataset.coatingShow = String(show);
        target.setAttribute('aria-expanded',String(show));
    };
    target.addEventListener("click", ev => {
        if (target.ownerDocument.defaultView?.getSelection()?.toString()) return;
        ev.stopPropagation();toggle();
    });
    target.addEventListener('keydown',ev=>{
        if(!['Enter',' '].includes(ev.key)||ev.ctrlKey||ev.metaKey||ev.altKey||ev.shiftKey||ev.isComposing)return;
        ev.preventDefault();ev.stopPropagation();
        if(!ev.repeat)toggle();
    });
}

function coatingBg(chars: number, color: string): string {
    const count = chars <= 8 ? 4 : chars <= 12 ? 8 : chars <= 20 ? 10 : 16;
    const step = 100 / count;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
        const c = i % 2 === 0 ? color : "var(--df)";
        parts.push(`${c} ${i * step}%,${c} ${i * step + step}%`);
    }
    return `linear-gradient(135deg,${parts.join(",")})`;
}

export function processCodeMagic(root: HTMLElement, ctx: RenderCtx): void {
    // 1) 普通行内代码（不在 em/strong 内）：旧语法多级标签、代码式注音、点击复制
    root.querySelectorAll<HTMLElement>("code").forEach(code => {
        if(isLiteralContent(code))return;
        if (code.closest("pre") || code.parentElement?.closest("em,strong") || code.matches('.v-tag,.v-std-code,.v-badge-name,.v-badge-value,.v-badge-value2')) return;
        const text = code.textContent || "";
        let m: RegExpMatchArray | null;
        if ((m = text.match(BADGE_SYNTAX))) {
            const span = h("span");
            code.replaceWith(span);
            buildBadge(span, m[1], m[2], m[4], ctx);
        } else if ((m = text.match(PHONETIC_CODE))) {
            const ruby = h("ruby", "", {}, "");
            ruby.append(m[1], h("rp", "", {}, "("), Object.assign(h("rt"), { textContent: m[2] }), h("rp", "", {}, ")&nbsp;"));
            const [word, sym] = [m[1], m[2]];
            ruby.querySelector("rt")!.addEventListener("click", ev => openPhoneticLookup(word, sym, ev));
            code.replaceWith(ruby);
        } else {
            code.classList.add("v-std-code", `id-${nextId()}`);
            code.addEventListener("click", () => void copyText(code, code.textContent || ""));
            keyboardCopy(code,()=>code.textContent||'');
        }
    });

    // 2) 刮刮卡：*提示**隐藏内容*** → em > [text] + strong:last-child
    root.querySelectorAll<HTMLElement>("em").forEach(em => {
        if(isLiteralContent(em))return;
        const last = em.lastElementChild;
        if (!last || last.tagName !== "STRONG" || last.nextSibling && last.nextSibling.textContent!.trim() !== "") return;
        if (em.querySelector("svg") || em.children.length !== 1) return;
        const tip = Array.from(em.childNodes).filter(n => n !== last).map(n => n.textContent).join("").trim();
        const hidden = last.textContent || "";
        const span = h("span");
        em.replaceWith(span);
        buildScratchCard(span, tip, hidden, ctx);
    });

    // 3) 多级标签（新语法）：*名称`值`值2*（em 内含 code，且有前后文字）
    root.querySelectorAll<HTMLElement>("em").forEach(em => {
        if(isLiteralContent(em))return;
        const codes = em.querySelectorAll(":scope > code");
        if (codes.length !== 1 || em.children.length !== 1) return;
        const code = codes[0] as HTMLElement;
        const before = textBetween(em.firstChild, code), after = textBetween(code.nextSibling, null);
        if (before === "" && after === "") return; // 单级标签，后面处理
        const span = h("span");
        span.textContent = code.textContent || "";
        em.replaceWith(span);
        // 只有后缀时：相当于「值`名称`」的左右反转（原版：bName 为空，值2 为后缀）
        if (before === "")
            buildBadge(span, "", code.textContent || "", after, ctx);
        else
            buildBadge(span, before, code.textContent || "", after || undefined, ctx);
    });

    // 4) 单级标签：*`标签`*
    root.querySelectorAll<HTMLElement>("em").forEach(em => {
        if(isLiteralContent(em))return;
        if (em.children.length !== 1 || em.firstElementChild!.tagName !== "CODE") return;
        if ((em.textContent || "").trim() !== (em.firstElementChild!.textContent || "").trim()) return;
        const code = em.firstElementChild as HTMLElement;
        unwrap(em);
        buildTag(code, ctx);
    });
}

function textBetween(from: Node | null, to: Node | null): string {
    let s = "";
    for (let n = from; n && n !== to; n = n.nextSibling) s += n.textContent;
    return s.trim();
}
