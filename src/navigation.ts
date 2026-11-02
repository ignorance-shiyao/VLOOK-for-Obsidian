import { FuzzySuggestModal, MarkdownView } from "obsidian";
import type VlookPlugin from "./main";
import { getSourceIndex } from "./core/source-index";
import type { SourceIndex } from "./core/source-index";
import { Query, readCssVar, type VlookSettings } from "./core/context";
import { documentLibraryItems, type DocumentLibraryItem } from "./core/doc-library";
import { resolveVaultLink } from "./preview/links";
import { headingPlain } from "./features/toc";
import { navigateViewLine } from "./navigation-history";
import { sourceImages } from './core/image-source';
import { parser } from '@lezer/markdown';
import { notify } from "./notify";

export interface NavigationItem { kind: string; title: string; line: number; key?:string; occurrence?:number; matches?:number }
const names: Record<string, string> = {table:"表格", figure:"插图", codeblock:"代码", formula:"公式", media:"多媒体"};

export function navigationItems(index: SourceIndex): NavigationItem[] {
    const items: NavigationItem[] = [];
    const add=(item:NavigationItem,identity:string)=>items.push({...item,key:JSON.stringify([item.kind,identity])});
    for (const block of index.blocks) {
        if (block.type === "heading" && !block.cover) add({ kind:"章节", title:`${block.headerNum || ""} ${headingPlain(block.text)}`.trim(), line:block.start },headingPlain(block.text));
        const cap = block.caption;
        if (cap) {
            const imageAlt = sourceImages(block.text,index.text)[0]?.alt;
            const title = cap.cap1 || cap.cap2 || imageAlt || names[cap.kind];
            add({kind:names[cap.kind], title:`${cap.num} ${title}`, line:block.start},title);
        }
        if (block.type !== "code" && block.type !== "mermaid" && block.type !== "frontmatter") {
            const excluded:{from:number;to:number}[]=[];
            parser.parse(block.text).iterate({enter(node){
                if(['FencedCode','CodeBlock','InlineCode','HTMLBlock','CommentBlock'].includes(node.name)){
                    excluded.push({from:node.from,to:node.to});return false;
                }
            }});
            let position=0;
            block.text.split("\n").forEach((line, offset) => {
                const footnote = line.match(/^ {0,3}\[\^([^\]]+)\]:\s*(.*)/);
                if (footnote&&!excluded.some(range=>position>=range.from&&position<range.to)) add({kind:"脚注", title:`${footnote[1]} ${footnote[2]}`, line:block.start + offset},footnote[1]);
                position+=line.length+1;
            });
        }
    }
    items.sort((a,b) => a.line - b.line);
    const totals=new Map<string,number>(),seen=new Map<string,number>();
    for(const item of items)totals.set(item.key!,1+(totals.get(item.key!)||0));
    for(const item of items){item.occurrence=seen.get(item.key!)||0;seen.set(item.key!,item.occurrence+1);item.matches=totals.get(item.key!);}
    return items;
}

export function resolveNavigationItem(item:NavigationItem,current:NavigationItem[]):NavigationItem|undefined {
    if(!item.key)return undefined;
    const matches=current.filter(candidate=>candidate.key===item.key);
    if(matches.length!==item.matches)return undefined;
    return matches[item.occurrence??0];
}

export class NavigationModal extends FuzzySuggestModal<NavigationItem> {
    private sourcePath:string|undefined;
    constructor(private view: MarkdownView, private items: NavigationItem[],private currentItems:()=>NavigationItem[]) {
        super(view.app);
        this.sourcePath=view.file?.path;
        this.setPlaceholder("搜索章节、插图、表格、代码、公式或脚注");
    }
    getItems() { return this.items; }
    getItemText(item: NavigationItem) { return `${item.kind} · ${item.title}`; }
    onChooseItem(item: NavigationItem) {
        if(!this.sourcePath||this.view.file?.path!==this.sourcePath){notify('文档已切换，请重新打开导航');return;}
        const target=resolveNavigationItem(item,this.currentItems());
        if(!target){notify('导航目标已变更，请重新打开导航');return;}
        navigateViewLine(this.view,target.line);
        if (this.view.getMode() === "source") {
            this.view.editor.focus();
        }
    }
}

