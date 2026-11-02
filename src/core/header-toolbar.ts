export interface HeaderChoice {label:string;value:string;detail?:string;color?:string;color1?:string;color2?:string;group?:string;glyph?:string;glyphFont?:string}
export interface HeaderMenu {id:string;label:string;icon:string;choices:()=>HeaderChoice[];selected:()=>string|string[];choose:(value:string)=>unknown;toggle?:boolean;grid?:string[];slider?:HeaderSlider;icons?:Record<string,string>}
/** 连续取值（如字号）：min 对应「默认」(0)，拖动即时预览，松开后提交。 */
export interface HeaderSlider {title:string;min:number;max:number;value:()=>number;choose:(value:number)=>unknown;preview:string;unit?:string;step?:number;kind?:'font'|'width'}

/** Custom controls only: no native select or operating-system menu. */
export function createHeaderToolbar(doc:Document,menus:HeaderMenu[],icon?:(element:HTMLElement,name:string)=>void,onError?:(error:unknown)=>void){
    const root=doc.createElement('div');root.className='vlook-header-toolbar';root.setAttribute('role','toolbar');root.setAttribute('aria-label','VLOOK 页面工具');
    let panel:HTMLElement|null=null,anchor:HTMLButtonElement|null=null,disposed=false;
    const close=(focus=false)=>{panel?.remove();panel=null;anchor?.setAttribute('aria-expanded','false');if(focus)anchor?.focus();anchor=null;doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('keydown',key,true);doc.defaultView?.removeEventListener('resize',resize);};
    const outside=(event:Event)=>{const target=event.target as Node|null;if(target&&!panel?.contains(target)&&!anchor?.contains(target))close();};
    const resize=()=>close();
    const key=(event:KeyboardEvent)=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
        if(!panel?.contains(doc.activeElement))return;
        const buttons=Array.from(panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const i=buttons.indexOf(doc.activeElement as HTMLButtonElement);
        if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
            event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length;buttons[next]?.focus();
        }
        if(event.key==='Tab'){const button=anchor;close();button?.focus();}
    };
    const open=(menu:HeaderMenu,button:HTMLButtonElement)=>{
        if(disposed)return;if(anchor===button){close();return;}close();anchor=button;
        panel=doc.createElement('div');panel.className='vlook-header-menu';panel.setAttribute('role','menu');panel.setAttribute('aria-label',menu.label);
        if(menu.id==='font')panel.classList.add('vlook-header-menu-font');
        const title=doc.createElement('div');title.className='vlook-header-menu-title';title.textContent=menu.label;panel.append(title);
        const selected=menu.selected(),values=Array.isArray(selected)?selected:[selected];
        let group:string|undefined,container=panel;
        for(const choice of menu.choices()){
            if(choice.group!==group){
                group=choice.group;container=panel;
                if(group){
                    container=doc.createElement('div');container.className=menu.grid?.includes(group)?'vlook-header-group vlook-header-grid':'vlook-header-group';container.setAttribute('role','group');container.setAttribute('aria-label',group);
                    const heading=doc.createElement('div');heading.className='vlook-header-menu-title';heading.textContent=group;container.append(heading);panel.append(container);
                }
            }
            const item=doc.createElement('button');item.type='button';item.className='vlook-header-choice';item.setAttribute('role','menuitemradio');item.setAttribute('aria-checked',String(values.includes(choice.value)));
            const label=doc.createElement('span');label.textContent=choice.label;item.append(label);
            if(choice.glyph){const g=doc.createElement('span');g.className='vlook-header-glyph';g.textContent=choice.glyph;if(choice.glyphFont)g.style.fontFamily=choice.glyphFont;item.prepend(g);}
            if(choice.color){const dot=doc.createElement('span');dot.className='vlook-header-swatch';if(choice.color1&&choice.color2){dot.style.background=`linear-gradient(135deg,${choice.color1} 50%,${choice.color2} 50%)`;dot.classList.add('pair');}else dot.style.backgroundColor=choice.color;item.prepend(dot);}
            if(choice.detail){const detail=doc.createElement('small');detail.textContent=choice.detail;item.append(detail);}
            item.addEventListener('click',()=>{close(true);try{Promise.resolve(menu.choose(choice.value)).then(update).catch(error=>onError?.(error));}catch(error){onError?.(error);}});
            container.append(item);
        }
        if(menu.slider){
            const slider=menu.slider,width=slider.kind==='width',block=doc.createElement('div');block.className='vlook-header-slider';
            const heading=doc.createElement('div');heading.className='vlook-header-menu-title';heading.textContent=slider.title;
            const row=doc.createElement('div');row.className='vlook-header-slider-row';
            const input=doc.createElement('input');input.type='range';input.min=String(slider.min);input.max=String(slider.max);input.step=String(slider.step||1);input.setAttribute('aria-label',slider.title);
            const start=slider.value();input.value=String(start||slider.min);
            const stepBtn=(label:string,delta:number)=>{const b=doc.createElement('button');b.type='button';b.className='vlook-header-step';b.classList.add(delta<0?'is-minus':'is-plus');b.setAttribute('aria-label',label);b.addEventListener('click',()=>{input.value=String(Math.max(slider.min,Math.min(slider.max,Number(input.value)+delta*(slider.step||1))));show();commit();});return b;};
            const badge=doc.createElement('span');badge.className='vlook-header-slider-value';
            const card=doc.createElement('div');card.className='vlook-header-slider-card';
            const caption=doc.createElement('div');caption.className='vlook-header-slider-caption';caption.textContent=slider.preview;
            const sample=doc.createElement('div');sample.className='vlook-header-slider-preview';sample.textContent=width?'':`${slider.preview} Aa 123`;if(width)card.classList.add('is-width');
            card.append(caption,sample);
            const show=()=>{const n=Number(input.value),size=n<=slider.min?15:n;badge.textContent=n<=slider.min?'默认':`${n}${slider.unit||''}`;if(width){sample.style.width=`${Math.max(20,(n<=slider.min?900:n)/slider.max*100)}%`;}else sample.style.fontSize=`${size}px`;input.style.setProperty('--fill',`${(n-slider.min)/(slider.max-slider.min)*100}%`);};
            const commit=()=>{const n=Number(input.value);try{Promise.resolve(slider.choose(n<=slider.min?0:n)).then(update).catch(error=>onError?.(error));}catch(error){onError?.(error);}};
            input.addEventListener('input',show);input.addEventListener('change',commit);
            show();row.append(stepBtn(width?'变窄':'减小字号',-1),input,stepBtn(width?'变宽':'增大字号',1),badge);block.append(heading,row,card);panel.append(block);
        }
        doc.body.append(panel);button.setAttribute('aria-expanded','true');
        const win=doc.defaultView!,rect=button.getBoundingClientRect(),width=Math.min(menu.id==='font'||menu.id==='width'?290:240,win.innerWidth-24);
        Object.assign(panel.style,{width:`${width}px`,left:`${Math.max(12,Math.min(rect.right-width,win.innerWidth-width-12))}px`,top:`${rect.bottom+6}px`,maxHeight:`${Math.max(120,win.innerHeight-rect.bottom-18)}px`});
        doc.addEventListener('pointerdown',outside,true);doc.addEventListener('keydown',key,true);win.addEventListener('resize',resize);
        panel.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();if(!panel.contains(doc.activeElement))panel.querySelector<HTMLButtonElement>('button')?.focus();
    };
    const labels=new Map<HeaderMenu,{button:HTMLButtonElement;label:HTMLElement;glyph:HTMLElement}>();
    /** 触发按钮直接显示当前选项，切换后一眼可见。 */
    const update=()=>{
        for(const [menu,{button,label,glyph}] of labels){
            const selected=menu.selected(),values=Array.isArray(selected)?selected:[selected];
            const current=menu.choices().find(choice=>values.includes(choice.value))?.label.replace(/（默认）$/,'');
            label.textContent=current||menu.label;
            const match=menu.choices().find(choice=>values.includes(choice.value));
            const name=match&&menu.icons?.[match.value];
            if(name&&glyph.dataset.icon!==name){glyph.dataset.icon=name;glyph.replaceChildren();icon?.(glyph,name);}
            glyph.style.color=menu.id==='theme'&&match?.color?match.color:'';
            button.setAttribute('aria-label',current?`${menu.label}：${current}`:menu.label);
            button.title=current?`${menu.label}：${current}`:menu.label;
        }
    };
    for(const menu of menus){
        const button=doc.createElement('button');button.type='button';button.className='vlook-header-trigger';button.setAttribute('aria-label',menu.label);button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');
        const glyph=doc.createElement('span');glyph.className='vlook-header-icon';glyph.setAttribute('aria-hidden','true');icon?.(glyph,menu.icon);button.append(glyph);
        const label=doc.createElement('span');label.className='vlook-header-label';label.textContent=menu.label;button.append(label);
        labels.set(menu,{button,label,glyph});
        if(menu.toggle){
            button.removeAttribute('aria-haspopup');button.removeAttribute('aria-expanded');
            // 两态菜单直接切换到另一项
            button.addEventListener('click',()=>{
                close();const selected=menu.selected(),next=menu.choices().find(choice=>choice.value!==selected);if(!next)return;
                try{Promise.resolve(menu.choose(next.value)).then(update).catch(error=>onError?.(error));}catch(error){onError?.(error);}
            });
            root.append(button);continue;
        }
        button.addEventListener('click',()=>open(menu,button));button.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();open(menu,button);}});root.append(button);
    }
    update();
    root.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        const buttons=Array.from(root.querySelectorAll<HTMLButtonElement>(':scope > button'));
        const index=buttons.indexOf(doc.activeElement as HTMLButtonElement);if(index<0)return;
        event.preventDefault();close();
        const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length;
        buttons[next]?.focus();
    });
    return {element:root,close,update,dispose(){disposed=true;close();root.remove();}};
}
