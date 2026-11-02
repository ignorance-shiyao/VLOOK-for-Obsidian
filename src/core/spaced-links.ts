import {isLiteralContent} from './literal-dom';

// Typora 接受目标含未转义空格的链接，如 [GitHub Style Alert](guide2.md#github Style Alert)；
// CommonMark 不识别，宿主把它留作字面文字。这里把这类残留文字还原为链接。
const SPACED_LINK=/(?<!!)\[([^\[\]\n]+)\]\(([^()\n<>"]*\s[^()\n<>"]*)\)/g;

/** 还原目标含空格的字面链接；代码、公式等字面内容不处理。返回还原数量。 */
export function restoreSpacedLinks(root:HTMLElement, decorate?:(a:HTMLAnchorElement, href:string)=>void):number {
    const doc=root.ownerDocument, walker=doc.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const texts:Text[]=[];
    for(let node=walker.nextNode();node;node=walker.nextNode()){
        const text=node as Text;
        if(text.data.includes('](')&&!isLiteralContent(text)&&!text.parentElement?.closest('a'))texts.push(text);
    }
    let count=0;
    for(const text of texts){
        const data=text.data;SPACED_LINK.lastIndex=0;
        if(!SPACED_LINK.test(data))continue;
        SPACED_LINK.lastIndex=0;
        const frag=doc.createDocumentFragment();let last=0;
        for(const match of data.matchAll(SPACED_LINK)){
            const href=match[2].trim();
            if(!href)continue;
            frag.append(data.slice(last,match.index));
            const a=doc.createElement('a');
            a.setAttribute('href',href);a.textContent=match[1];
            decorate?.(a,href);
            frag.append(a);last=match.index!+match[0].length;count++;
        }
        frag.append(data.slice(last));
        text.replaceWith(frag);
    }
    return count;
}
