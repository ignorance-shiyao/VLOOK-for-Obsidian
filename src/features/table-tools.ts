import type { TableSizes } from '../core/context';
import { installTableGrips } from './table-grips';
import { viewMenuItem, viewMenuSection } from './view-menu';
/** 原生表格内容助手：换行、冻结列、十字阅读及键盘导航。 */
export function tableGrid(table: HTMLTableElement): HTMLTableCellElement[][] {
    const grid: HTMLTableCellElement[][] = [];
    Array.from(table.rows).forEach((row, r) => {
        grid[r] ||= [];
        let c = 0;
        const groupRows=Array.from(row.parentElement!.children).filter(child=>child.tagName==='TR');
        const remaining=groupRows.length-groupRows.indexOf(row);
        for (const cell of Array.from(row.cells)) {
            while (grid[r][c]) c++;
            // HTML rowspan 不跨 thead/tbody/tfoot；超大值同样截断到当前行组。
            const height = cell.rowSpan === 0 ? remaining : Math.min(cell.rowSpan, remaining);
            for (let y = r; y < r + height; y++) {
                grid[y] ||= [];
                for (let x = c; x < c + cell.colSpan; x++) grid[y][x] = cell;
            }
            c += cell.colSpan;
        }
    });
    return grid;
}

export function processTableTools(root: HTMLElement, readingDefault = false, reorder?: (table: HTMLTableElement, kind: 'row' | 'col', from: number, to: number) => void, sizes?: TableSizes): void {
    root.querySelectorAll<HTMLTableElement>('table').forEach(table => {
        if (table.dataset.vlookTools) return;
        table.dataset.vlookTools = '1';
        installTableGrips(table, reorder && !table.parentElement?.closest('table') ? (kind, from, to) => reorder(table, kind, from, to) : undefined, sizes);
        const tools = viewMenuSection(table, 'vlook-table-tools', '表格操作', 2);
        const icons: Record<string, string> = {'自动换行':'wrap-text','冻结首列':'panel-left','展开全部分组':'chevrons-up-down','收起全部分组':'chevrons-down-up','十字阅读':'crosshair'};
        const button = (label: string, pressed: boolean|null, action: (button: HTMLButtonElement) => void) =>
            viewMenuItem(tools, label, icons[label] || 'table', action, pressed);
        button('自动换行', false, b => {
            const on = table.classList.toggle('vlook-table-wrap');
            table.classList.toggle('vlook-table-nowrap', !on);
            b.setAttribute('aria-pressed', String(on));
        });
        button('冻结首列', table.classList.contains('v-freeze'), b => {
            const on = table.classList.toggle('v-freeze');
            table.classList.toggle('vlook-table-freeze', on);
            table.classList.toggle('vlook-table-unfreeze', !on);
            b.setAttribute('aria-pressed', String(on));
        });
        if(table.dataset.rowGroup==='true'){
            const setGroups=(open:boolean)=>{
                const rows=Array.from(table.querySelectorAll<HTMLElement>('tr[data-folder="true"]')).filter(row=>row.closest('table')===table);
                for(const row of rows){
                    if((row.dataset.rowFolded==='true')!==open)continue;
                    const controls=Array.from(row.querySelectorAll<HTMLElement>('.v-tbl-row-g-btn')).filter(control=>control.closest('table')===table);
                    const control=controls[controls.length-1];
                    control?.click();
                }
            };
            button('展开全部分组',null,()=>setGroups(true));
            button('收起全部分组',null,()=>setGroups(false));
        }
        let enabled = false;
        let current: HTMLTableCellElement | null = null;
        let position = {r:0, c:0};
        const originalTabindex=table.getAttribute('tabindex');
        const visible=(row:HTMLElement|undefined|null)=>{
            for(let node=row;node&&node!==table;node=node.parentElement){
                if(node.hidden||node.classList.contains('vlook-row-folded'))return false;
                const display=node.ownerDocument.defaultView?.getComputedStyle(node).display||node.style.display;
                if(display==='none'||display==='table-column')return false;
            }
            return !!row;
        };
        const clear = () => {
            table.querySelectorAll('.vlook-table-axis,.vlook-table-current').forEach(cell => {if(cell.closest('table')===table)cell.classList.remove('vlook-table-axis', 'vlook-table-current');});
            current = null;
        };
        const select = (cell: HTMLTableCellElement, r?:number, c?:number) => {
            clear(); current = cell;
            const grid = tableGrid(table);
            if (r === undefined || c === undefined) {
                r = grid.findIndex(row => row.includes(cell));
                c = grid[r]?.indexOf(cell) ?? 0;
            }
            position = {r, c};
            grid.forEach((row, y) => row.forEach((other, x) => {
                if (y === r || x === c) other.classList.add('vlook-table-axis');
            }));
            cell.classList.add('vlook-table-current');
        };
        const readingButton=button('十字阅读', false, () => setReading(!enabled));
        function setReading(on:boolean,focus=true){
            enabled = on;
            readingButton.setAttribute('aria-pressed', String(enabled));
            table.classList.toggle('vlook-table-reading', enabled);
            if(enabled)table.tabIndex=0;
            else if(originalTabindex===null)table.removeAttribute('tabindex');
            else table.setAttribute('tabindex',originalTabindex);
            clear();
            if (enabled && focus) table.focus({preventScroll:true});
        }
        table.addEventListener('click', event => {
            if (!enabled) return;
            const cell = (event.target as Element).closest<HTMLTableCellElement>('td,th');
            if (!cell || cell.closest('table') !== table || (event.target as Element).closest('a,button,input')) return;
            select(cell); table.focus({preventScroll:true});
        });
        table.addEventListener('focusout', event => {
            if (!table.contains(event.relatedTarget as Node | null)) clear();
        });
        table.addEventListener('keydown', event => {
            if (!enabled || event.target !== table) return;
            if(event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||event.isComposing)return;
            if (event.key === 'Escape') { setReading(false);event.preventDefault();event.stopPropagation();return; }
            if (event.key === 'Enter' && current) {
                const row = current.parentElement!;
                const button=Array.from(row.querySelectorAll<HTMLElement>('.v-tbl-row-g-btn')).find(button=>button.closest('table')===table);
                if(button){button.click();event.preventDefault();}return;
            }
            const delta: Record<string, [number, number]> = {ArrowDown:[1,0], ArrowUp:[-1,0], ArrowRight:[0,1], ArrowLeft:[0,-1]};
            const step = delta[event.key];
            if (!step) return;
            event.preventDefault();
            const grid = tableGrid(table);
            let {r,c} = position;
            if (!current) { r = Array.from(table.rows).findIndex(row=>visible(row)); c = 0; }
            else { r += step[0]; c += step[1]; }
            while (r >= 0 && r < grid.length && c >= 0) {
                if(step[1]&&c>=(grid[r]?.length||0))break;
                const next = grid[r]?.[c];
                const row = next?.parentElement;
                if (next && next !== current && visible(table.rows[r]) && visible(row)) {
                    select(next, r, c); next.scrollIntoView?.({block:'nearest', inline:'nearest'}); return;
                }
                r += step[0]; c += step[1];
            }
        });
        if (readingDefault) setReading(true, false);
    });
}
