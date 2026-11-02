/** 只在 Markdown 链接之外拆分逗号，保留原始文本以供无损重写。 */
export function splitDocumentLibrary(source) {
    const parts=[];
    let start=0,brackets=0,parens=0,quote='',angle=false;
    for(let i=0;i<source.length;i++){
        const ch=source[i];
        if(ch==='\\'){i++;continue;}
        if(quote){if(ch===quote)quote='';continue;}
        if(angle){if(ch==='>')angle=false;continue;}
        if(!brackets&&(ch==='"'||ch==="'")&&(i===0||/\s|\(/.test(source[i-1]))){quote=ch;continue;}
        if(ch==='<'&&!brackets){angle=true;continue;}
        if(ch==='['){brackets++;continue;}
        if(ch===']'){brackets=Math.max(0,brackets-1);continue;}
        if(ch==='('){parens++;continue;}
        if(ch===')'){parens=Math.max(0,parens-1);continue;}
        if(ch===','&&!brackets&&!parens){parts.push(source.slice(start,i));start=i+1;}
    }
    parts.push(source.slice(start));return parts;
}

/** 单条文库链接解析；运行时和宿主共用，避免说明字段与地址处理分歧。 */
export function parseDocumentLibraryLink(source) {
    const text=source.trim();
    const match=text.match(/^\[((?:\\.|[^\[\]])*)\]\(\s*(<[^>]+>|(?:(?:\\[()])|[^\s()\\]+|\((?:\\[()]|[^()\\])*\))+)(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*\)$/);
    if(!match)return null;
    const raw=match[2],href=raw.replace(/^<|>$/g,'').replace(/\\([()])/g,'$1');
    const split=href.indexOf('#');
    const from=text.indexOf(raw,match[1].length+3);
    return {href,page:split<0?href:href.slice(0,split),hash:split<0?'':href.slice(split),text:match[1].trim().replace(/\\([\[\]\\])/g,'$1'),title:(match[3]||match[4]||match[5]||'').trim(),from,to:from+raw.length,angle:raw.startsWith('<')};
}
