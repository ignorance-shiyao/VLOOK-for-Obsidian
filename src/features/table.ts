// 表格增强：单元格合并（== 横向 / : 纵向）、列格式（粗体/斜体/高亮/删除线/复选框/数值）、
// 行分组折叠（首列 > / >> ...）、空单元格、换行版式
// 移植自 vlook.js「表格增强类」「表格单元格合并类」「表格列格式化类」「表格行分组/折叠类」

import { h, svgIcon, unwrap } from "../core/dom";
import type { RenderCtx } from "../core/context";

const MERGE_ROW = /^(:)$/;
const MERGE_COL = /^(==)$/;
const CHKBOX_HEADER = /\[ ?] ?/;
const CHKBOX_CELL = /(^((\[[x-]])|[YyNn?？])(\s.+)*)/;
const ROWGROUP_TAG = /^>+(\s)./;

let tableCount = 0, folderCount = 0;

const txt = (el: Element) => (el.textContent || "").trim();
const align = (cell: HTMLElement) => cell.style.textAlign || cell.getAttribute("align") || "";

/** 按可见文字偏移移除语法标记，保留父元素、属性和事件。 */
function removeCellText(cell: HTMLElement, start: number, length: number) {
    if (start < 0 || length <= 0) return;
    const walker = cell.ownerDocument.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    let offset = 0;
    for (const node of nodes) {
        const end = offset + node.length;
        if (end > start && offset < start + length) {
            const from = Math.max(0, start - offset), to = Math.min(node.length, start + length - offset);
            node.deleteData(from, to - from);
        }
        offset = end;
    }
}

function emptyBlankCell(cell: HTMLElement) {
    if (txt(cell) === "" && !cell.querySelector("img,svg,input,audio,video,iframe,.internal-embed")) {
        cell.replaceChildren();
        cell.classList.add("v-empty-cell");
    }
}

/** 单元格内容规整：去掉 Obsidian 的包装，确保与 Typora 结构接近 */
function cellChildren(cell: HTMLElement): Element[] {
    return Array.from(cell.children).filter(c => !c.classList.contains("table-cell-wrapper"));
}

function hasOnlyChild(cell: HTMLElement, tags: string[]): boolean {
    const kids = cellChildren(cell);
    return kids.length === 1 && tags.includes(kids[0].tagName) && txt(cell) === txt(kids[0]);
}

/** 只读取覆盖完整表头的格式链，不把局部强调扩散到整列。 */
function headerFormats(cell: HTMLElement): Set<string> {
    const formats = new Set<string>();
    let parent: Element = cell;
    while (parent.children.length === 1) {
        const child = parent.children[0];
        if (!/^(STRONG|EM|MARK|U|DEL|S)$/.test(child.tagName) || txt(parent) !== txt(child)) break;
        formats.add(child.tagName);
        parent = child;
    }
    return formats;
}

function isColumnFormatting(cell: HTMLElement): boolean {
    return hasOnlyChild(cell, ["STRONG", "EM", "U", "MARK", "DEL", "S"]) || align(cell) === "right" || CHKBOX_HEADER.test(cell.textContent || "");
}

/** Descendant queries must not consume a nested table's rows, cells or controls. */
function ownTableElements<T extends HTMLElement=HTMLElement>(table:HTMLTableElement,selector:string,root:Element=table):T[]{
    return Array.from(root.querySelectorAll<T>(selector)).filter(element=>element.closest('table')===table);
}

