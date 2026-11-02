import {Autolink} from '@lezer/markdown';
import {fenceParser as parser} from './fenced-source';
import type { SourceIndex } from './source-index';
import { headingPlain } from './heading';
import { parseHtml } from "./dom";

const linksParser=parser.configure([Autolink,{
    defineNodes:['VlookWikiLink'],
    parseInline:[{name:'VlookWikiLink',before:'Link',parse(cx,next,pos){
        if(next!==91||cx.char(pos+1)!==91||cx.char(pos-1)===33)return -1;
        const match=cx.slice(pos,cx.end).match(/^\[\[[^\]\r\n]+\]\]/);
        return match?cx.addElement(cx.elt('VlookWikiLink',pos,pos+match[0].length)):-1;
    }}],
}]);
export interface SourceLink {title:string;href:string;line:number}
export interface LinkMapGroup {document:string;links:SourceLink[];anchors:{hash:string;count:number}[]}
const unescape=(text:string)=>text.replace(/\\([\\[\]()<>"'])/g,'$1');
const labelKey=(text:string)=>unescape(text).trim().replace(/\s+/g,' ').toLowerCase();

/** 全文语法树提取，图片和代码示例不当成链接；保留重复引用位置。 */
export function sourceLinks(index:SourceIndex):SourceLink[]{
    const source=index.text,fm=index.blocks.find(block=>block.type==='frontmatter');
    const masked=source.split('\n').map((line,n)=>fm&&n>=fm.start&&n<=fm.end?' '.repeat(line.length):line).join('\n');
    const tree=linksParser.parse(masked),definitions=new Map<string,string>(),result:SourceLink[]=[];
    const positions=new Map<SourceLink,number>();
    const add=(link:SourceLink,position:number)=>{result.push(link);positions.set(link,position);};
    const htmlRanges:{from:number;to:number}[]=[];
    tree.iterate({enter(node){
        if(node.name!=='HTMLTag'&&node.name!=='HTMLBlock')return;
        if(htmlRanges.some(range=>node.from>=range.from&&node.to<=range.to))return false;
        const rawText=masked.slice(node.from,node.to).match(/^<(script|style|textarea|title)\b/i);
        if(rawText){const after=node.from+rawText[0].length;const close=masked.slice(after).match(new RegExp(`<\\/${rawText[1]}\\s*>`,'i'));htmlRanges.push({from:node.from,to:close?after+close.index!+close[0].length:source.length});return false;}
        const raw=masked.slice(node.from,node.to).replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,value=>value.replace(/[^\n]/g,' '));
        for(const match of raw.matchAll(/<a\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)){
            const from=node.from+match.index!,after=from+match[0].length;
            const close=masked.slice(after).match(/<\/a\s*>/i),to=close?after+close.index!+close[0].length:after;
            const template={content:parseHtml(document,source.slice(from,to))};
            const anchor=template.content.querySelector('a'),href=anchor?.getAttribute('href');
            if(!anchor||!href)continue;
            htmlRanges.push({from,to});
            const title=anchor.getAttribute('aria-label')||anchor.textContent?.trim()||anchor.querySelector('img')?.getAttribute('alt')||href;
            add({title,href,line:source.slice(0,from).split('\n').length-1},from);
        }
        return false;
    }});
    tree.iterate({enter(node){
        if(node.name!=='LinkReference')return;
        const label=node.node.getChild('LinkLabel'),url=node.node.getChild('URL');
        if(label&&url){const key=labelKey(source.slice(label.from+1,label.to-1));if(!definitions.has(key))definitions.set(key,source.slice(url.from,url.to).replace(/^<|>$/g,''));}
        return false;
    }});
    tree.iterate({enter(node){
        if(node.name==='Image'||node.name==='LinkReference')return false;
        if(htmlRanges.some(range=>node.from>=range.from&&node.to<=range.to)&&['Link','Autolink','VlookWikiLink','URL'].includes(node.name))return false;
        if(!['Link','Autolink','VlookWikiLink','URL'].includes(node.name))return;
        const text=source.slice(node.from,node.to);let title='',href='';
        if(node.name==='VlookWikiLink'){
            const parts=text.slice(2,-2).split('|');href=parts[0];title=parts.slice(1).join('|')||href;
        }else{
            const url=node.node.getChild('URL'),label=node.node.getChild('LinkLabel');
            if(node.name==='Autolink'||node.name==='URL'){href=url?source.slice(url.from,url.to):text.replace(/^<|>$/g,'');if(/^[^@\s]+@[^@\s]+$/.test(href))href='mailto:'+href;title=href;}
            else{
                const close=node.node.getChildren('LinkMark').find(child=>child.name==='LinkMark'&&source.slice(child.from,child.to)===']');
                const rawTitle=source.slice(node.from+1,close?.from??node.to-1);
                const refKey=labelKey((label?source.slice(label.from+1,label.to-1):'')||rawTitle);
                if(!url&&refKey.startsWith('^'))return false;
                title=headingPlain('# '+rawTitle);
                href=url?source.slice(url.from,url.to).replace(/^<|>$/g,''):definitions.get(refKey)||'';
            }
        }
        href=unescape(href);
        if(href)add({title:title||href,href,line:source.slice(0,node.from).split('\n').length-1},node.from);
        return false;
    }});
    return result.sort((a,b)=>positions.get(a)!-positions.get(b)!);
}

export function linkMapGroups(index:SourceIndex):LinkMapGroup[]{
    const groups=new Map<string,LinkMapGroup>();
    for(const link of sourceLinks(index)){
        if(link.href.startsWith('#')||/^(?!https?:)[a-z][\w+.-]*:/i.test(link.href))continue;
        const split=link.href.indexOf('#'),document=split<0?link.href:link.href.slice(0,split),hash=split<0?'':link.href.slice(split+1);
        if(!document)continue;
        let group=groups.get(document);if(!group){group={document,links:[],anchors:[]};groups.set(document,group);}
        group.links.push(link);
        if(hash){const existing=group.anchors.find(anchor=>anchor.hash===hash);if(existing)existing.count++;else group.anchors.push({hash,count:1});}
    }
    return Array.from(groups.values());
}
