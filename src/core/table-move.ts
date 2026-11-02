/** Markdown 表格的行列移动：只重排单元格文本，外框竖线与缩进保持不变。 */
export type TableMove = 'up' | 'down' | 'left' | 'right';

interface Row { indent: string; edgeLead: boolean; edgeTrail: boolean; cells: string[] }

function splitRow(line: string): Row | null {
    if (!line.includes('|')) return null;
    const indent = line.match(/^\s*/)![0], body = line.trim();
    const cells: string[] = [];
    let start = 0, code = 0;
    for (let i = 0; i <= body.length; i++) {
        const ch = body[i];
        if (ch === '\\') { i++; continue; }
        if (ch === '`') { let n = 1; while (body[i + n] === '`') n++; code = code === n ? 0 : code || n; i += n - 1; continue; }
        if (i === body.length || (ch === '|' && !code)) { cells.push(body.slice(start, i)); start = i + 1; }
    }
    const edgeLead = body.startsWith('|'), edgeTrail = body.endsWith('|') && !body.endsWith('\\|');
    if (edgeLead) cells.shift();
    if (edgeTrail) cells.pop();
    return { indent, edgeLead, edgeTrail, cells };
}
const joinRow = (row: Row) => `${row.indent}${row.edgeLead ? '|' : ''}${row.cells.join('|')}${row.edgeTrail ? '|' : ''}`;
const isDelimiter = (row: Row) => row.cells.length > 0 && row.cells.every(cell => /^\s*:?-+:?\s*$/.test(cell));

/** 光标所在表格的行范围与光标所在列；不在表格内返回 null。 */
export function tableAt(lines: string[], line: number, ch: number) {
    if (!lines[line]?.includes('|')) return null;
    let from = line, to = line;
    while (from > 0 && lines[from - 1].includes('|')) from--;
    while (to < lines.length - 1 && lines[to + 1].includes('|')) to++;
    const rows = lines.slice(from, to + 1).map(splitRow);
    if (rows.length < 2 || rows.some(row => !row) || !isDelimiter(rows[1]!)) return null;
    const own = rows[line - from]!;
    const col = Math.max(0, Math.min(own.cells.length - 1, pipesBefore(lines[line], ch) - (own.edgeLead ? 1 : 0)));
    return { from, to, row: line - from, col };
}

function pipesBefore(line: string, ch: number): number {
    let count = 0, code = 0;
    for (let i = 0; i < Math.min(ch, line.length); i++) {
        if (line[i] === '\\') { i++; continue; }
        if (line[i] === '`') { let n = 1; while (line[i + n] === '`') n++; code = code === n ? 0 : code || n; i += n - 1; continue; }
        if (line[i] === '|' && !code) count++;
    }
    return count;
}

/** 返回移动后的表格行文本与光标新行列；越界或移动表头/分隔行时返回 null。 */
export function moveTable(lines: string[], line: number, ch: number, move: TableMove) {
    const at = tableAt(lines, line, ch);
    if (!at) return null;
    const rows = lines.slice(at.from, at.to + 1).map(splitRow) as Row[];
    let { row, col } = at;
    if (move === 'up' || move === 'down') {
        const target = row + (move === 'up' ? -1 : 1);
        if (row < 2 || target < 2 || target >= rows.length) return null;
        [rows[row], rows[target]] = [rows[target], rows[row]];
        row = target;
    } else {
        const target = col + (move === 'left' ? -1 : 1);
        const width = Math.min(...rows.map(r => r.cells.length));
        if (target < 0 || target >= width || col >= width) return null;
        for (const r of rows) [r.cells[col], r.cells[target]] = [r.cells[target], r.cells[col]];
        col = target;
    }
    return { from: at.from, to: at.to, lines: rows.map(joinRow), line: at.from + row, col };
}

/** 把表格第 from 行/列整体移到第 to 位（行列均含表头与分隔行的源码序号）；表头、分隔行不参与行移动。 */
export function reorderTable(lines: string[], line: number, kind: 'row' | 'col', from: number, to: number) {
    const at = tableAt(lines, line, 0);
    if (!at || from === to) return null;
    const rows = lines.slice(at.from, at.to + 1).map(splitRow) as Row[];
    if (kind === 'row') {
        if (from < 2 || to < 2 || from >= rows.length || to >= rows.length) return null;
        rows.splice(to, 0, rows.splice(from, 1)[0]);
    } else {
        const width = Math.min(...rows.map(r => r.cells.length));
        if (from < 0 || to < 0 || from >= width || to >= width) return null;
        for (const r of rows) r.cells.splice(to, 0, r.cells.splice(from, 1)[0]);
    }
    return { from: at.from, to: at.to, lines: rows.map(joinRow) };
}