function mergeCells(table: HTMLTableElement) {
    const rows = Array.from(ownTableElements(table,"tr"));
    const data: HTMLElement[][] = [], span: number[][] = [];
    let needRowSpan = false;
    rows.forEach((tr, r) => {
        data[r] = []; span[r] = [];
        let colSpan = 0, colSpanCell: HTMLElement | null = null, last: HTMLElement | null = null, colCount = 0;
        Array.from(tr.querySelectorAll<HTMLElement>(":scope > th, :scope > td")).forEach((cell, c) => {
            data[r][c] = cell;
            span[r][c] = 0;
            if (MERGE_ROW.test(txt(cell))) { span[r][c] = 1; needRowSpan = true; }
            colCount++;
            if (MERGE_COL.test(txt(cell))) {
                colSpan++;
                cell.remove();
                if (colSpan === 1) colSpanCell = last;
            } else {
                if (colSpan > 0 && colSpanCell) {
                    colSpanCell.setAttribute("colspan", String(colSpan + 1));
                    emptyBlankCell(colSpanCell);
                    colSpanCell.classList.add("vlook-cell-center");
                } else emptyBlankCell(cell);
                colSpan = 0;
            }
            last = cell;
        });
        if (colCount === colSpan + 1 && txt(tr) === "") tr.classList.add("v-table-colspan-all");
        if (colSpan > 0 && colSpanCell) {
            (colSpanCell as HTMLElement).setAttribute("colspan", String(colSpan + 1));
            emptyBlankCell(colSpanCell);
            (colSpanCell as HTMLElement).classList.add("vlook-cell-center");
        }
    });
    if (!needRowSpan) return;
    const td2th: HTMLTableRowElement[] = [];
    for (let c = 0; c < span[0].length; c++) {
        let count = 0, spanCell: HTMLElement | null = null, thSpan = false;
        for (let r = 0; r < span.length; r++) {
            if (span[r][c] === 1) {
                count++;
                if (!spanCell) spanCell = data[r - 1]?.[c] ?? null;
                if (r === 1) thSpan = true;
                if (thSpan) {
                    const tr = data[r][c].parentElement as HTMLTableRowElement;
                    if (!td2th.includes(tr)) td2th.push(tr);
                }
                data[r][c].remove();
                if (c + 1 < span[r].length && data[r][c + 1]) data[r][c + 1].classList.add("vlook-cell-pad");
            } else {
                thSpan = false;
                if (count > 0 && spanCell) {
                    spanCell.setAttribute("rowspan", String(count + 1));
                    emptyBlankCell(spanCell);
                    spanCell.classList.add("vlook-cell-middle");
                    count = 0; spanCell = null;
                }
            }
        }
        if (count > 0 && spanCell) {
            spanCell.setAttribute("rowspan", String(count + 1));
            emptyBlankCell(spanCell);
            spanCell.classList.add("vlook-cell-middle");
        }
    }
    // 多行表头：把参与表头纵向合并的 tbody 行移入 thead，并将 td 转为 th
    const thead = table.tHead;
    for (const tr of td2th) {
        if (!thead || tr.parentElement === thead) continue;
        thead.appendChild(tr);
        tr.querySelectorAll(":scope > td").forEach(td => {
            const th = td.ownerDocument.createElement("th");
            for (const a of Array.from(td.attributes)) th.setAttribute(a.name, a.value);
            th.setAttribute("data-td2th", "true");
            th.append(...Array.from(td.childNodes));
            td.replaceWith(th);
        });
    }
    // 首列纵向合并的后续行标记，避免作为首列冻结
    ownTableElements<HTMLElement>(table,"tr > [rowspan]:first-child").forEach(cell => {
        const n = parseInt(cell.getAttribute("rowspan") || "1");
        let tr = cell.parentElement?.nextElementSibling;
        for (let i = 2; i <= n && tr; i++) {
            const td = tr.querySelector<HTMLElement>(":scope > td:not([data-rowspan]):first-child");
            if (!td) break;
            td.setAttribute("data-rowspan", String(i));
            tr = tr.nextElementSibling;
        }
    });
}

function wrapSpan(cell: HTMLElement) {
    if (cell.children.length === 0) {
        const s = h("span");
        s.textContent = cell.textContent || "";
        cell.replaceChildren(s);
    }
}

