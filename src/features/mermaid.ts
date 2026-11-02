import {currentLang} from '../core/i18n';

const FRAGMENTS:Record<string,{labels:[string,string];color?:string}>={
    alt:{labels:['分支','Alt.'],color:'vn'},opt:{labels:['可选','Opt.']},
    loop:{labels:['循环','Loop.'],color:'cy'},par:{labels:['并行','Par.'],color:'og'},
    break:{labels:['中断','Break'],color:'bk'},critical:{labels:['关键','Critical'],color:'rd'},
};
function importantStyle(element:SVGElement,name:string,value:string){
    if(element.style.getPropertyValue(name)!==value||element.style.getPropertyPriority(name)!=='important')element.style.setProperty(name,value,'important');
}
function fragments(svg:SVGElement,language:string){
    svg.querySelectorAll<SVGElement>('polygon.labelBox + text.labelText').forEach(label=>{
        const type=label.dataset.vlookSequenceType||(label.textContent||'').trim();
        const definition=FRAGMENTS[type],group=label.parentElement;if(!definition||!group)return;
        label.dataset.vlookSequenceType=type;label.textContent=definition.labels[language.startsWith('zh')?0:1];
        const children=Array.from(group.children);
        if(definition.color){
            for(const child of children){
                const element=child as SVGElement;
                if(child.matches('polygon.labelBox'))importantStyle(element,'fill',`var(--ac-${definition.color})`);
                if(child.matches('line.loopLine'))importantStyle(element,'stroke',`var(--ac-${definition.color})`);
                if(child.matches('text.loopText')){
                    importantStyle(element,'fill',`var(--ac-${definition.color}-lg)`);
                    child.querySelectorAll<SVGElement>('tspan').forEach(span=>importantStyle(span,'fill',`var(--ac-${definition.color}-lg)`));
                }
            }
        }
        const box=children.find(child=>child.matches('polygon.labelBox'));
        const points=(box?.getAttribute('points')||'').trim().split(/[\s,]+/).map(Number);
        const xs=points.filter((_n,i)=>i%2===0);
        if(points.length<4||points.some(n=>!Number.isFinite(n)))return;
        const right=Math.max(...xs);
        children.filter(child=>child.matches('text.loopText')).forEach((text,index)=>{
            const x=String(right+(index===0?10:40));(text as SVGElement).style.setProperty('text-anchor','start');text.setAttribute('x',x);
            text.querySelectorAll('tspan').forEach(span=>span.setAttribute('x',x));
        });
    });
}

/** VLOOK sequence role prefixes, adapted to the host Mermaid's SVG structure. */
export function processMermaid(root:HTMLElement,options:{fragments?:boolean;language?:string}={}):void{
    root.querySelectorAll<SVGElement>('svg[aria-roledescription="sequence"]').forEach(svg=>{
        const important=new Set<string>();
        svg.querySelectorAll<SVGElement>('rect.actor').forEach(actor=>{
            const label=actor.nextElementSibling;
            if(!label?.matches('text'))return;
            const text=label.textContent||'';
            const kind=text.startsWith('**')?'key-sys':text.startsWith('--')?'ext-sys':undefined;
            if(!kind)return;
            const cls=`v-actor-${kind}`;actor.classList.add(cls);label.classList.add(cls);
            label.querySelectorAll('tspan').forEach(span=>span.classList.add(cls));
            // Keep tspan layout and text nodes; only consume the two syntax characters.
            const walker=label.ownerDocument.createTreeWalker(label,4);let remaining=2;
            for(let node=walker.nextNode();node&&remaining;node=walker.nextNode()){
                const value=node.nodeValue||'',take=Math.min(remaining,value.length);node.nodeValue=value.slice(take);remaining-=take;
            }
            const name=actor.getAttribute('name');if(kind==='key-sys'&&name)important.add(name);
        });
        svg.querySelectorAll('line.actor-line').forEach(line=>{if(important.has(line.getAttribute('name')||''))line.classList.add('v-actor-key-sys');});
        svg.querySelectorAll('text.sequenceNumber').forEach(number=>number.removeAttribute('textLength'));
        if(options.fragments!==false)fragments(svg,options.language||currentLang());
    });
}
