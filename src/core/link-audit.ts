import { vlookAnchor } from './anchor';
import { quoteSourceTitles } from './quote-source';
import type { App, TFile } from 'obsidian';
import {fenceParser as parser} from './fenced-source';
import { getSourceIndex, type SourceIndex } from './source-index';
import { sourceLinks, type SourceLink } from './link-map';
import { headingPlain } from './heading';
import { captionTargets } from './caption-targets';
import { decodeUrlPart } from './url';
import { resolveVaultLink } from '../preview/links';
import { unpublishedMatcher } from './unpublished';
import { sourceImages } from './image-source';
import { parseHtml } from "./dom";

export interface LinkAuditResult {link:SourceLink;status:'ok'|'missing-file'|'missing-anchor'|'missing-resource'|'unchecked'|'warning';detail:string}
const key=vlookAnchor;
export function duplicateAnchorWarnings(index:SourceIndex):LinkAuditResult[]{
    const allowed=unpublishedMatcher(index.frontmatter['vlook-header-dup']),seen=new Map<string,number>(),results:LinkAuditResult[]=[];
    for(const block of index.blocks){
        const titles:{title:string;line:number}[]=[];
        if(block.type==='heading'&&!block.cover)titles.push({title:headingPlain(block.text),line:block.start});
        titles.push(...captionTargets(block,index.text));
        if(['blockquote','callout','list'].includes(block.type))titles.push(...quoteSourceTitles(block.text).map(item=>({title:item.title,line:block.start+item.line})));
        titles.sort((a,b)=>a.line-b.line);
        for(const {title,line} of titles){
            if(!title.trim())continue;
            const identity=key(title),first=seen.get(identity);
            if(first===undefined){seen.set(identity,line);continue;}
            if(!allowed(title))results.push({link:{title,href:'#'+title,line},status:'warning',detail:`标题或题注重复，锚点可能指向第 ${first+1} 行的首次出现位置`});
        }
    }
    return results;
}
export function hasSourceAnchor(index:SourceIndex,anchor:string):boolean {
    if(!anchor)return true;
    const requested=decodeUrlPart(anchor),headings=new Set<string>(),exact=new Set<string>(),blocks=new Set<string>();
    for(const block of index.blocks){
        if(['blockquote','callout','list'].includes(block.type))for(const item of quoteSourceTitles(block.text))headings.add(key(item.title));
        if(block.type==='heading')headings.add(key(headingPlain(block.text)));
        for(const caption of captionTargets(block,index.text))headings.add(key(caption.title));
    }
    const excluded:{from:number;to:number}[]=[];
    const fm=index.blocks.find(block=>block.type==='frontmatter');
    const masked=index.text.split('\n').map((line,n)=>fm&&n>=fm.start&&n<=fm.end?' '.repeat(line.length):line).join('\n');
    parser.parse(masked).iterate({enter(node){
        if(['FencedCode','CodeBlock','InlineCode','CommentBlock'].includes(node.name)){excluded.push({from:node.from,to:node.to});return false;}
        if(node.name==='HTMLTag'||node.name==='HTMLBlock'){
            const template={content:parseHtml(activeDocument,index.text.slice(node.from,node.to))};
            template.content.querySelectorAll<HTMLElement>('[id],a[name]').forEach(element=>{if(element.id)exact.add(element.id);const name=element.getAttribute('name');if(name)exact.add(name)});
            excluded.push({from:node.from,to:node.to});return false;
        }
    }});
    for(const match of index.text.matchAll(/(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/gm)){
        const position=match.index,line=index.text.slice(0,position).split('\n').length-1;
        if(fm&&line>=fm.start&&line<=fm.end||excluded.some(range=>position>=range.from&&position<range.to))continue;
        blocks.add(match[1]);
    }
    return requested.startsWith('^')?blocks.has(requested.slice(1)):headings.has(key(requested))||exact.has(requested);
}

/** 仅检查本地可读取目标；不把未请求的远程地址或附件锚点标记为通过。 */
export async function auditVaultLinks(app:App,file:TFile,source:string):Promise<LinkAuditResult[]>{
    const index=getSourceIndex(source,{captionGroup:false,captionNumber:true}),results:LinkAuditResult[]=[];
    const documents=new Map<string,Promise<SourceIndex>>([[file.path,Promise.resolve(index)]]);
    for(const link of sourceLinks(index)){
        const href=link.href;
        if(/^(?:[a-z][\w+.-]*:|\/\/)/i.test(href)){results.push({link,status:'unchecked',detail:'远程或应用协议链接未检查'});continue;}
        const match=href.match(/^([^?#]*)(\?[^#]*)?(?:#(.*))?$/);if(!match){results.push({link,status:'unchecked',detail:'地址格式未识别'});continue;}
        const path=decodeUrlPart(match[1]),anchor=match[3]||'';
        const target=!path?file:app.metadataCache.getFirstLinkpathDest(path,file.path)||resolveVaultLink(app,href,file.path)?.file;
        if(!target){results.push({link,status:'missing-file',detail:'目标文件未找到'});continue;}
        if(!anchor){results.push({link,status:'ok',detail:'目标文件存在'});continue;}
        if(decodeUrlPart(anchor).startsWith('mjx-')){
            results.push({link,status:'unchecked',detail:'MathJax 公式锚点需在目标文档渲染后检查'});continue;
        }
        if(target.extension!=='md'&&target.extension!=='html'&&target.extension!=='htm'){results.push({link,status:'unchecked',detail:'附件存在，内部锚点未检查'});continue;}
        try{
            let document=documents.get(target.path);
            if(!document){document=app.vault.cachedRead(target).then(text=>getSourceIndex(text,{captionGroup:false,captionNumber:true}));documents.set(target.path,document);}
            const exists=hasSourceAnchor(await document,anchor);
            results.push({link,status:exists?'ok':'missing-anchor',detail:exists?'目标锚点存在':'目标锚点未找到'});
        }catch{results.push({link,status:'unchecked',detail:'目标文件暂时无法读取'});}
    }
    return [...results,...duplicateAnchorWarnings(index)];
}

/** 枚举全文本地图片与嵌入文件，不依赖阅读视图是否已渲染；远程地址不检查。 */
export function auditLocalResources(app:App,file:TFile,source:string):LinkAuditResult[]{
    const results:LinkAuditResult[]=[],seen=new Set<string>();
    const add=(title:string,href:string,line:number,found:boolean)=>{
        const id=`${line}\u0000${href}`;if(seen.has(id))return;seen.add(id);
        if(!found)results.push({link:{title,href,line},status:'missing-resource',detail:'资源文件未找到'});
    };
    const lineAt=(pos:number)=>source.slice(0,pos).split('\n').length-1;
    for(const image of sourceImages(source)){
        if(/^(?:[a-z][\w+.-]*:|\/\/)/i.test(image.raw))continue;
        const path=decodeUrlPart(image.raw.split(/[?#]/)[0]);if(!path)continue;
        add(image.alt||'图片',image.raw,lineAt(image.pos),!!(app.metadataCache.getFirstLinkpathDest(path,file.path)||resolveVaultLink(app,image.raw,file.path)?.file));
    }
    let fence='';
    source.split('\n').forEach((text,line)=>{
        const mark=text.match(/^ {0,3}(`{3,}|~{3,})/);
        if(fence){if(mark&&mark[1][0]===fence[0]&&mark[1].length>=fence.length)fence='';return;}
        if(mark){fence=mark[1];return;}
        for(const match of text.matchAll(/!\[\[([^\]\r\n|#]+)(?:[#|][^\]\r\n]*)?\]\]/g)){
            const name=match[1].trim();
            add(name,name,line,!!app.metadataCache.getFirstLinkpathDest(name,file.path));
        }
    });
    return results;
}
