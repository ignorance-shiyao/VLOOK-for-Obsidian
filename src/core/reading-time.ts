import {parser} from '@lezer/markdown';
import { parseHtml, decodeEntities } from "./dom";
const readingParser=parser.configure({
    defineNodes:['ReadingWikiLink','ReadingWikiEmbed'],
    parseInline:[{name:'ReadingWiki',before:'Link',parse(cx,next,pos){
        if(next!==91&&next!==33)return -1;
        const match=cx.slice(pos,cx.end).match(/^(!?)\[\[[^\]\r\n]+\]\]/);
        return match?cx.addElement(cx.elt(match[1]?'ReadingWikiEmbed':'ReadingWikiLink',pos,pos+match[0].length)):-1;
    }}],
});

/** Same multilingual counter and 200/minute estimate as original V_countWord. */
export function vlookWordCount(text:string){
    const count=(pattern:RegExp)=>(text.match(pattern)||[]).length;
    const CJK=count(/[\u4e00-\u9fa5]/g)+count(/[\u3040-\u30ff\u31f0-\u31ff\uFF66-\uFF9F]/g)+count(/[\uac00-\ud7af]/g);
    const latin=count(/\b[\p{L}\p{M}\p{N}]+\b/gu)+count(/[\u0400-\u04FF]+/g)+count(/[\u0600-\u06FF]+/g);
    return {latin,CJK,total:latin+CJK};
}
export function readingDuration(total:number):string{
    const minutes=Math.max(1,Math.floor(Math.max(0,total)/200));
    return minutes>60?`${(minutes/60).toFixed(1)} 小时`:`${minutes} 分钟`;
}

/** Estimate from complete source rather than the reading view's virtualized DOM. */
export type EmbedResolver=(target:string)=>{id:string;source:string}|null;
export function readingText(source:string,embed?:EmbedResolver,depth=0,seen:ReadonlySet<string>=new Set()):string{
    source=source.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/,'');
    const replacements:Array<{from:number;to:number;text:string}>=[];
    readingParser.parse(source).iterate({enter(node){
        const name=node.name,raw=source.slice(node.from,node.to);
        if(name==='ReadingWikiEmbed'||name==='ReadingWikiLink'){
            const inner=raw.slice(2,-2),separator=inner.indexOf('|');
            replacements.push({from:node.from,to:node.to,text:name==='ReadingWikiEmbed'?embedText(raw.slice(3,-2),embed,depth,seen):separator<0?inner:inner.slice(separator+1)});return false;
        }
        if(['Image','LinkReference','LinkTitle','LinkLabel','CodeInfo','CodeMark'].includes(name)||(name==='URL'&&node.node.parent?.name==='Link')){
            replacements.push({from:node.from,to:node.to,text:' '});return false;
        }
        if(name==='HTMLBlock'||name==='HTMLTag'){
            let text='';
            if(name==='HTMLBlock'){
                const template={content:parseHtml(document,raw)};
                template.content.querySelectorAll('script,style').forEach(el=>el.remove());text=template.content.textContent||'';
            }
            replacements.push({from:node.from,to:node.to,text});return false;
        }
        if(name==='Entity'){
            replacements.push({from:node.from,to:node.to,text:decodeEntities(raw)});return false;
        }
    }});
    let text='',at=0;
    for(const item of replacements.sort((a,b)=>a.from-b.from)){if(item.from<at)continue;text+=source.slice(at,item.from)+item.text;at=item.to;}
    return text+source.slice(at);
}

function embedText(inner:string,embed:EmbedResolver|undefined,depth:number,seen:ReadonlySet<string>):string{
    if(!embed||depth>=3)return ' ';
    const target=inner.split('|')[0].split('#')[0].trim();
    const note=target?embed(target):null;
    if(!note||seen.has(note.id))return ' ';
    return ' '+readingText(note.source,embed,depth+1,new Set([...seen,note.id]))+' ';
}
