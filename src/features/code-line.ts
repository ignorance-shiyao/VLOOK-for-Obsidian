/** Highlight logical source lines without rebuilding the host's token spans. */
export function bindCodeLine(pre:HTMLElement,code:HTMLElement):()=>void {
    const doc=code.ownerDocument;
    const overlay=doc.createElement('div');overlay.className='vlook-code-active-line';overlay.setAttribute('aria-hidden','true');overlay.hidden=true;pre.append(overlay);
    const clear=()=>{overlay.hidden=true;delete pre.dataset.vlookActiveLine;};
    const move=(event:PointerEvent)=>{
        const bounds=code.getBoundingClientRect();
        if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom){clear();return;}
        const caretDoc=doc as Document&{caretRangeFromPoint?:(x:number,y:number)=>Range|null;caretPositionFromPoint?:(x:number,y:number)=>{offsetNode:Node;offset:number}|null};
        const caret=caretDoc.caretRangeFromPoint?.(event.clientX,event.clientY);
        const position=caret?{offsetNode:caret.startContainer,offset:caret.startOffset}:caretDoc.caretPositionFromPoint?.(event.clientX,event.clientY);
        if(!position||!code.contains(position.offsetNode)){clear();return;}
        const prefix=doc.createRange();prefix.selectNodeContents(code);prefix.setEnd(position.offsetNode,position.offset);
        const offset=prefix.toString().length,source=code.textContent||'';
        const start=offset===0?0:source.lastIndexOf('\n',offset-1)+1;
        const newline=source.indexOf('\n',offset),end=newline<0?source.length:newline+1;
        const range=doc.createRange(),walker=doc.createTreeWalker(code,4);
        let consumed=0,hasStart=false,hasEnd=false;
        for(let node=walker.nextNode();node;node=walker.nextNode()){
            const length=node.textContent?.length||0;
            if(!hasStart&&start<=consumed+length){range.setStart(node,Math.max(0,start-consumed));hasStart=true;}
            if(end<=consumed+length){range.setEnd(node,Math.max(0,end-consumed));hasEnd=true;break;}
            consumed+=length;
        }
        if(!hasStart||!hasEnd){clear();return;}
        const rects=Array.from(range.getClientRects()).filter(rect=>rect.height>0);
        if(!rects.length){clear();return;}
        const parent=pre.getBoundingClientRect();
        const top=Math.max(bounds.top,parent.top,Math.min(...rects.map(r=>r.top)));
        const bottom=Math.min(bounds.bottom,parent.bottom,Math.max(...rects.map(r=>r.bottom)));
        const left=Math.max(bounds.left,parent.left),right=Math.min(bounds.right,parent.right);
        if(bottom<=top||right<=left){clear();return;}
        overlay.style.cssText=`top:${top-parent.top+pre.scrollTop-pre.clientTop}px;left:${left-parent.left+pre.scrollLeft-pre.clientLeft}px;width:${right-left}px;height:${bottom-top}px;`;
        overlay.hidden=false;pre.dataset.vlookActiveLine=String(source.slice(0,start).split('\n').length);
    };
    pre.addEventListener('pointermove',move);pre.addEventListener('pointerleave',clear);
    code.addEventListener('scroll',clear);pre.addEventListener('scroll',clear);
    return ()=>{pre.removeEventListener('pointermove',move);pre.removeEventListener('pointerleave',clear);code.removeEventListener('scroll',clear);pre.removeEventListener('scroll',clear);overlay.remove();delete pre.dataset.vlookActiveLine;};
}
