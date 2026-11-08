import {MarkdownView,Platform,setIcon} from 'obsidian';
import type VlookPlugin from './main';
import {THEMES,themeColor,themeColors,themeLabel} from './core/themes';
import {FONT_OPTIONS,compactPath} from './core/page-appearance';
import {createHeaderToolbar,type HeaderMenu} from './core/header-toolbar';
import {exportHtml} from './preview/export';
import {keepReadingPosition} from './core/reading-position';

import { notify } from "./notify";
/** Obsidian 自带的阅读/编辑切换按钮：图标随当前模式在书本与铅笔之间变化。 */
function findNativeMode(actions:Element|null|undefined):HTMLElement|null{
    return Array.from(actions?.querySelectorAll<HTMLElement>(':scope > .view-action')||[]).find(el=>!!el.querySelector('.lucide-book-open,.lucide-pencil,.lucide-edit-3,.lucide-square-pen,.lucide-edit')||/阅读视图|编辑视图|实时预览|源码模式|reading view|editing view/i.test(el.getAttribute('aria-label')||''))||null;
}
export function registerPageSettings(plugin:VlookPlugin){
    type Entry={header:HTMLElement;parent:HTMLElement|null;path:HTMLButtonElement;tools:ReturnType<typeof createHeaderToolbar>;filePath:string;nativeMode:HTMLElement|null};
    const mounted=new Map<MarkdownView,Entry>();let active=true;
    const remove=(item:Entry)=>{item.tools.dispose();item.path.remove();item.parent?.classList.remove('vlook-path-collapsed');item.nativeMode?.classList.remove('vlook-native-mode-hidden');};
    const refresh=()=>{
        if(!active)return;const live=new Set<MarkdownView>();
        plugin.app.workspace.iterateAllLeaves(leaf=>{
            if(!(leaf.view instanceof MarkdownView))return;const view=leaf.view;live.add(view);
            const header=view.containerEl.querySelector<HTMLElement>('.view-header');if(!header)return;
            let item=mounted.get(view);if(item&&item.header!==header){remove(item);mounted.delete(view);item=undefined;}
            if(!item){
                const parent=header.querySelector<HTMLElement>('.view-header-title-parent');
                const path=header.ownerDocument.createElement('button');path.className='vlook-relative-path';header.querySelector('.view-header-title-container')?.prepend(path);
                const allViews=()=>{const views:MarkdownView[]=[];plugin.app.workspace.iterateAllLeaves(leaf=>{if(leaf.view instanceof MarkdownView)views.push(leaf.view);});return views;};
                const save=async()=>keepReadingPosition(allViews(),()=>plugin.saveSettings());
                const menus:HeaderMenu[]=[
                    {id:'mode',label:'编辑 / 阅读',icon:'book-open',icons:{source:'pencil',preview:'book-open'},selected:()=>view.getMode(),choices:()=>[{label:'编辑',value:'source'},{label:'阅读',value:'preview'}],toggle:true,choose:mode=>keepReadingPosition([view],()=>view.leaf.setViewState({type:'markdown',state:{...view.getState(),mode},active:true}))},
                    {id:'appearance',label:'明暗',icon:'sun-moon',icons:{light:'sun',dark:'moon'},selected:()=>header.ownerDocument.body.classList.contains('theme-dark')?'dark':'light',choices:()=>[{label:'浅色',value:'light'},{label:'深色',value:'dark'}],toggle:true,choose:value=>{const dark=header.ownerDocument.body.classList.contains('theme-dark');if(dark!==(value==='dark'))return plugin.themeSwitcher.toggleDark(header.ownerDocument);}},
                    {id:'theme',label:'主题',icon:'palette',selected:()=>plugin.settings.style,choices:()=>THEMES.map(theme=>({label:themeLabel(theme),value:theme,color:themeColor(theme),color2:themeColors(theme)?.[1],color1:themeColors(theme)?.[0]})),choose:async value=>{plugin.settings.style=value;await save();}},
                    {id:'font',label:'字体',icon:'type',selected:()=>`font:${plugin.settings.textFont||'theme'}`,choices:()=>Object.entries(FONT_OPTIONS).map(([value,label])=>({label,value:`font:${value}`,glyph:{theme:'T',sans:'Aa',serif:'Aa',mono:'<>',system:'A'}[value],glyphFont:{sans:'Arial,"PingFang SC",sans-serif',serif:'Georgia,"Songti SC",serif',mono:'ui-monospace,monospace',system:'system-ui,sans-serif'}[value]})),slider:{title:'字号',min:11,max:32,preview:'字号预览',value:()=>plugin.settings.textSize||0,choose:async size=>{plugin.settings.textSize=size;await save();}},choose:async value=>{plugin.settings.textFont=value.slice(5);await save();}},
                    {id:'width',label:'页宽',icon:'move-horizontal',selected:()=>`w:${plugin.settings.pageWidth||0}`,choices:()=>[{label:'默认',value:'w:0'},{label:'窄 600',value:'w:600'},{label:'宽 900',value:'w:900'},{label:'更宽 1200',value:'w:1200'},{label:'超宽 1600',value:'w:1600'}],slider:{title:'自定义',min:500,max:1800,step:20,unit:'px',kind:'width',preview:'页宽预览',value:()=>plugin.settings.pageWidth||0,choose:async width=>{plugin.settings.pageWidth=width;await save();}},choose:async value=>{plugin.settings.pageWidth=Number(value.slice(2))||0;await save();}},
                    {id:'export',label:'导出',icon:'download',selected:()=>'',choices:()=>[{label:'HTML',value:'html'},...(Platform.isDesktopApp?[{label:'PDF',value:'pdf'}]:[])],choose:async value=>{const file=view.file;if(!file)return;try{if(value==='html')await exportHtml(plugin,file);else await plugin.openPreview(file,{print:true});}catch(error){console.error('[VLOOK export]',error);notify(`VLOOK：导出失败：${(error as Error)?.message||String(error)}`,0);}}},
                ];
                const tools=createHeaderToolbar(header.ownerDocument,menus,setIcon,error=>notify(`VLOOK：${error instanceof Error?error.message:String(error)}`));
                const actions=header.querySelector('.view-actions');actions?.prepend(tools.element);
                const nativeMode=findNativeMode(actions);
                nativeMode?.classList.add('vlook-native-mode-hidden');
                item={header,parent,path,tools,filePath:'',nativeMode};mounted.set(view,item);
                path.addEventListener('click',()=>{const expanded=path.getAttribute('aria-expanded')!=='true';path.setAttribute('aria-expanded',String(expanded));parent?.classList.toggle('vlook-path-collapsed',!expanded);path.textContent=expanded?'收起路径':compactPath(view.file?.path||'');});
            }
            const filePath=view.file?.path||'';
            if(item.filePath!==filePath||!item.path.textContent){item.filePath=filePath;item.tools.close();item.path.textContent=compactPath(filePath);item.path.title=filePath;item.path.setAttribute('aria-label',`展开完整路径：${filePath}`);item.path.setAttribute('aria-expanded','false');item.parent?.classList.add('vlook-path-collapsed');}
            item.path.hidden=!filePath.includes('/');item.tools.update();
            // 原生阅读/编辑按钮会随模式换图标，每次刷新都重新定位并隐藏，避免与顶栏模式按钮重复
            const native=findNativeMode(header.querySelector('.view-actions'));if(native!==item.nativeMode){item.nativeMode?.classList.remove('vlook-native-mode-hidden');item.nativeMode=native;}
            native?.classList.add('vlook-native-mode-hidden');
        });
        for(const [view,item] of mounted)if(!live.has(view)){remove(item);mounted.delete(view);}
    };
    plugin.app.workspace.onLayoutReady(refresh);
    plugin.registerEvent(plugin.app.workspace.on('layout-change',refresh));plugin.registerEvent(plugin.app.workspace.on('file-open',refresh));plugin.registerEvent(plugin.app.workspace.on('css-change',refresh));plugin.registerEvent(plugin.app.workspace.on('active-leaf-change',refresh));
    plugin.register(()=>{active=false;for(const item of mounted.values())remove(item);mounted.clear();});
}