export class DocumentLibraryModal extends FuzzySuggestModal<DocumentLibraryItem> {
    constructor(plugin: VlookPlugin, private sourcePath: string, private items: DocumentLibraryItem[], private currentItems: () => DocumentLibraryItem[], private ownerDocument: Document) {
        super(plugin.app);
        this.setPlaceholder("搜索文库文档或说明");
    }
    getItems() { return this.items; }
    getItemText(item: DocumentLibraryItem) { return `${item.title} ${item.description}`.trim(); }
    onChooseItem(item: DocumentLibraryItem) {
        if (!this.currentItems().some(current => current.href === item.href && current.title === item.title && current.description === item.description)) {
            notify("文库配置已变更，请重新打开文库导航"); return;
        }
        const resolved = resolveVaultLink(this.app, item.href, this.sourcePath);
        if (resolved) {
            void this.app.workspace.openLinkText(resolved.file.path + resolved.hash, "", false);
        } else if (/^https?:\/\//i.test(item.href)) {
            this.ownerDocument.defaultView?.open(item.href, "_blank", "noopener,noreferrer");
        } else {
            notify(`文库文档未找到：${item.href}`);
        }
    }
}

export function navigationForView(view:MarkdownView,settings:VlookSettings):NavigationItem[] {
    const scope=view.contentEl?.ownerDocument.body || activeDocument.body;
    const query=new Query(readCssVar("--vlook-query",scope));
    const index=getSourceIndex(view.editor.getValue(),{headerEnabled:settings.headerAutoNum,
        headerTemplate:readCssVar("--vlook-header-autonum",scope)||undefined,
        captionGroup:query.get("capgroup")!=="off",captionNumber:query.get("capnum")!=="off"});
    return navigationItems(index);
}

export function registerNavigation(plugin: VlookPlugin) {
    plugin.addCommand({id:"document-library", name:"文库导航", callback:() => {
        const file = plugin.app.workspace.getActiveFile();
        if (!file) { notify("请先打开 Markdown 文档"); return; }
        const value = plugin.app.metadataCache.getFileCache(file)?.frontmatter?.["vlook-doc-lib"];
        const items = documentLibraryItems(value);
        if (!items.length) { notify("当前文档未配置 vlook-doc-lib"); return; }
        const sourcePath = file.path;
        const currentItems = () => file.path === sourcePath && plugin.app.vault.getAbstractFileByPath(sourcePath) === file
            ? documentLibraryItems(plugin.app.metadataCache.getFileCache(file)?.frontmatter?.["vlook-doc-lib"]) : [];
        const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        new DocumentLibraryModal(plugin, sourcePath, items, currentItems, view?.contentEl.ownerDocument ?? document).open();
    }});
    const open = (kind?: string) => {
        const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) { notify("请先打开 Markdown 文档"); return; }
        const currentItems=()=>navigationForView(view,plugin.settings).filter(item=>!kind||item.kind===kind);
        new NavigationModal(view, currentItems(),currentItems).open();
    };
    plugin.addRibbonIcon("list-tree", "VLOOK 导航中心", () => open());
    plugin.addCommand({id:"navigation", name:"导航中心（章节与题注）", callback:() => open()});
    for (const kind of ["章节", "插图", "表格", "代码", "公式", "多媒体", "脚注"])
        plugin.addCommand({id:`navigate-${Object.keys(names).find(k => names[k] === kind) || (kind === "章节" ? "heading" : "footnote")}`, name:`${kind}导航`, callback:() => open(kind)});
}
