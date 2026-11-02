import type { RenderCtx } from '../core/context';

/** 与原版 Print_genPageBreak 一致：仅独占段落的 ---page 生效。 */
export function processPageBreaks(root: HTMLElement, ctx: RenderCtx): void {
    if (ctx.block && ctx.block.type !== 'paragraph') return;
    for (const paragraph of root.querySelectorAll<HTMLElement>(':scope > p')) {
        if (paragraph.textContent?.trim() !== '---page' || paragraph.querySelector('code, a, em, strong')) continue;
        paragraph.classList.add('v-page-break');
        paragraph.setAttribute('aria-label', '分页标记');
    }
}
