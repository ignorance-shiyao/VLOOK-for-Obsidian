import {readCssVar} from '../core/context';
import {StateEffect,StateField,type EditorState} from '@codemirror/state';
import {EditorView,ViewPlugin} from '@codemirror/view';
export const editorThemeRefreshEffect=StateEffect.define<number>();
export const editorThemeRevision=StateField.define<number>({
    create:()=>0,
    update:(value,tr)=>{for(const effect of tr.effects)if(effect.is(editorThemeRefreshEffect))value=effect.value;return value;},
});

export interface EditorThemeConfig {query:string;headerTemplate:string}
export const editorThemeConfigEffect=StateEffect.define<EditorThemeConfig>();
export const editorThemeConfigField=StateField.define<EditorThemeConfig|null>({
    create:()=>null,
    update:(value,tr)=>{for(const effect of tr.effects)if(effect.is(editorThemeConfigEffect))value=effect.value;return value;},
});
export function currentEditorTheme(state:EditorState):EditorThemeConfig {
    return state.field(editorThemeConfigField,false) || {query:readCssVar('--vlook-query'),headerTemplate:readCssVar('--vlook-header-autonum')};
}

/** Track actual editor views without relying on Obsidian's private editor.cm property. */
export class EditorThemeRefresh {
    private views=new Map<EditorView,{pending:boolean}>();
    private revision=0;
    private disposed=false;
    attach(view:EditorView):()=>void {
        if(this.disposed)return ()=>{};
        const state={pending:false};this.views.set(view,state);this.schedule(view,state);
        return ()=>{if(this.views.get(view)===state)this.views.delete(view);};
    }
    private schedule(view:EditorView,state:{pending:boolean}):void {
        if(state.pending)return;state.pending=true;
        queueMicrotask(()=>{
            state.pending=false;
            if(this.disposed||this.views.get(view)!==state)return;
            const body=view.dom?.ownerDocument.body || activeDocument.body;
            view.dispatch({effects:[editorThemeRefreshEffect.of(++this.revision),editorThemeConfigEffect.of({
                query:readCssVar('--vlook-query',body),headerTemplate:readCssVar('--vlook-header-autonum',body),
            })]});
        });
    }
    refresh():void {this.views.forEach((state,view)=>this.schedule(view,state));}
    dispose():void {this.disposed=true;this.views.clear();}
    extension() {
        const attach=(view:EditorView)=>this.attach(view),refresh=()=>this.refresh();
        return [editorThemeRevision,editorThemeConfigField,ViewPlugin.fromClass(class {
            private detach:()=>void;
            private doc:Document;
            constructor(private view:EditorView){this.doc=view.dom.ownerDocument;this.detach=attach(view);}
            update(){if(this.doc!==this.view.dom.ownerDocument){this.doc=this.view.dom.ownerDocument;refresh();}}
            destroy(){this.detach();}
        })];
    }
}
