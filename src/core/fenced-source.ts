import type { SyntaxNode } from '@lezer/common';
import {parser} from '@lezer/markdown';

/** Obsidian footnotes are containers, with four-column-indented continuation lines. */
export const fenceParser=parser.configure({
    defineNodes:[{name:'VlookFootnote',composite(_cx,line){
        if(line.pos===line.text.length)return true;
        if(line.indent<line.baseIndent+4)return false;
        line.moveBaseColumn(line.baseIndent+4);return true;
    }}],
    parseBlock:[{name:'VlookFootnote',before:'LinkReference',parse(cx,line){
        if(line.indent-line.baseIndent>3)return false;
        const marker=line.text.slice(line.pos).match(/^\[\^[^\]\r\n]+\]:[ \t]*/);
        if(!marker)return false;
        cx.startComposite('VlookFootnote',line.pos);
        line.moveBase(line.pos+marker[0].length);return null;
    }}],
});

export function sourceFences(source:string,language:string):string[] {
    const result:string[]=[];
    fenceParser.parse(source).iterate({enter(node){
        if(node.name!=='FencedCode')return;
        const info=node.node.getChild('CodeInfo');
        if(info&&source.slice(info.from,info.to).trim().split(/\s/)[0].toLowerCase()===language){
            let previous=node.from;
            result.push(node.node.getChildren('CodeText').map(text=>{
                const gap=source.slice(previous,text.from).match(/\n/g)?.length||0;
                const prefix=previous===node.from?'':'\n'.repeat(gap);previous=text.to;
                return prefix+source.slice(text.from,text.to);
            }).join(''));
        }
        return false;
    }});
    return result;
}

/** Typora 把相邻块之间 2 个及以上的空行渲染为空段落 <p>&nbsp;</p>，它会截断页签组、分栏等相邻关系。
 *  导出前在源码对应位置补上这个空段落；顶层与引用块内部都处理，列表与代码内部的空行不处理。 */
export function insertTyporaBlankParagraphs(source:string):string {
    const inserts:{at:number,text:string}[]=[];
    const visit=(parent:SyntaxNode)=>{
        let prev:SyntaxNode|null=null;
        for(let child=parent.firstChild;child;child=child.nextSibling){
            if(child.name==='QuoteMark')continue;
            if(child.name==='Blockquote')visit(child);
            if(prev){
                const gap=source.slice(prev.to,child.from);
                if((gap.match(/\n/g)?.length||0)-1>=2&&!gap.replace(/[>\s]/g,'')){
                    const lineStart=source.lastIndexOf('\n',child.from-1)+1;
                    const prefix=source.slice(lineStart,child.from);
                    inserts.push({at:lineStart,text:`${prefix}<p>&nbsp;</p>\n${prefix.trimEnd()}\n`});
                }
            }
            prev=child;
        }
    };
    visit(fenceParser.parse(source).topNode);
    inserts.sort((x,y)=>x.at-y.at);
    let out='',last=0;
    for(const {at,text} of inserts){out+=source.slice(last,at)+text;last=at;}
    return out+source.slice(last);
}
