import { finishRenderMath, renderMath } from "obsidian";

// \ce{… $…$ …} 这类公式内部含 $：宿主在第一个内部 $ 处截断，
// 得到「未闭合的公式 + 普通文本 + 公式」。按大括号配平把这几段重新拼回一条公式。

const ERROR = "[data-mjx-error]";
const MAX_PIECES = 9;

function depth(tex: string): number {
    let level = 0;
    for (let i = 0; i < tex.length; i++) {
        const c = tex[i];
        if (c === "\\") { i++; continue; }
        if (c === "{") level++; else if (c === "}") level--;
    }
    return level;
}

/** 宿主把行内公式包在 span.math 里；以该包裹节点（没有则以容器本身）作为拼接单位。 */
function unitOf(container: HTMLElement): HTMLElement {
    const wrapper = container.parentElement;
    return wrapper?.matches("span.math") && wrapper.childNodes.length === 1 ? wrapper : container;
}

function mathPiece(node: Node): { tex: string; unit: HTMLElement } | null {
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as HTMLElement;
    const container = el.matches("mjx-container") ? el : el.matches("span.math") && el.childNodes.length === 1 ? el.firstElementChild as HTMLElement | null : null;
    if (!container?.matches("mjx-container") || container.getAttribute("display") === "true") return null;
    const error = container.querySelector(ERROR);
    return error ? { tex: error.textContent || "", unit: el } : null;
}

function replaceWithMath(target: HTMLElement, tex: string): boolean {
    const next = renderMath(tex, false);
    const rendered = next.matches("mjx-container") ? next : next.querySelector("mjx-container") ?? next;
    if (rendered.querySelector(ERROR)) return false;
    if (target.matches("span.math")) { target.replaceChildren(rendered); return true; }
    target.replaceWith(rendered);
    return true;
}

export function repairNestedMath(root: HTMLElement): number {
    let repaired = 0;
    Array.from(root.querySelectorAll<HTMLElement>("mjx-container")).filter(c => c.querySelector(ERROR)).forEach(container => {
        const first = unitOf(container);
        if (!first.parentNode) return;
        const head = mathPiece(first);
        if (!head || depth(head.tex) <= 0) return;
        // 形态一：宿主把第二个内部 $ 当作结束符，剩余的 }}$ 留在后续文本里
        const following = first.nextSibling;
        if (following?.nodeType === Node.TEXT_NODE) {
            const text = following.textContent || "";
            for (let i = text.indexOf("$"); i >= 0; i = text.indexOf("$", i + 1)) {
                const joined = `${head.tex}$${text.slice(0, i)}`;
                if (depth(joined) !== 0) continue;
                if (replaceWithMath(first, joined)) { following.textContent = text.slice(i + 1); repaired++; }
                return;
            }
        }
        // 形态二：公式、文本、公式三段
        const nodes: Node[] = [first];
        let tex = head.tex, node = first.nextSibling, expectText = true;
        while (node && nodes.length < MAX_PIECES) {
            if (expectText) {
                if (node.nodeType !== Node.TEXT_NODE) return;
                tex += `$${node.textContent || ""}`;
            } else {
                const piece = mathPiece(node);
                if (!piece) return;
                tex += `$${piece.tex}`;
            }
            nodes.push(node);
            if (!expectText && depth(tex) <= 0) break;
            expectText = !expectText;
            node = node.nextSibling;
        }
        if (expectText === true || depth(tex) !== 0 || nodes.length < 3) return;
        if (!replaceWithMath(first, tex)) return;
        nodes.slice(1).forEach(n => n.parentNode?.removeChild(n));
        repaired++;
    });
    if (repaired) void finishRenderMath();
    return repaired;
}
