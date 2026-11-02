// 导出 VLOOK HTML：与 Typora + VLOOK 导出结果结构一致，文件保存在文档同目录

import { TFile, TFolder, MarkdownView, normalizePath, Modal, Setting, FuzzySuggestModal } from "obsidian";
import type { Notice } from "obsidian";
import type VlookPlugin from "../main";
import { buildVlookHtml } from "./document";
import { notify, renotify } from "../notify";
import { THEMES, resolveThemeName, themeColor, themeLabel } from "../core/themes";

/** 导出 HTML：默认只含当前主题，可在导出对话框中多选；allThemes 时预先选中全部主题。 */
export async function exportHtml(plugin: VlookPlugin, file: TFile, allThemes = false): Promise<string> {
    const dir = file.parent && file.parent.path !== "/" ? `${file.parent.path}/` : "";
    const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const current = resolveThemeName(fm["vlook-theme"], resolveThemeName(plugin.resolvePreviewTheme()));
    const themes = new Set(allThemes ? THEMES : [current]);
    const out = await confirmExportPath(plugin, normalizePath(`${dir}${file.basename}.html`), "HTML", { current, selected: themes });
    if(!out)return '';
    const picked = [...themes].filter(name => THEMES.includes(name));
    const notice = notify("VLOOK：正在导出…", 0, "info");
    const stage = (text: string) => { renotify(notice, `VLOOK：正在导出 · ${text}…`, "info"); };
    try {
        await new Promise(resolve => window.requestAnimationFrame(() => window.setTimeout(resolve, 30)));
        const { html, mathErrors } = await buildVlookHtml(plugin, file, { mode: "export", theme: current, themes: picked, onProgress: stage, outDir: out.includes("/") ? out.slice(0, out.lastIndexOf("/")) : "", document:plugin.app.workspace.getActiveViewOfType(MarkdownView)?.contentEl.ownerDocument });
        stage("写入文件");
        await plugin.app.vault.adapter.write(out, html);
        notice.hide();
        doneNotice(plugin, out, mathErrors);
        return out;
    } catch (e) {
        notice.hide();
        throw e;
    }
}

/** 完成提示：带“打开”（系统默认应用）与“显示位置”按钮。 */
function doneNotice(plugin: VlookPlugin, out: string, mathErrors: number): void {
    const fragment = document.createDocumentFragment();
    fragment.createDiv({ text: mathErrors ? `已导出到 ${out}，${mathErrors} 个公式渲染出错，已按原样保留` : `已导出到 ${out}` });
    const app = plugin.app as unknown as { openWithDefaultApp?: (path: string) => Promise<void>; showInFolder?: (path: string) => Promise<void> };
    let notice: Notice | undefined;
    if (app.openWithDefaultApp) {
        const row = fragment.createDiv({ cls: "vlook-notice-actions" });
        const add = (label: string, run?: (path: string) => Promise<void>) => {
            if (!run) return;
            row.createEl("button", { text: label }).addEventListener("click", () => { void run.call(app, out); notice?.hide(); });
        };
        add("打开", app.openWithDefaultApp);
        add("显示位置", app.showInFolder);
    }
    notice = notify(fragment, mathErrors ? 0 : 10000, mathErrors ? "warning" : "success");
}

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
    constructor(private plugin:VlookPlugin,private pick:(folder:TFolder)=>void){super(plugin.app);this.setPlaceholder('选择导出文件夹');}
    getItems(){return this.plugin.app.vault.getAllLoadedFiles().filter((file):file is TFolder=>file instanceof TFolder);}
    getItemText(folder:TFolder){return folder.isRoot()?'/':folder.path;}
    onChooseItem(folder:TFolder){this.pick(folder);}
}

/** 导出前展示目标位置，可改选库内文件夹；返回最终路径，取消时为 null。给出 themes 时可多选要内嵌的主题（结果写回 selected）。 */
export function confirmExportPath(plugin:VlookPlugin,out:string,format:"HTML"|"PDF"="HTML",themes?:{current:string;selected:Set<string>}):Promise<string|null>{
    return new Promise(resolve=>{
        const name=out.slice(out.lastIndexOf('/')+1);
        let target=out;
        class ExportPathModal extends Modal {
            private accepted=false;
            onOpen(){
                this.titleEl.textContent=`导出 ${format}`;
                const create=(tag:string,text:string,cls='')=>{const element=this.contentEl.ownerDocument.createElement(tag);element.textContent=text;element.className=cls;this.contentEl.append(element);return element;};
                create('p','文件将保存到以下位置：');
                const adapter=plugin.app.vault.adapter as typeof plugin.app.vault.adapter & {getBasePath?:()=>string};
                const base=adapter.getBasePath?.();
                const path=create('div','','vlook-export-path');
                path.setAttribute('tabindex','0');
                const show=()=>{path.textContent=base?`${base}/${target}`:target;};
                show();
                if(themes&&THEMES.length>1){
                    const row=create('div','','vlook-export-themes');
                    row.setAttribute('role','group');row.setAttribute('aria-label','主题');
                    for(const name of THEMES){
                        const chip=row.ownerDocument.createElement('button');
                        chip.type='button';chip.textContent=themeLabel(name);chip.style.setProperty('--vlook-theme-dot',themeColor(name)||'currentColor');
                        const sync=()=>chip.setAttribute('aria-pressed',String(themes.selected.has(name)));
                        // 当前主题即导出页的默认样式，始终包含
                        if(name===themes.current){chip.disabled=true;themes.selected.add(name);}
                        else chip.addEventListener('click',()=>{if(themes.selected.has(name))themes.selected.delete(name);else themes.selected.add(name);sync();});
                        sync();row.append(chip);
                    }
                }
                create('p',format==='PDF'?'下一步选择 VLOOK 打印选项后写入。已有同名 PDF 将被替换。':'图片将内嵌到文件中。已有同名 HTML 将被替换。');
                new Setting(this.contentEl)
                    .addButton(button=>button.setButtonText('更改位置').onClick(()=>{
                        new FolderSuggestModal(plugin,folder=>{target=normalizePath(folder.isRoot()?name:`${folder.path}/${name}`);show();}).open();
                    }))
                    .addButton(button=>button.setButtonText('取消').onClick(()=>this.close()))
                    .addButton(button=>button.setButtonText('确认导出').setCta().onClick(()=>{this.accepted=true;this.close();}));
            }
            onClose(){this.contentEl.replaceChildren();resolve(this.accepted?target:null);}
        }
        new ExportPathModal(plugin.app).open();
    });
}
