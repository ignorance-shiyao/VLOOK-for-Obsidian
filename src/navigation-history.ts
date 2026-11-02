import { App, FuzzySuggestModal, MarkdownView } from 'obsidian';
import type VlookPlugin from './main';
import { notify } from "./notify";

export class LineHistory {
    private lines:number[]=[];
    private at=-1;
    push(origin:number,target:number) {
        if(origin===target)return;
        this.lines=this.lines.slice(0,this.at+1);
        if(this.lines[this.at]!==origin){this.lines.push(origin);this.at++;}
        if(this.lines[this.at]!==target){this.lines.push(target);this.at++;}
        if(this.lines.length>200){const count=this.lines.length-200;this.lines.splice(0,count);this.at-=count;}
    }
    move(delta:number):number|undefined {
        const next=this.at+delta;
        if(next<0||next>=this.lines.length)return;
        this.at=next;return this.lines[this.at];
    }
    entries(){return this.lines.map((line,index)=>({line,index}));}
    select(index:number){if(index<0||index>=this.lines.length)return;this.at=index;return this.lines[index];}
}
const stores=new WeakMap<App,Map<string,LineHistory>>();
function history(app:App,path:string) {
    let files=stores.get(app);if(!files){files=new Map();stores.set(app,files);}
    let value=files.get(path);if(!value){value=new LineHistory();files.set(path,value);}
    return value;
}
function currentLine(view:MarkdownView):number {
    if(view.getMode()==='source')return view.editor.getCursor().line;
    const top=view.contentEl.getBoundingClientRect().top;
    const blocks=Array.from(view.contentEl.querySelectorAll<HTMLElement>('[data-vlook-source-line]'))
        .filter(el=>el.getBoundingClientRect().bottom>top&&el.getBoundingClientRect().height>0);
    blocks.sort((a,b)=>Math.abs(a.getBoundingClientRect().top-top)-Math.abs(b.getBoundingClientRect().top-top));
    return Number(blocks[0]?.dataset.vlookSourceLine||0);
}
export function navigationSourceView(app:App,path:string,element:HTMLElement):MarkdownView|null {
    const own=app.workspace.getLeavesOfType?.('markdown').map(leaf=>leaf.view as MarkdownView)
        .find(view=>view.file?.path===path && view.contentEl?.contains(element));
    if(own)return own;
    const active=app.workspace.getActiveViewOfType?.(MarkdownView);
    return active?.file?.path===path?active:null;
}
export function recordLineNavigation(app:App,path:string,target:number,sourceView?:MarkdownView|null) {
    const view=sourceView || app.workspace.getActiveViewOfType?.(MarkdownView);
    if(view?.file?.path===path)history(app,path).push(currentLine(view),target);
}
export function navigateViewLine(view:MarkdownView,line:number) {
    if(view.file)history(view.app,view.file.path).push(currentLine(view),line);
    applyLine(view,line);
}
function applyLine(view:MarkdownView,line:number) {
    const max=Math.max(0,view.editor.lineCount()-1);line=Math.max(0,Math.min(max,line));
    view.setEphemeralState({line});
    if(view.getMode()==='source'){
        view.editor.setCursor({line,ch:0});
        view.editor.scrollIntoView({from:{line,ch:0},to:{line,ch:0}},true);
    }
}
class HistoryModal extends FuzzySuggestModal<{line:number;index:number}> {
    constructor(private view:MarkdownView,private value:LineHistory){super(view.app);this.setPlaceholder('搜索文内导航历史');}
    getItems(){return this.value.entries().reverse();}
    getItemText(item:{line:number;index:number}){return `第 ${item.line+1} 行 · ${this.view.editor.getLine(Math.min(item.line,this.view.editor.lineCount()-1)) || '空行'}`;}
    onChooseItem(item:{line:number;index:number}){const line=this.value.select(item.index);if(line!==undefined)applyLine(this.view,line);}
}
export function registerNavigationHistory(plugin:VlookPlugin) {
    const active=()=>plugin.app.workspace.getActiveViewOfType(MarkdownView);
    for(const [id,name,step] of [['back','返回上一文内位置',-1],['forward','前进到下一文内位置',1]] as const)
        plugin.addCommand({id:`history-${id}`,name,callback:()=>{
            const view=active();if(!view?.file)return;
            const line=history(plugin.app,view.file.path).move(step);
            if(line===undefined)notify('没有更多文内导航历史');else applyLine(view,line);
        }});
    plugin.addCommand({id:'navigation-history',name:'文内导航历史',callback:()=>{
        const view=active();if(view?.file)new HistoryModal(view,history(plugin.app,view.file.path)).open();
    }});
    plugin.registerEvent(plugin.app.vault.on('delete',file=>{
        const files=stores.get(plugin.app);
        for(const path of files?.keys() || [])if(path===file.path || path.startsWith(file.path+'/'))files!.delete(path);
    }));
    plugin.registerEvent(plugin.app.vault.on('rename',(file,old)=>{
        const files=stores.get(plugin.app);
        for(const [path,value] of Array.from(files?.entries() || []))
            if(path===old || path.startsWith(old+'/')){files!.delete(path);files!.set(file.path+path.slice(old.length),value);}
    }));
    // 修改后旧行号可能对应不同章节，清除历史避免错误定位。
    plugin.registerEvent(plugin.app.vault.on('modify',file=>stores.get(plugin.app)?.delete(file.path)));
    plugin.register(()=>stores.delete(plugin.app));
}