function coloringNumber(cell: HTMLElement, text: string, atStart: boolean): boolean {
    const neg = atStart ? text.startsWith("-") : text.includes("-");
    const pos = atStart ? text.startsWith("+") : text.includes("+");
    if (neg) { cell.classList.add("v-tbl-col-fmt-num-negative"); return true; }
    if (pos) { cell.classList.add("v-tbl-col-fmt-num-positive"); return true; }
    return false;
}

/** 按整格数值决定分隔位置，数字被内联格式拆开时也保持正确。 */
function addThousandsSeparators(cell: HTMLElement) {
    const source = cell.textContent || "";
    const number = source.match(/^\s*(?:\D{1,3} )?[+-]*(\d+)(?:\.\d+)?\s*$/);
    if (!number) return;
    const start = source.search(/\d/), positions: number[] = [];
    for (let i = number[1].length - 3; i > 0; i -= 3) positions.unshift(start + i);
    if (!positions.length) return;
    const walker = cell.ownerDocument.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    let offset = 0;
    while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const original = node.data, end = offset + original.length;
        const local = positions.filter(position => position > offset && position <= end).reverse();
        for (const position of local) node.insertData(position - offset, ",");
        offset = end;
    }
}

/** 按整格文字范围包装样式，保留原来的链接 / 强调层级。 */
function wrapCellTextRange(cell: HTMLElement, start: number, length: number, className: string) {
    const walker = cell.ownerDocument.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    let offset = 0;
    for (const text of texts) {
        const original = text.data, end = offset + original.length;
        if (end > start && offset < start + length) {
            const from = Math.max(0,start-offset), to = Math.min(original.length,start+length-offset);
            const span = cell.ownerDocument.createElement("span");
            span.className = className;span.textContent = original.slice(from,to);
            text.replaceWith(original.slice(0,from),span,original.slice(to));
        }
        offset=end;
    }
}

function formatDecimal(cell: HTMLElement) {
    const match = (cell.textContent || "").match(/\.(\d+)/);
    if (match) wrapCellTextRange(cell,match.index!+1,match[1].length,"v-tbl-col-fmt-num-decimal");
}

function formatPercent(cell: HTMLElement) {
    const pos = (cell.textContent || "").lastIndexOf("%");
    if (pos>=0) wrapCellTextRange(cell,pos,1,"v-tbl-col-fmt-percent");
}

function formatCurrency(cell: HTMLElement) {
    const match = (cell.textContent || "").match(/^(\s*)([a-z$¥￥]{1,3})\s/i);
    if (!match) return;
    const start=match[1].length;
    removeCellText(cell,start+match[2].length,1);
    wrapCellTextRange(cell,start,match[2].length,"v-tbl-col-fmt-currency");
}

function replacePercentSign(cell: HTMLElement) {
    const walker = cell.ownerDocument.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const text = walker.currentNode as Text;
        if (!text.data.trim()) continue;
        text.data = text.data.replace(/^(\s*)\+/, "$1▴ ").replace(/^(\s*)-/, "$1▾ ");
        break;
    }
}

