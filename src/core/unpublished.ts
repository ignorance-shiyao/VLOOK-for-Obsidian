import { parser, Strikethrough } from "@lezer/markdown";
import { parseHtml } from "./dom";

const inlineParser = parser.configure(Strikethrough);

/** 原版引用小标题可在首 / 次段，折叠标题为首个 h6。 */
export function isUnpublishedQuote(quote: Element, configured?: unknown): boolean {
    const matches = unpublishedMatcher(configured);
    const titles = quote.querySelectorAll(":scope > p:first-child > strong:only-child,:scope > p:first-child > mark:only-child,:scope > p:first-child + p > strong:only-child,:scope > p:first-child + p > mark:only-child,:scope > h6:first-child");
    return Array.from(titles).some(title => !!title.querySelector(":scope > del,:scope > s") || matches(title.textContent || ""));
}

/** 对应原版 hN > del，部分标题也生效；代码、链接、强调中的嵌套删除线不生效。 */
export function hasDirectStrike(title: string): boolean {
    const elements = inlineParser.parseInline(title, 0);
    const type = (element: typeof elements[number]) => inlineParser.nodeSet.types[element.type].name;
    if (!elements.some(element => type(element) === "HTMLTag"))
        return elements.some(element => type(element) === "Strikethrough");
    // 惰性 template 不挂载到文档、不运行脚本。HTML 交给浏览器处理嵌套，
    // 代码 / 转义 / Markdown 容器只生成占位节点，不能变成可识别的 HTML 标签。
    const template = { content: parseHtml(activeDocument, elements.map(element => {
        const name = type(element);
        if (name === "HTMLTag") return title.slice(element.from, element.to);
        return name === "Strikethrough" ? "<del></del>" : "<span></span>";
    }).join("")) };
    return Array.from(template.content.children).some(element => element.tagName === "DEL" || element.tagName === "S");
}

/** 与原版 vlook-unpub 相同，分号分隔精确标题或 /pattern/flags。 */
export function unpublishedMatcher(value:unknown):(title:string)=>boolean {
    const parts=(Array.isArray(value)?value:[value]).flatMap(item=>typeof item==='string'?item.split(';'):[]).map(item=>item.trim()).filter(Boolean);
    const rules=parts.map(part=>{
        const match=part.match(/^\/(.*)\/([a-z]*)$/);
        if(!match)return (title:string)=>title===part;
        try {const expression=new RegExp(match[1],match[2]);return (title:string)=>{expression.lastIndex=0;return expression.test(title);};}
        catch {return (_title:string)=>false;}
    });
    return title=>rules.some(rule=>rule(title.trim()));
}
