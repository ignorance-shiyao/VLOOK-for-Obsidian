import { parser } from '@lezer/markdown';
import { scanBlocks, type Block, type SourceIndex } from './source-index';

/** Remove one CommonMark list item's container indentation without changing its line count. */
function listItemContent(text: string): string | undefined {
    const lines = text.split('\n');
    const marker = lines[0].match(/^( {0,3})(?:[-+*]|\d{1,9}[.)])([ \t]+)/);
    if (!marker) return;
    // Lezer starts the item at its marker, while continuation lines retain container whitespace.
    const indent = Array.from(marker[0]).reduce((column, char) => column + (char === '\t' ? 4 - column % 4 : 1), 0);
    lines[0] = lines[0].slice(marker[0].length);
    for (let n = 1; n < lines.length; n++) {
        let columns = 0, at = 0;
        while (at < lines[n].length && columns < indent && /[ \t]/.test(lines[n][at])) {
            columns += lines[n][at] === '\t' ? 4 - columns % 4 : 1;
            at++;
        }
        if (columns >= indent) lines[n] = ' '.repeat(columns - indent) + lines[n].slice(at);
    }
    return lines.join('\n');
}

/** MathJax equation labels are case sensitive and must not use heading punctuation rules. */
export function equationSourceLine(index: SourceIndex, anchor: string): number | undefined {
    if (!anchor.startsWith('mjx-eqn:')) return;
    const requested = anchor.slice('mjx-eqn:'.length);
    const visit = (blocks: Block[], offset = 0): number | undefined => {
        for (const block of blocks) {
            if (block.type === 'blockquote' || block.type === 'callout') {
                const inner = block.text.replace(/^ {0,3}>[ \t]?/gm, '');
                if (inner !== block.text) {
                    const line = visit(scanBlocks(inner), offset + block.start);
                    if (line !== undefined) return line;
                }
            }
            if (block.type === 'list') {
                let found: number | undefined;
                parser.parse(block.text).iterate({enter(node) {
                    if (found !== undefined) return false;
                    if (node.name !== 'ListItem') return;
                    const inner = listItemContent(block.text.slice(node.from, node.to));
                    if (inner !== undefined) found = visit(scanBlocks(inner), offset + block.start + block.text.slice(0, node.from).split('\n').length - 1);
                    // Recursive scans handle nested items; do not visit them twice.
                    return false;
                }});
                if (found !== undefined) return found;
            }
            if (block.type !== 'math') continue;
            // TeX comments extend to the line end; escaped percent signs remain literal.
            const text = block.text.replace(/\\[\s\S]|%[^\n]*/g, token => token.startsWith('%') ? ' '.repeat(token.length) : token);
            for (const match of text.matchAll(/\\(?:[A-Za-z]+|[^\sA-Za-z])(?:[ \t\n]*\{([^{}]*)\})?/g)) {
                if (match[0].startsWith('\\label') && /^\\label\s*\{/.test(match[0]) && match[1] === requested) return offset + block.start;
            }
        }
    };
    return visit(index.blocks);
}