function formatColumns(table: HTMLTableElement, freezeAuto: boolean) {
    const ths = Array.from(ownTableElements<HTMLElement>(table,"thead th"));
    ths.forEach((th, index) => {
        const col = th.getAttribute("data-tbl-col");
        const cells = () => Array.from(ownTableElements<HTMLElement>(table,`[data-tbl-col="${col}"]:not([data-colspan="true"])`));
        const tbodyCells = () => Array.from(ownTableElements<HTMLElement>(table,`td[data-tbl-col="${col}"]`));
        const add: string[] = [];
        const kids = cellChildren(th);
        const only = kids.length === 1 && txt(th) === txt(kids[0]) ? kids[0].tagName : "";
        const formats = headerFormats(th);
        if (formats.has("STRONG")) {
            add.push("v-tbl-col-fmt-bold");
            if (index === 0 && freezeAuto) table.classList.add("v-freeze", "auto");
        }
        if (formats.has("EM") || th.querySelector(":scope em:only-child")) add.push("v-tbl-col-fmt-em");
        if (formats.has("MARK") || th.classList.contains("v-tbl-col-fmt-mark")) {
            ownTableElements(table,`[data-tbl-col="${col}"] mark`).forEach(m => unwrap(m));
            add.push("v-tbl-col-fmt-mark");
        }
        if (add.length) cells().forEach(c => c.classList.add(...add));
        // 删除线：不发布该列
        if (only === "DEL" || only === "S") {
            th.remove();
            tbodyCells().forEach(c => c.remove());
            return;
        }
        // 复选框
        if (CHKBOX_HEADER.test(th.textContent || "")) {
            cells().forEach(c => { c.classList.remove("v-empty-cell"); c.classList.add("v-tbl-col-fmt-chkbox"); });
            const marker = (th.textContent || "").match(CHKBOX_HEADER)!;
            removeCellText(th, marker.index!, marker[0].length);
            tbodyCells().forEach(ce => {
                if (ce.hasAttribute("colspan")) return;
                const t = txt(ce);
                const m = t.match(CHKBOX_CELL);
                const flag = m ? m[2] : "";
                let status = "no", style = "dark";
                if (flag) removeCellText(ce, (ce.textContent || "").indexOf(flag), flag.length);
                if (flag.toLowerCase() === "y") { status = "yes"; style = "theme"; }
                else if (flag === "?" || flag === "？") { status = "un"; style = "theme"; }
                if (flag || t === "") {
                    const label = h("label", "checkbox", {}, svgIcon(`icoChkbox_${status}`, 14, 14, style, "", `data-chk="${status}"`));
                    ce.classList.remove("v-empty-cell");
                    ce.prepend(label);
                } else {
                    ce.prepend(h("em", "", {}, `<sub>Gy</sub>`));
                }
            });
        }
        // 数值格式（右对齐列）
        if (align(th).startsWith("r")) {
            tbodyCells().forEach(ce => {
                ce.classList.add("v-tbl-col-fmt-num");
                const t = txt(ce);
                if (/^([-+])*\d+(\.\d+)?$/.test(t)) {
                    wrapSpan(ce);
                    addThousandsSeparators(ce);
                    formatDecimal(ce);
                    coloringNumber(ce, t, true);
                } else if (/^([-+])*\d+(\.\d+)?%$/.test(t)) {
                    wrapSpan(ce);
                    formatDecimal(ce);
                    formatPercent(ce);
                    const coloring = coloringNumber(ce, t, true);
                    const percent = t.replace(/(-|\+|\s)/g, "");
                    const pv = Math.round(parseFloat(percent));
                    let bg1 = "var(--ac-wt-fd)", bg2 = "var(--ac-t1-fd)", split = "var(--ac-t1)";
                    if (coloring) {
                        const base = ce.classList.contains("v-tbl-col-fmt-num-negative") ? "gn" : "rd";
                        bg2 = `var(--ac-${base}-fd)`; split = `var(--ac-${base})`;
                    }
                    ce.style.background = `linear-gradient(90deg,${bg1} 0%,${bg2} ${pv > 1 ? pv - 1 : 0}%,${split} ${percent},transparent ${percent})`;
                    ce.classList.add("vlook-cell-bar");
                    replacePercentSign(ce);
                } else if (/^(\D{1,3} )([-+])*\d+(\.\d+)?$/.test(t)) {
                    wrapSpan(ce);
                    addThousandsSeparators(ce);
                    formatCurrency(ce);
                    formatDecimal(ce);
                    coloringNumber(ce, t, false);
                }
            });
        }
        th.setAttribute("data-colspan", th.hasAttribute("colspan") ? "true" : "false");
    });
}

