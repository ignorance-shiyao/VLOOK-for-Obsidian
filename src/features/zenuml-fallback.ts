import {diagramElements} from '../core/diagram-dom';
import {sourceFences} from '../core/fenced-source';
import {applyZenUmlPalette} from '../core/zenuml-palette';
import {zenUmlChunk,zenUmlEnabled} from '../core/zenuml-loader';
import { newEl, parseHtml } from '../core/dom';
interface Lifecycle {register(cleanup:()=>void):void}
let counter=0;
const requests=new WeakMap<HTMLElement,object>();
const hasRenderedSvg=(node:HTMLElement)=>!!node.querySelector('svg')&&!node.querySelector('svg .error-icon,svg .error-text');

/** Pele hosts cannot register Mermaid extensions. Render ZenUML fences and recover native error containers. */
export async function renderZenUmlFallback(root:HTMLElement,lifecycle:Lifecycle,
    load?:()=>Promise<{renderToSvg:(source:string)=>{svg:string}}>, markdown=''):Promise<void> {
    const request={};requests.set(root,request);
    const owner=root.ownerDocument;
    const sources=sourceFences(markdown,'mermaid');
    const diagrams=diagramElements(root);
    const targets=diagrams.flatMap((node:HTMLElement,n:number):{node:HTMLElement;source:string;text:string|null}[]=>{
        const source=node.matches('code')?node.textContent||'':sources.length===diagrams.length?sources[n]:'';
        return /^\s*zenuml\b/i.test(source)&&!hasRenderedSvg(node) ? [{node,source,text:node.textContent}] : [];
    });
    if(!targets.length)return;
    if(!load&&!zenUmlEnabled()){
        // 未启用 ZenUML：保留源码，避免宿主报出图表错误
        for(const {node,source} of targets){
            const pre=newEl(owner, 'pre'),code=newEl(owner, 'code');
            pre.className='vlook-zenuml-source';code.className='language-zenuml';code.textContent=source;pre.append(code);
            if(node.matches('code'))node.parentElement?.replaceWith(pre);else node.replaceWith(pre);
        }
        return;
    }
    load??=async()=>(await zenUmlChunk()).core;
    let active=true;lifecycle.register(()=>{active=false;if(requests.get(root)===request)requests.delete(root)});
    const renderer=await load();
    if(!active||requests.get(root)!==request||root.ownerDocument!==owner)return;
    for(const {node,source:original,text} of targets){
        if(!root.contains(node)||node.textContent!==text||hasRenderedSvg(node))continue;
        const source=original.replace(/^\s*zenuml\b/i,'');
        const result=renderer.renderToSvg(source);
        const template={content:parseHtml(root.ownerDocument,result.svg)};
        const svg=template.content.querySelector('svg');
        if(!svg)throw Error('ZenUML 未生成 SVG');
        svg.id=`vlook-zenuml-${++counter}`;applyZenUmlPalette(svg);
        if(node===root){root.dataset.vlookDiagramKind='zenuml';root.replaceChildren(svg);continue;}
        const container=newEl(root.ownerDocument, 'div');container.className='mermaid';
        container.dataset.vlookDiagramKind='zenuml';container.append(svg);
        if(node.matches('code'))node.parentElement?.replaceWith(container);else node.replaceWith(container);
    }
}
