import { parser, Strikethrough } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { decodeEntities } from "./dom";

const highlight = {resolve:"Highlight", mark:"HighlightMark"};
export const headingParser = parser.configure([Strikethrough, {
    defineNodes:["Highlight", "HighlightMark"],
    parseInline:[{name:"Highlight", parse(cx, next, pos) {
        if (next !== 61 || cx.char(pos+1) !== 61) return -1;
        return cx.addDelimiter(highlight, pos, pos+2, !/\s/.test(cx.slice(pos+2,pos+3)), !/\s/.test(cx.slice(pos-1,pos)));
    }}],
}]);

/** ATX / Setext 标题内容，不把 Setext 下划线混入标题匹配。 */
export function headingSource(source: string): string {
    const lines = source.split("\n");
    if (/^ {0,3}#{1,6}(?:\s|$)/.test(lines[0]))
        return lines[0].replace(/^ {0,3}#{1,6}(?:\s+|$)/, "").replace(/\s+#+\s*$/, "").trim();
    if (lines.length > 1 && /^ {0,3}(?:=+|-+)\s*$/.test(lines[lines.length - 1])) lines.pop();
    return lines.join(" ").trim();
}

/** 标题源码 → 显示文字。只移除语法树中实际成立的格式，保留字面标点。 */
export function headingPlain(src: string): string {
    const source = "# " + headingSource(src);
    const renderRange = (node: SyntaxNode, from: number, to: number): string => {
        let text = "", pos = from;
        for (let child=node.firstChild;child;child=child.nextSibling) {
            if (child.to <= from || child.from >= to) continue;
            text += source.slice(pos,child.from) + render(child);
            pos=child.to;
        }
        return text + source.slice(pos,to);
    };
    const render = (node: SyntaxNode): string => {
        const raw=source.slice(node.from,node.to);
        if (node.name === "InlineCode") {
            const ticks=raw.match(/^`+/)![0].length;
            let value=raw.slice(ticks,-ticks).replace(/\n/g," ");
            if (/^ .* $/.test(value) && /[^ ]/.test(value)) value=value.slice(1,-1);
            return value;
        }
        if (node.name === "Escape") return raw.slice(1);
        if (node.name === "Image" || node.name === "HTMLTag" || /^(?:Header|Emphasis|Strikethrough|Highlight|Link)Mark$/.test(node.name)) return "";
        if (node.name === "Entity" && typeof document !== "undefined") {
            return decodeEntities(raw);
        }
        if (node.name === "Link") {
            const open=node.firstChild;
            for(let child=open?.nextSibling;child;child=child.nextSibling)
                if(child.name === "LinkMark" && source.slice(child.from,child.to) === "]")
                    return renderRange(node,open!.to,child.from);
        }
        return renderRange(node,node.from,node.to);
    };
    return render(headingParser.parse(source).topNode).trim();
}