function rowGroups(table: HTMLTableElement) {
    ownTableElements<HTMLElement>(table,`[data-tbl-col$="-0"]`).forEach(c => c.classList.add("v-tbl-row-g-not-folder"));
    const parents: number[] = [];
    let lastLevel = 0;
    const closer = svgIcon("icoFolded", 16, 16, "text");
    const lastParent = () => parents[parents.length - 1];

    const newFolder = (tr: HTMLElement) => {
        let folderRow = tr.previousElementSibling as HTMLElement | null;
        while(folderRow&&folderRow.tagName!=='TR')folderRow=folderRow.previousElementSibling as HTMLElement|null;
        const td=folderRow?.querySelector<HTMLElement>(':scope > td');
        if (!folderRow||!td) return false;
        folderCount++;
        parents.push(folderCount);
        folderRow.dataset.folderId = String(folderCount);
        folderRow.dataset.folder = "true";
        folderRow.dataset.rowFolded = "true";
        const idents = ownTableElements(table,'.v-tbl-row-g-ident',td);
        const lastIdent = idents[idents.length - 1];
        let btn: HTMLElement;
        if (lastIdent) {
            btn = h("span", "v-tbl-row-g-btn", {}, closer);
            lastIdent.after(btn);
            lastIdent.classList.add("v-tbl-row-g-ident-folder");
        } else {
            btn = h("label", "v-tbl-row-g-btn", {}, closer);
            td.prepend(btn);
        }
        td.classList.remove("v-tbl-row-g-not-folder");
        td.classList.add("v-tbl-row-g-folder");
        btn.setAttribute("role", "button");
        btn.tabIndex = 0;
        btn.setAttribute("aria-expanded", "false");
        btn.setAttribute("aria-label", "展开行分组");
        btn.after(" ");
        btn.addEventListener("click", ev => { ev.stopPropagation(); toggle(folderRow!); });
        btn.addEventListener("keydown", ev => {
            if ((ev.key !== "Enter" && ev.key !== " ") || ev.ctrlKey || ev.metaKey || ev.altKey) return;
            ev.preventDefault(); ev.stopPropagation();
            if (!ev.repeat) toggle(folderRow!);
        });
        return true;
    };

    const ident = (tr: HTMLElement, td: HTMLElement, level: number) => {
        const marker = (td.textContent || "").match(/^>+\s/);
        if (marker) removeCellText(td, 0, marker[0].length);
        tr.dataset.parentFolderId = String(lastParent());
        td.dataset.identLevel = String(level);
        td.classList.remove("v-tbl-row-g-not-folder");
        td.classList.add("v-tbl-row-g-sub");
        for (let i = 0; i < level; i++) {
            const idents = ownTableElements(table,'.v-tbl-row-g-ident',td);
            const el = h("label", "v-tbl-row-g-ident");
            idents.length ? idents[idents.length - 1].after(el) : td.prepend(el);
        }
        tr.classList.add("vlook-row-folded");
    };

    const open = (row: HTMLElement) => {
        row.dataset.rowFolded = "false";
        const btns = ownTableElements(table,'.v-tbl-row-g-btn',row.querySelector(':scope > td')!);
        const btn = btns[btns.length - 1];
        btn?.querySelector("svg")?.classList.add("v-rotate90");
        btn?.setAttribute("aria-expanded", "true");
        btn?.setAttribute("aria-label", "折叠行分组");
        ownTableElements<HTMLElement>(table,`tr[data-parent-folder-id="${row.dataset.folderId}"]`).forEach(r => r.classList.remove("vlook-row-folded"));
    };
    const close = (row: HTMLElement) => {
        row.dataset.rowFolded = "true";
        const btns = ownTableElements(table,'.v-tbl-row-g-btn',row.querySelector(':scope > td')!);
        const btn = btns[btns.length - 1];
        btn?.querySelector("svg")?.classList.remove("v-rotate90");
        btn?.setAttribute("aria-expanded", "false");
        btn?.setAttribute("aria-label", "展开行分组");
        ownTableElements<HTMLElement>(table,`tr[data-parent-folder-id="${row.dataset.folderId}"]`).forEach(r => {
            if (r.dataset.folder === "true") close(r);
            r.classList.add("vlook-row-folded");
        });
    };
    const toggle = (row: HTMLElement) => row.dataset.rowFolded === "true" ? open(row) : close(row);

    let section:Element|null=null;
    ownTableElements<HTMLElement>(table,"tbody td:first-child").forEach(td => {
        const tr = td.parentElement as HTMLElement;
        if(section!==tr.parentElement){section=tr.parentElement;lastLevel=0;parents.length=0;}
        const text = td.textContent || "";
        if (!ROWGROUP_TAG.test(text)) { lastLevel = 0; parents.length = 0; return; }
        const level = text.match(/^>+/)![0].length;
        if (level > lastLevel) {
            if(!newFolder(tr)){lastLevel=0;parents.length=0;return;}
            lastLevel = level;
            ident(tr, td, level);
        } else {
            for (let i = 0; i < lastLevel - level; i++) parents.pop();
            lastLevel = level;
            if(lastParent()===undefined){lastLevel=0;parents.length=0;return;}
            ident(tr, td, level);
        }
    });
    ownTableElements<HTMLElement>(table,`tr[data-folder="true"]`).forEach(r => {
        const td = r.querySelector<HTMLElement>("td");
        if (td?.dataset.identLevel !== undefined) td.classList.add("vlook-cell-folder");
    });
}

