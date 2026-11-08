import { finishRenderMath, renderMath } from 'obsidian';

type Tags = { allLabels?: Record<string, unknown>; labels?: Record<string, unknown> };
type MathWindow = Window & typeof globalThis & { MathJax?: { startup?: { input?: { parseOptions?: { tags?: Tags } }[] } } };

const DUPLICATE = '[data-mjx-error*="multiply defined"]';

/** 宿主 MathJax 全局保留 \label 登记，同一公式在视图切换或分段重绘时再次渲染会报 multiply defined。
 *  出现该错误时只移除这条公式自身的标签登记并重新渲染。 */
export function repairDuplicateMathLabels(root: ParentNode, win: MathWindow): number {
    const tags = win.MathJax?.startup?.input?.[0]?.parseOptions?.tags;
    if (!tags) return 0;
    let repaired = 0;
    root.querySelectorAll<HTMLElement>(DUPLICATE).forEach(error => {
        const container = error.closest<HTMLElement>('mjx-container');
        if (!container?.parentElement) return;
        const tex = error.textContent || '';
        for (const match of tex.matchAll(/\\label\s*\{([^{}]*)\}/g)) {
            delete tags.allLabels?.[match[1]];
            delete tags.labels?.[match[1]];
        }
        const next = renderMath(tex, container.getAttribute('display') === 'true');
        const rendered = next.matches('mjx-container') ? next : next.querySelector('mjx-container') ?? next;
        if (rendered.querySelector(DUPLICATE)) return;
        container.replaceWith(rendered);
        repaired++;
    });
    if (repaired) void finishRenderMath();
    return repaired;
}

export function watchDuplicateMathLabels(doc: Document): () => void {
    const win = doc.defaultView;
    if (!win) return () => {};
    let queued = false;
    const run = () => { queued = false; repairDuplicateMathLabels(doc.body, win); observer.takeRecords(); };
    const observer = new win.MutationObserver(records => {
        if (queued) return;
        // 只检查新增节点，避免长文档重绘期间每一批变更都全量扫描 body
        const added = records.some(record => Array.from(record.addedNodes).some(node => node instanceof win.Element && (node.matches(DUPLICATE) || !!node.querySelector(DUPLICATE))));
        if (!added) return;
        queued = true; win.setTimeout(run);
    });
    observer.observe(doc.body, { subtree: true, childList: true });
    run();
    return () => observer.disconnect();
}
