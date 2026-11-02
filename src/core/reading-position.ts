import type { MarkdownView } from 'obsidian';
import type { EditorView } from '@codemirror/view';

type ScrollMode = { getScroll(): number; applyScroll(line: number): void };
const DELAYS = [0, 60, 200, 500, 1000, 1800];

/** 编辑视图内的锚点：所在区块起点 + 区块内滚动比例，大预览区块高度变化时也能对准原处 */
type Anchor = { mode: string; line: number; pos?: number; ratio?: number };

function editorOf(view: MarkdownView): EditorView | null {
    return view.getMode?.() === 'source' ? ((view.editor as unknown as { cm?: EditorView })?.cm ?? null) : null;
}

function documentOffset(cm: EditorView): number {
    return cm.documentTop - cm.scrollDOM.getBoundingClientRect().top + cm.scrollDOM.scrollTop;
}

function capture(view: MarkdownView): Anchor {
    const anchor: Anchor = { mode: view.getMode?.() ?? '', line: (view.currentMode as unknown as ScrollMode).getScroll() };
    const cm = editorOf(view);
    if (cm) {
        const height = cm.scrollDOM.scrollTop - documentOffset(cm);
        const block = cm.lineBlockAtHeight(Math.max(0, height));
        anchor.pos = block.from;
        anchor.ratio = block.height > 0 ? Math.min(1, Math.max(0, (height - block.top) / block.height)) : 0;
    }
    return anchor;
}

function restore(view: MarkdownView, anchor: Anchor) {
    const cm = editorOf(view);
    if (cm && anchor.mode === 'source' && anchor.pos !== undefined && anchor.pos <= cm.state.doc.length) {
        const block = cm.lineBlockAt(anchor.pos);
        cm.scrollDOM.scrollTop = documentOffset(cm) + block.top + (anchor.ratio ?? 0) * block.height;
        return;
    }
    if (Number.isFinite(anchor.line) && anchor.line > 0) (view.currentMode as unknown as ScrollMode).applyScroll(anchor.line);
}

/** 切换模式、主题、明暗或字体时锁定阅读位置，直到区块渲染稳定或用户主动滚动。 */
export async function keepReadingPosition(views: MarkdownView[], change: () => unknown): Promise<void> {
    const saved = views.map(view => ({ view, anchor: capture(view) }));
    await change();
    for (const { view, anchor } of saved) hold(view, anchor);
}

function hold(view: MarkdownView, anchor: Anchor) {
    const el = view.containerEl, win = el.ownerDocument.defaultView;
    if (!win) return;
    let stopped = false;
    const events = ['wheel', 'keydown', 'pointerdown', 'touchstart'];
    const stop = () => { stopped = true; for (const name of events) el.removeEventListener(name, stop, true); };
    for (const name of events) el.addEventListener(name, stop, true);
    DELAYS.forEach((ms, i) => win.setTimeout(() => {
        if (!stopped && el.isConnected) restore(view, anchor);
        if (i === DELAYS.length - 1) stop();
    }, ms));
}
