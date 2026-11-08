import {htmlLiteralRanges} from './html-literal';
import {fenceParser as parser} from './fenced-source';
import { sourceImages } from './image-source';
import { decodeUrlPart } from './url';
import { parseHtml } from "./dom";

/** 优先使用明确路径；再以稳定顺序或两侧唯一文件名恢复，歧义目标不猜测。 */
export function matchRenderedImages<T extends {raw:string}>(images:Element[],refs:T[]):(T|undefined)[]{
    const name=(value:string)=>{
        const base=value.split(/[?#]/)[0];
        if(/^(?:https?:)?\/\//i.test(base))return 'network:'+decodeUrlPart(base.replace(/^https?:/i,''));
        if(/^(?:data|blob):/i.test(base))return '';
        return decodeUrlPart(base).replace(/\\/g,'/').split('/').pop()||'';
    };
    const imageNames=images.map(image=>name(image.getAttribute('src')||'')),refNames=refs.map(ref=>name(ref.raw));
    const path=(value:string)=>decodeUrlPart(value.split(/[?#]/)[0]).replace(/\\/g,'/').replace(/^\.\//,'');
    const candidates=images.map(image=>{
        const current=path(image.getAttribute('src')||'');
        return refs.flatMap((ref,n)=>{
            const source=path(ref.raw);
            const relative=!/^(?:[a-z][\w+.-]*:|\/)/i.test(source)&&source.includes('/')&&!source.split('/').includes('..');
            return source && (current===source || (relative&&!/^(?:(?:https?:)?\/\/|data:|blob:)/i.test(current)&&current.endsWith('/'+source))) ? [n] : [];
        });
    });
    const exact=candidates.map(matches=>matches.length===1&&candidates.filter(other=>other.includes(matches[0])).length===1 ? matches[0] : undefined);
    const compatibleOrder=exact.every((ref,n)=>ref===undefined||ref===n);
    if(compatibleOrder&&images.length===refs.length&&imageNames.every((filename,n)=>filename ? filename===refNames[n] : images[n].getAttribute('src')===refs[n].raw))return refs;
    return imageNames.map((filename,n)=>{
        if(exact[n]!==undefined)return refs[exact[n]];
        if(!filename||imageNames.filter(value=>value===filename).length!==1||refNames.filter(value=>value===filename).length!==1)return undefined;
        return refs[refNames.indexOf(filename)];
    });
}

/** 与渲染图像一致的 Markdown / HTML 图片顺序；保留全文引用定义。 */
export function renderedSourceImages(markdown:string,doc:Document,definitions=markdown){
    const html:{pos:number;end:number;raw:string;alt:string;title?:string}[]=[];
    const ignored:{pos:number;end:number}[]=[];
    parser.parse(markdown).iterate({enter(node){
        if(['InlineCode','FencedCode','CodeBlock'].includes(node.name)){
            ignored.push({pos:node.from,end:node.to});return false;
        }
    }});
    let markup=markdown;
    for(const range of [...ignored].reverse())markup=markup.slice(0,range.pos)+markup.slice(range.pos,range.end).replace(/[^\n]/g,' ')+markup.slice(range.end);
    ignored.push(...htmlLiteralRanges(markup,true));
    parser.parse(markdown).iterate({enter(node){
        if(node.name==='CommentBlock'){ignored.push({pos:node.from,end:node.to});return false;}
        if(node.name!=='HTMLTag'&&node.name!=='HTMLBlock')return;
        const text=markdown.slice(node.from,node.to).replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,(value:string,_tag:string,offset:number)=>{
            ignored.push({pos:node.from+offset,end:node.from+offset+value.length});return value.replace(/[^\n]/g,' ');
        });
        for(const match of text.matchAll(/<img\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)){
            const pos=node.from+match.index;if(ignored.some(range=>pos>=range.pos&&pos<range.end))continue;
            const template={content:parseHtml(doc,match[0])};
            const image=template.content.querySelector('img'),raw=image?.getAttribute('src');
            if(raw!==null&&raw!==undefined)html.push({pos:node.from+match.index,end:node.from+match.index+match[0].length,raw,alt:image?.getAttribute('alt')||'',title:image?.getAttribute('title')||undefined});
        }
        return false;
    }});
    return [...sourceImages(markdown,definitions).filter(ref=>![...html,...ignored].some(tag=>ref.pos>=tag.pos&&ref.pos<tag.end)),...html].sort((a,b)=>a.pos-b.pos);
}
