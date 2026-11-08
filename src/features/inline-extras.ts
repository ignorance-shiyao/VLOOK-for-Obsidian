import {isLiteralContent} from '../core/literal-dom';
import {sourceTaskPercent} from '../core/task-source';
// 进度条 **==数值==**、面包屑 *==A > B > C==*（非独占一行）
// 移植自 vlook.js「进度条」「分步分级类」

import { copyText, keyboardCopy, h, setHtml } from "../core/dom";
import type { RenderCtx } from "../core/context";

let pgCount = 0, bcCount = 0;
const progressStates = new WeakMap<HTMLElement, { id: string }>();
const PG_COLORS = ["og", "gn", "bu", "vn", "pu", "bk"];

export function progressValue(value:string):number|null {
    if(!/^[-+]?\d+(?:\.\d+)?$/.test(value.trim()))return null;
    const number=Number(value);return Number.isFinite(number)?number:null;
}

export function buildProgress(strong: HTMLElement, value: number): void {
    const label = strong.querySelector("label");
    if (!label) return;
    const previous = progressStates.get(strong);
    if (previous) strong.classList.remove(previous.id);
    const state = { id: `id-${++pgCount}` };
    progressStates.set(strong, state);
    strong.classList.add("v-pgbar", state.id);
    label.style.removeProperty('box-shadow');
    label.style.removeProperty('margin-left');
    label.style.removeProperty('margin-right');
    let rb = strong.getAttribute("data-rb-text");
    const auto = rb === null;
    if (auto) {
        rb = value < 0 ? "rd" : value === 0 ? "gy" : value > 100 ? "ro" : PG_COLORS[Math.min(5, Math.floor(value / 20))];
    } else {
        rb = rb!.toLowerCase();
    }
    let color = `var(--ac-${rb})`;
    const colorAlt = `var(--ac-${rb}-a-lg)`;
    if (auto) strong.style.setProperty('color', color);
    let outline = "solid";
    const v = Math.max(0, Math.min(100, value));
    // 超出 0~100 的部分需要实际宽度，等渲染完成后再计算
    if (value > 100 || value < 0) {
        const shadowColor=color;
        if (value < 0) { color = colorAlt; outline = "dashed"; }
        const win = strong.ownerDocument.defaultView;
        win?.requestAnimationFrame(() => {
            if (progressStates.get(strong) !== state || strong.querySelector("label") !== label || strong.ownerDocument.defaultView !== win) return;
            const width = label.getBoundingClientRect().width || 100;
            const ow = parseInt(win.getComputedStyle(label).outlineWidth) || 0;
            const over = (value > 100 ? value - 100 : value) / 100 * width;
            label.style.setProperty('box-shadow', `${over + ow}px 0 0 0 ${shadowColor}`);
            if (value > 100) label.style.setProperty('margin-right', `${over + 5}px`);
            else label.style.setProperty('margin-left', `${Math.abs(over)}px`);
        });
    }
    label.style.setProperty('background', `linear-gradient(90deg, ${color} ${v}%, var(--db) ${v}%, var(--db) 100%)`);
    label.style.setProperty('outline-style', outline);
}

/** 统计任务清单完成度（只统计叶子任务） */
function taskPercent(list: Element): number | null {
    const leaves = Array.from(list.querySelectorAll("li")).filter(li => !li.querySelector("ul,ol"));
    if (!leaves.length) return null;
    const done = leaves.filter(li => {
        const input=Array.from(li.querySelectorAll<HTMLInputElement>('input[type=checkbox]')).find(input=>input.closest('li')===li);
        return input?input.checked:li.classList.contains("is-checked") || li.getAttribute("data-task")?.toLowerCase() === "x" || li.classList.contains("task-list-done");
    }).length;
    return Math.min(100, Number((done / leaves.length * 100).toFixed(1)));
}

/** 从源码统计紧随其后的任务列表（阅读视图中段落与列表分属不同块） */
export function taskPercentFromSource(ctx: RenderCtx): number | null {
    const idx = ctx.index, b = ctx.block;
    if (!idx || !b) return null;
    const next = idx.blocks[idx.indexOf(b) + 1];
    if (!next || next.type !== "list") return null;
    return sourceTaskPercent(next.text);
}

/** Tight lists put text directly in li; loose lists add a paragraph wrapper. */
function followingTaskList(strong:HTMLElement):Element|null {
    const host=strong.closest('p,li,h1,h2,h3,h4,h5,h6');
    if(!host)return null;
    let sibling:Element|null;
    if(host.tagName==='LI'){
        const child=Array.from(host.children).find(child=>child===strong||child.contains(strong));
        sibling=child?.nextElementSibling||null;
    }else sibling=host.nextElementSibling;
    return sibling&&/^(UL|OL)$/.test(sibling.tagName)?sibling:null;
}

/** 勾选任务后，同步紧邻其前的「任务进度」条。 */
export function refreshTaskProgress(input: Element): void {
    let top: Element | null = input.closest("ul,ol");
    if (!top) return;
    for (let up = top.parentElement?.closest("ul,ol"); up; up = top.parentElement?.closest("ul,ol")) top = up;
    const find = (host: Element | null) => host?.querySelector<HTMLElement>("strong[data-vlook-task-follow]") ?? null;
    const strong = find(top.previousElementSibling) ?? find(top.parentElement?.previousElementSibling ?? null);
    const num = taskPercent(top);
    if (!strong || num === null) return;
    strong.replaceChildren(h("label"), String(num));
    buildProgress(strong, num);
}

export function processProgress(root: HTMLElement, ctx: RenderCtx): void {
    root.querySelectorAll<HTMLElement>("strong > mark:only-child").forEach(mark => {
        if(isLiteralContent(mark))return;
        const strong = mark.parentElement!;
        const value = (strong.textContent || "").trim();
        if ((mark.textContent || "").trim() !== value) return;
        let num: number | null = null;
        num=progressValue(value);
        if (num===null && (value === "?" || value === "？")) {
            const list=followingTaskList(strong);
            num = list ? taskPercent(list) : null;
            if (num === null && !strong.closest("li")) num = taskPercentFromSource(ctx);
            if (num !== null) strong.dataset.vlookTaskFollow = "";
        }
        if (num === null) return;
        strong.replaceChildren();
        strong.append(h("label"), String(num));
        buildProgress(strong, num);
    });
}

const BC_SYNTAX = /(\s*(\/|\\|▸|▶︎|(&gt;)+|(-&gt;)|→)\s*)(?![^<>]*>)/g;

export function processBreadcrumb(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>("em > mark:only-child").forEach(mark => {
        if(isLiteralContent(mark))return;
        const em = mark.parentElement!;
        if ((em.textContent || "").trim() !== (mark.textContent || "").trim()) return;
        // 独占一行的是题注语法，由题注模块处理
        const p = em.parentElement!;
        if (p.tagName === "P" && (p.textContent || "").trim() === (em.textContent || "").trim()) return;
        // 起始内容不能带格式
        if (mark.firstChild?.nodeType !== Node.TEXT_NODE) return;
        bcCount++;
        const span = h("span", `v-stepwise id-${bcCount}`);
        span.setAttribute("data-clipboard-text", mark.textContent || "");
        setHtml(span, mark.innerHTML.replace(BC_SYNTAX, "<label> </label>"));
        em.replaceWith(span);
        span.addEventListener("click", () => void copyText(span, span.getAttribute("data-clipboard-text") || ""));
        keyboardCopy(span,()=>span.getAttribute('data-clipboard-text')||'');
        span.querySelectorAll("a").forEach(a => a.addEventListener("click", ev => ev.stopPropagation()));
    });
}
