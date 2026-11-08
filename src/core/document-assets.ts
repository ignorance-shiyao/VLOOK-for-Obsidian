import { newEl, setHtml } from './dom';
/** 最近用过的主题保留已解析的样式表，切换时只启停，不再重新解析 CSS。 */
const KEPT_THEMES=3;
interface Entry {sprite:HTMLElement;styles:Map<string,{el:HTMLStyleElement;css:string}>;enabled:boolean}

/** Own only the nodes and body class installed by this plugin in each app window. */
export class DocumentAssets {
    private documents = new Map<Document,Entry>();
    private pending = new Map<Document,()=>void>();
    private theme: string | null = null;
    private css = '';
    private disposed = false;
    constructor(private readonly icons:string) {}

    attach(doc:Document):void {
        if(this.disposed||this.documents.has(doc)||this.pending.has(doc))return;
        if(!doc.body||!doc.head){
            const ready=()=>{this.pending.delete(doc);this.attach(doc);};
            this.pending.set(doc,ready);doc.addEventListener('DOMContentLoaded',ready,{once:true});return;
        }
        const sprite=newEl(doc, 'div');sprite.className='vlook-icon-sprite';sprite.hidden=true;setHtml(sprite,this.icons);
        const entry:Entry={sprite,styles:new Map(),enabled:doc.body.classList.contains('vlook-enabled')};
        this.documents.set(doc,entry);doc.body.append(sprite);doc.body.classList.add('vlook-enabled');
        this.apply(doc,entry);
    }
    setStyle(theme:string|null,css=''):void {
        if(this.disposed || (this.theme===theme && this.css===css))return;
        this.theme=theme;this.css=css;
        this.documents.forEach((entry,doc)=>this.apply(doc,entry));
    }
    private apply(doc:Document,entry:Entry):void {
        const theme=this.theme;
        if(!theme){this.clear(entry);return;}
        let slot=entry.styles.get(theme);
        if(!slot){slot={el:newEl(doc, 'style'),css:''};doc.head.append(slot.el);}
        if(slot.css!==this.css||!slot.el.textContent){slot.el.textContent=this.css;slot.css=this.css;}
        entry.styles.delete(theme);entry.styles.set(theme,slot);
        // 移动端内存与 WebView 对超大样式表的启停都不可靠：只保留当前主题，切换时直接替换
        const kept=doc.body.classList.contains('is-mobile')?1:KEPT_THEMES;
        while(entry.styles.size>kept){const [oldest,old]=entry.styles.entries().next().value!;old.el.remove();entry.styles.delete(oldest);}
        entry.styles.forEach((item,name)=>{
            const active=name===theme;
            item.el.disabled=!active;
            if(active){item.el.id='vlook-theme-style';item.el.dataset.theme=name;}else item.el.removeAttribute('id');
        });
        this.verify(doc,slot,theme,0);
    }
    /** 超大样式表偶发解析为空（移动端 WebView）：确认已生成规则，否则重新写入，最多三次。 */
    private verify(doc:Document,slot:{el:HTMLStyleElement;css:string},theme:string,attempt:number):void {
        const win=doc.defaultView;if(!win||attempt>=3)return;
        win.setTimeout(()=>{
            if(this.disposed||this.theme!==theme||!slot.el.isConnected)return;
            let ok=true;try{ok=!!slot.el.sheet&&slot.el.sheet.cssRules.length>0;}catch{ok=true;}
            if(ok)return;
            slot.el.disabled=false;slot.el.textContent='';slot.el.textContent=slot.css;
            this.verify(doc,slot,theme,attempt+1);
        },400*(attempt+1));
    }
    private clear(entry:Entry):void {entry.styles.forEach(item=>item.el.remove());entry.styles.clear();}
    detach(doc:Document):void {
        const ready=this.pending.get(doc);if(ready){doc.removeEventListener('DOMContentLoaded',ready);this.pending.delete(doc);}
        const entry=this.documents.get(doc);if(!entry)return;
        entry.sprite.remove();this.clear(entry);if(!entry.enabled)doc.body?.classList.remove('vlook-enabled');
        this.documents.delete(doc);
    }
    dispose():void {
        this.disposed=true;
        for(const doc of [...this.documents.keys(),...this.pending.keys()])this.detach(doc);
    }
}