export function processTables(root: HTMLElement, ctx: RenderCtx): void {
    const freeze = ctx.cssVar("--tbl-freeze-column") || "auto";
    root.querySelectorAll<HTMLTableElement>("table").forEach(table => {
        if (table.dataset.vlook) return;
        table.dataset.vlook = "1";
        tableCount++;
        table.dataset.num = String(tableCount);
        if (freeze === "on") table.classList.add("v-freeze");
        let merge = false, fmt = false, group = false;
        let cols = 0;
        ownTableElements(table,"thead > tr").forEach(tr => {
            cols = 0;
            tr.querySelectorAll<HTMLElement>(":scope > th").forEach(th => {
                if (!merge && (MERGE_ROW.test(txt(th)) || MERGE_COL.test(txt(th)))) merge = true;
                if (!fmt && isColumnFormatting(th)) fmt = true;
                th.dataset.tblCol = `tbl-${tableCount}-${cols++}`;
                emptyBlankCell(th);
            });
        });
        if (cols >= 6) table.dataset.colTooMore = String(cols);
        ownTableElements(table,"tbody > tr").forEach(tr => {
            let c = 0;
            tr.querySelectorAll<HTMLElement>(":scope > td").forEach(td => {
                if (!merge && (MERGE_ROW.test(txt(td)) || MERGE_COL.test(txt(td)))) merge = true;
                if (!group && c === 0 && ROWGROUP_TAG.test(td.textContent || "")) group = true;
                // 单元格内容全部为高亮时，转为单元格高亮样式
                if (hasOnlyChild(td, ["MARK"])) {
                    unwrap(cellChildren(td)[0]);
                    td.classList.add("v-tbl-col-fmt-mark");
                }
                td.dataset.tblCol = `tbl-${tableCount}-${c++}`;
                emptyBlankCell(td);
            });
        });
        if (merge) {
            table.dataset.cellMerge = "true";
            mergeCells(table);
            ownTableElements<HTMLElement>(table,"thead > tr > th").forEach(th => { if (!fmt && isColumnFormatting(th)) fmt = true; });
        }
        // 修正：同行 / 同列存在内容时，不应作为空白单元格
        ownTableElements<HTMLElement>(table,".v-empty-cell").forEach(cell => {
            const tr = cell.parentElement!;
            if (txt(tr) !== "") cell.classList.remove("v-empty-cell");
            const same = ownTableElements(table,`[data-tbl-col="${cell.dataset.tblCol}"]`);
            if (Array.from(same).every(s => txt(s) === "")) cell.classList.add("v-empty-cell");
        });
        if (fmt) {
            table.dataset.columnFmting = "true";
            formatColumns(table, freeze === "auto" || freeze === "");
        }
        if (group) {
            table.dataset.rowGroup = "true";
            rowGroups(table);
        }
    });
}
