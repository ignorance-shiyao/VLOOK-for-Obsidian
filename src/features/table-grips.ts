import { tableGrid } from './table-tools';
import type { TableSizes } from '../core/context';

function setStyles(el: HTMLElement, props: Record<string, string>): void { for (const [k, v] of Object.entries(props)) el.style.setProperty(k.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), v); }

export type TableReorder = (kind: 'row' | 'col', from: number, to: number) => void;
const EDGE = 6;

/** 表格悬浮手柄：拖动列/行手柄调整顺序，拖动单元格边框调整列宽与行高。 */
export function installTableGrips(table: HTMLTableElement, reorder?: TableReorder, sizes?: TableSizes): void {
    const doc = table.ownerDocument, win = doc.defaultView!;
    const host = table.parentElement;
    if (!host) return;
    if (win.getComputedStyle(host).position === 'static') host.classList.add('vlook-grip-host');
    const colGrip = doc.createElement('div'); colGrip.className = 'vlook-table-grip vlook-table-grip-col'; colGrip.title = '拖动调整列顺序';
    const rowGrip = doc.createElement('div'); rowGrip.className = 'vlook-table-grip vlook-table-grip-row'; rowGrip.title = '拖动调整行顺序';
    const line = doc.createElement('div'); line.className = 'vlook-table-drop';
    host.append(colGrip, rowGrip, line);
    let hover: HTMLTableCellElement | null = null, dragging = false;
    /** 列宽按单元格整体（含内边距）设置，并让表格总宽等于各列之和，避免切换定宽布局时整体跳动。 */
    const setCol = (cell: HTMLTableCellElement, width: string) => { cell.classList.add('vlook-grip-cell'); cell.style.setProperty('width', width); cell.style.setProperty('min-width', width); cell.style.setProperty('max-width', width); };
    const fitTable = () => {
        const cells = Array.from(new Set<HTMLTableCellElement>(tableGrid(table)[0] || [])).filter(Boolean);
        const total = cells.reduce((sum, cell) => sum + (parseFloat(cell.style.width) || cell.getBoundingClientRect().width), 0);
        if (total) { table.style.setProperty('width', `${total}px`); table.classList.add('vlook-grip-wide'); }
    };
    /** 把记录的列宽、行高套回当前表格。 */
    const applySizes = () => {
        if (!sizes) return;
        const grid = tableGrid(table);
        if (sizes.cols.some(Boolean)) {
            table.classList.add('vlook-grip-fixed');
            sizes.cols.forEach((width, c) => { const cell = grid[0]?.[c]; if (cell && width) setCol(cell, width); });
            fitTable();
        }
        sizes.rows.forEach((height, r) => { const row = table.rows[r]; if (row && height) row.style.setProperty('height', height); });
    };
    const remember = () => {
        if (!sizes) return;
        const grid = tableGrid(table);
        sizes.cols = (grid[0] || []).map(cell => cell?.style.width || null);
        sizes.rows = Array.from(table.rows, row => row.style.height || null);
    };
    applySizes();
    const hostBox = () => host.getBoundingClientRect();
    const own = (cell: Element | null) => { const c = cell?.closest<HTMLTableCellElement>('td,th') ?? null; return c && c.closest('table') === table ? c : null; };
    const place = () => {
        const on = !!hover && !!reorder;
        colGrip.classList.toggle('is-shown', on); rowGrip.classList.toggle('is-shown', on && hover!.parentElement !== table.rows[0]);
        if (!hover || !reorder) return;
        const base = hostBox(), cell = hover.getBoundingClientRect(), row = hover.parentElement!.getBoundingClientRect(), tbl = table.getBoundingClientRect();
        colGrip.style.setProperty('left', `${cell.left - base.left + cell.width / 2 - 14}px`); colGrip.style.setProperty('top', `${tbl.top - base.top - 9}px`);
        rowGrip.style.setProperty('top', `${row.top - base.top + row.height / 2 - 14}px`); rowGrip.style.setProperty('left', `${tbl.left - base.left - 9}px`);
    };
    const edgeAt = (event: PointerEvent) => {
        const cell = own(event.target as Element); if (!cell) return null;
        const box = cell.getBoundingClientRect();
        if (box.right - event.clientX <= EDGE) return { cell, axis: 'col' as const };
        if (box.bottom - event.clientY <= EDGE) return { cell, axis: 'row' as const };
        return null;
    };
    table.addEventListener('pointermove', event => {
        if (dragging) return;
        const cell = own(event.target as Element);
        if (cell !== hover) { hover = cell; place(); }
        if (!event.buttons) { const edge = edgeAt(event); table.style.setProperty('cursor', edge ? (edge.axis === 'col' ? 'col-resize' : 'row-resize') : ''); }
    });
    host.addEventListener('pointerleave', () => { if (!dragging) { hover = null; place(); } });
    table.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const edge = edgeAt(event); if (!edge) return;
        event.preventDefault(); event.stopPropagation();
        const { cell, axis } = edge, grid = tableGrid(table), r = grid.findIndex(row => row.includes(cell));
        const lastCol = grid[r].lastIndexOf(cell), startX = event.clientX, startY = event.clientY;
        const startW = cell.getBoundingClientRect().width, startH = cell.parentElement!.getBoundingClientRect().height;
        if (axis === 'col') {
            // 先按当前渲染宽度冻结每一列，再切换为定宽布局
            const frozen = Array.from(new Set(grid[0] || [])).filter(Boolean).map(other => [other, `${other.getBoundingClientRect().width}px`] as const);
            frozen.forEach(([other, width]) => setCol(other, width));
            fitTable();
            table.classList.add('vlook-grip-fixed');
        }
        const move = (e: PointerEvent) => {
            if (axis === 'col') {
                const width = `${Math.max(24, Math.round(startW + e.clientX - startX))}px`, owner = grid[0]?.[lastCol] || cell;
                setCol(owner, width); fitTable();
            } else (cell.parentElement as HTMLElement).style.setProperty('height', `${Math.max(16, Math.round(startH + e.clientY - startY))}px`);
            place();
        };
        const up = () => { win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', up); remember(); };
        win.addEventListener('pointermove', move); win.addEventListener('pointerup', up);
    }, true);
    const drag = (grip: HTMLElement, kind: 'row' | 'col') => grip.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !hover || !reorder) return;
        event.preventDefault(); event.stopPropagation();
        const grid = tableGrid(table), source = hover;
        const r = grid.findIndex(row => row.includes(source)), c = grid[r].indexOf(source);
        const from = kind === 'col' ? c : r;
        const cells = kind === 'col' ? (grid[0] || []) : table.rows;
        const spans = Array.from(cells as ArrayLike<Element>, el => el.getBoundingClientRect());
        let to = from; dragging = true; grip.classList.add('is-dragging'); table.classList.add('vlook-table-reordering');
        const base = () => hostBox(), tbl = () => table.getBoundingClientRect();
        const show = () => {
            const b = base(), t = tbl(), box = spans[to];
            line.classList.add('is-shown');
            if (kind === 'col') setStyles(line, { left: `${(to > from ? box.right : box.left) - b.left - 1}px`, top: `${t.top - b.top}px`, width: '2px', height: `${t.height}px` });
            else setStyles(line, { left: `${t.left - b.left}px`, top: `${(to > from ? box.bottom : box.top) - b.top - 1}px`, width: `${t.width}px`, height: '2px' });
        };
        const move = (e: PointerEvent) => {
            const pos = kind === 'col' ? e.clientX : e.clientY;
            const index = spans.findIndex(box => pos < (kind === 'col' ? box.right : box.bottom));
            to = index < 0 ? spans.length - 1 : index; if (kind === 'row' && to < 1) to = 1;
            show();
        };
        const up = () => {
            win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', up);
            dragging = false; grip.classList.remove('is-dragging'); table.classList.remove('vlook-table-reordering'); line.classList.remove('is-shown');
            // DOM 行序号 → 源码序号：分隔行占第 2 行
            const src = (i: number) => kind === 'row' && i > 0 ? i + 1 : i;
            if (to !== from) {
                // 列宽、行高跟着被移动的列/行走
                if (sizes) { const list = kind === 'col' ? sizes.cols : sizes.rows; if (list.length > Math.max(from, to)) list.splice(to, 0, ...list.splice(from, 1)); }
                reorder(kind, src(from), src(to));
            }
        };
        win.addEventListener('pointermove', move); win.addEventListener('pointerup', up); move(event);
    });
    drag(colGrip, 'col'); drag(rowGrip, 'row');
}
