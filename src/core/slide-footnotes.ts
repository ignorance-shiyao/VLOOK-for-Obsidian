import { parser } from '@lezer/markdown';

const referenceParser=parser.configure({
    defineNodes:['VlookFootnoteReference'],
    parseInline:[{name:'VlookFootnoteReference',before:'Link',parse(cx,next,pos){
        if(next!==91||cx.char(pos+1)!==94||cx.hasOpenLink)return -1;
        const match=cx.slice(pos,cx.end).match(/^\[\^([^\]\r\n]+)\]/);
        if(!match)return -1;
        return cx.addElement(cx.elt('VlookFootnoteReference',pos,pos+match[0].length));
    }}],
});

/** 每次独立渲染先按全文首次引用序列初始化，避免各卡片从 1 重新编号。 */
export function slideFootnoteSeed(definitions:string,source?:string):string {
    const labels=Array.from(definitions.matchAll(/^ {0,3}\[\^([^\]]+)\]:/gm),match=>match[1]);
    const available=new Set(labels),ordered=new Set<string>();
    if(source)referenceParser.parse(source).iterate({enter(node){
        if(node.name==='LinkReference'||node.name==='Image')return false;
        if(node.name==='VlookFootnoteReference'){
            const label=source.slice(node.from+2,node.to-1);
            if(available.has(label))ordered.add(label);
        }
    }});
    // 未引用定义仍保留在「所有脚注」卡片，排在已引用条目之后。
    labels.forEach(label=>ordered.add(label));
    return ordered.size?`<span data-vlook-footnote-seed></span>${Array.from(ordered).map(label=>`[^${label}]`).join(' ')}\n\n`:'';
}

/** 渲染器可为每次调用分配不同 ID，使用本次实际 href → 条目序号消除该差异。 */
export function indexSlideFootnotes(root:HTMLElement):void {
    const entries=Array.from(root.querySelectorAll<HTMLElement>('section.footnotes > ol > li'));
    const targets=new Map(entries.map((entry,n)=>{entry.dataset.vlookFootnote=String(n);return [entry.id,String(n)]}));
    root.querySelectorAll<HTMLAnchorElement>('sup.footnote-ref a,a.footnote-link').forEach(anchor=>{
        let id=(anchor.getAttribute('href')||'').replace(/^.*#/,'');
        try{id=decodeURIComponent(id);}catch{/* 保留宿主锚点 */}
        const ordinal=targets.get(id);
        if(ordinal!==undefined)anchor.dataset.vlookFootnote=ordinal;
    });
    root.querySelectorAll('[data-vlook-footnote-seed]').forEach(marker=>{const paragraph=marker.closest('p');if(paragraph&&root.contains(paragraph))paragraph.remove();else marker.remove()});
}
