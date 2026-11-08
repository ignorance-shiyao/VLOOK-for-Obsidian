import {htmlLiteralRanges} from './html-literal';
import {fenceParser as parser} from './fenced-source';
import { sourceImages } from './image-source';
import type { Block } from './source-index';
import { parseHtml } from "./dom";

/** Source-order Markdown / HTML figures, excluding media and special layouts. */
export function figureSources(block: Block, source: string, doc?: Document) {
    if (!['html','paragraph','image','table','blockquote','callout','list'].includes(block.type)) return [];
    const ignored: {from:number;to:number}[]=[];
    const htmlRanges: {from:number;to:number}[]=[];
    let buttonStart: number | undefined, buttonDepth=0;
    parser.parse(block.text).iterate({enter(node){
        if(node.name==='HTMLTag'||node.name==='HTMLBlock')htmlRanges.push({from:node.from,to:node.to});
        if(node.name==='HTMLTag'){
            const tag=block.text.slice(node.from,node.to);
            if(/^<kbd(?:\s|>)/i.test(tag)){
                if(buttonDepth++===0)buttonStart=node.from;
            }else if(/^<\/kbd\s*>/i.test(tag)&&buttonDepth>0){
                if(--buttonDepth===0){ignored.push({from:buttonStart!,to:node.to});buttonStart=undefined;}
            }
        }
        if(['InlineCode','FencedCode','CodeBlock','HTMLTag','HTMLBlock','CommentBlock'].includes(node.name)){
            ignored.push({from:node.from,to:node.to});return false;
        }
    }});
    if(buttonStart!==undefined)ignored.push({from:buttonStart,to:block.text.length});
    const regular=(raw:string)=>{
        const path=raw.split(/[?#]/)[0],hash=raw.includes('#')?raw.slice(raw.indexOf('#')):'';
        return !/\.(md|canvas|base|mp3|m4a|ogg|wav|mp4|webm|ogv|mov|m4v)$/i.test(path)&&!/#(?:icon|logo|card)/.test(hash);
    };
    let markup=block.text.replace(/[^\n]/g,' ');
    for(const range of htmlRanges)markup=markup.slice(0,range.from)+block.text.slice(range.from,range.to)+markup.slice(range.to);
    markup=markup.replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,value=>value.replace(/[^\n]/g,' '));
    const literalRanges=htmlLiteralRanges(markup);
    ignored.push(...literalRanges.map(range=>({from:range.pos,to:range.end})));
    const html: ReturnType<typeof sourceImages>=[];
    let depth=0;
    for(const token of markup.matchAll(/<\/?[A-Za-z][\w:-]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g)){
        if(/^<kbd(?:\s|>)/i.test(token[0])){depth++;continue;}
        if(/^<\/kbd\s*>/i.test(token[0])){depth=Math.max(0,depth-1);continue;}
        if(depth||!/^<img\b/i.test(token[0]))continue;
        if(literalRanges.some(range=>token.index>=range.pos&&token.index<range.end))continue;
        const attrs=Array.from(token[0].slice(4).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g));
        const attr=(name:string)=>{const value=attrs.find(item=>item[1].toLowerCase()===name);return value?(value[2]??value[3]??value[4]??'').replace(/&(?:amp|#38|#x26);/gi,'&'):undefined;};
        let raw=attr('src'),alt=attr('alt')||'',title=attr('title');
        if(doc){const template={content:parseHtml(doc,token[0])};const image=template.content.querySelector('img');raw=image?.getAttribute('src')??raw;alt=image?.getAttribute('alt')||'';title=image?.getAttribute('title')||undefined;}
        if(raw&&regular(raw))html.push({raw,alt,title,pos:token.index,end:token.index+token[0].length});
    }
    const markdown=sourceImages(block.text,source).filter(ref=>!ignored.some(range=>ref.pos>=range.from&&ref.pos<range.to)&&regular(ref.raw));
    return [...markdown,...html].sort((a,b)=>a.pos-b.pos);
}
