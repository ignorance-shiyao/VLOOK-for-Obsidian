/** Source ranges which cannot contribute rendered image/media candidates. Offsets stay unchanged. */
export function htmlLiteralRanges(source:string,allowKbd=false):{pos:number;end:number}[] {
    const ranges:{pos:number;end:number}[]=[];
    const raw=/<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
    const markup=source.replace(raw,(value,_tag,offset)=>{
        ranges.push({pos:offset,end:offset+value.length});return value.replace(/[^\n]/g,' ');
    });
    const literal=new Set(['code','pre','svg','math','mjx-container',...(allowKbd?[]:['kbd'])]);
    const stack:{tag:string;pos:number}[]=[];
    const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    const tokens=/<\/?[A-Za-z][\w:-]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
    for(const match of markup.matchAll(tokens)){
        const token=match[0],tag=token.match(/^<\/?([\w:-]+)/)![1].toLowerCase();
        if(/^<\//.test(token)){
            const at=stack.map(item=>item.tag).lastIndexOf(tag);
            if(at<0)continue;
            const start=stack[0].pos;stack.length=at;
            if(!stack.length)ranges.push({pos:start,end:match.index!+token.length});
        } else {
            const attrs=Array.from(token.slice(tag.length+1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g));
            const cls=attrs.find(attr=>attr[1].toLowerCase()==='class');
            const classes=(cls?.[2]??cls?.[3]??cls?.[4]??'').split(/\s+/);
            const startsLiteral=literal.has(tag)||classes.includes('math')||classes.includes('frontmatter');
            if((stack.length||startsLiteral)&&!voidTags.has(tag)&&!/\/\s*>$/.test(token))stack.push({tag,pos:match.index!});
        }
    }
    if(stack.length)ranges.push({pos:stack[0].pos,end:source.length});
    return ranges;
}
