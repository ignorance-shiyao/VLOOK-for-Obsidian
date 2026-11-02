// 带编号的宽公式：超出行宽时按比例缩小字号，右侧编号完整可见

import type { RenderCtx } from "../core/context";

const fitted = new WeakSet<HTMLElement>();
const MIN_SCALE = 0.6;

function fit(container: HTMLElement, host: HTMLElement) {
    container.style.removeProperty("font-size");
    const limit = Math.min(host.getBoundingClientRect().right, container.getBoundingClientRect().right);
    const left = container.getBoundingClientRect().left;
    let right = 0;
    container.querySelectorAll("mjx-labels, mjx-mtd, mjx-math").forEach(node => { right = Math.max(right, node.getBoundingClientRect().right); });
    if (!right || right <= limit + 1 || limit <= left) return;
    container.style.setProperty("font-size", `${Math.max(MIN_SCALE, (limit - left) / (right - left)) * 100}%`);
}

export function processMathFit(el: HTMLElement, ctx: RenderCtx): void {
    if (fitted.has(el) || !el.querySelector('mjx-container[display="true"], .math-block')) return;
    fitted.add(el);
    const win = el.ownerDocument.defaultView;
    if (!win || typeof win.ResizeObserver === "undefined") return;
    let width = 0;
    const observer = new win.ResizeObserver(([entry]) => {
        const w = Math.round(entry.contentRect.width);
        if (w === width) return;
        width = w;
        el.querySelectorAll<HTMLElement>('mjx-container[display="true"]').forEach(c => { if (c.querySelector("mjx-labels, mjx-mlabeledtr")) fit(c, el); });
    });
    observer.observe(el);
    ctx.registerCleanup?.(() => { observer.disconnect(); fitted.delete(el); });
}
