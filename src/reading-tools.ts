import { registerDocumentEvent, registerEachDocument } from "./core/window-events";
// Obsidian 原生文档中的演示辅助，不向编辑器注入原版运行时的全局键盘处理。
import { MarkdownView, Platform } from "obsidian";
import { exitChip } from "./core/exit-chip";
import type VlookPlugin from "./main";
import { notify } from "./notify";

const SPOTLIGHT_RADIUS = 180;

type Effect = "laser" | "spotlight";
export class ReadingTools {
    private effect: Effect | null = null;
    private overlay: HTMLElement | null = null;
    private host: HTMLElement | null = null;
    private chip: HTMLElement | null = null;
    private styled = new Set<HTMLElement>();
    private largeSpotlight=false;
    constructor(private plugin: VlookPlugin) {}

    private active() {
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) notify("请先打开 Markdown 文档");
        const doc=view?.contentEl.ownerDocument;
        return doc?.querySelector<HTMLElement>('dialog.vlook-native-slides[open] .vlook-slide-body') || view?.contentEl;
    }
    clear() {
        this.host?.classList.remove('vlook-laser-cursor');
        this.chip?.remove(); this.chip = null;
        this.overlay?.remove(); this.overlay = null;
        this.host = null; this.effect = null;
        this.largeSpotlight=false;
    }
    private position(ev?: PointerEvent) {
        if (!this.host || !this.overlay) return;
        if(!this.host.isConnected){this.clear();return;}
        const rect = this.host.getBoundingClientRect();
        for (const [k, v] of Object.entries({left:rect.left, top:rect.top, width:rect.width, height:rect.height})) this.overlay.style.setProperty(k, `${v}px`);
        const x = ev ? ev.clientX - rect.left : rect.width / 2;
        const y = ev ? ev.clientY - rect.top : rect.height / 2;
        this.overlay.hidden = x < 0 || x > rect.width || y < 0 || y > rect.height;
        this.overlay.style.setProperty("--vlook-pointer-x", `${x}px`);
        this.overlay.style.setProperty("--vlook-pointer-y", `${y}px`);
    }
    toggle(effect: Effect) {
        const same = this.effect === effect;
        this.clear();
        if (same) return;
        const host = this.active(); if (!host) return;
        this.host = host; this.effect = effect;
        if(effect==='laser')host.classList.add('vlook-laser-cursor');
        this.overlay = host.ownerDocument.createElement("div");
        this.overlay.className = `vlook-reading-effect vlook-effect-${effect}`;
        this.overlay.setAttribute("aria-hidden", "true");
        this.overlay.style.setProperty('--vlook-spotlight-radius',`${SPOTLIGHT_RADIUS}px`);
        (host.closest('dialog')||host.ownerDocument.body).append(this.overlay);
        this.position();
        if (Platform.isMobile) this.chip = exitChip(host.closest('dialog') || host.ownerDocument.body, effect === "laser" ? "关闭激光笔" : "关闭聚光灯", () => this.clear());
        else notify(`${effect === "laser" ? "激光笔" : "聚光灯"}已开启，按 Esc 退出`);
    }
    register() {
        const p = this.plugin;
        p.addCommand({id:"laser-pointer", name:"开启 / 关闭激光笔", callback:() => this.toggle("laser")});
        p.addCommand({id:"spotlight", name:"开启 / 关闭聚光灯", callback:() => this.toggle("spotlight")});
        for (const [id, name] of [["gray", "灰度阅读"], ["wide", "正文宽度适配"]]) {
            p.addCommand({id:`reading-${id}`, name:`开启 / 关闭${name}`, callback:() => {
                const host = this.active(); if (!host) return;
                host.classList.toggle(`vlook-reading-${id}`); this.styled.add(host);
            }});
        }
        registerDocumentEvent(p, "pointermove", ev => { const target = ev.target as Node | null; if (this.host && (target?.ownerDocument ?? target) === this.host.ownerDocument) this.position(ev); });
        const presentationChanged=() => {
            if(!this.overlay||!this.host)return;
            if(!this.host.isConnected){this.clear();return;}
            const host=this.active();if(!host){this.clear();return;}
            this.host.classList.remove('vlook-laser-cursor');
            this.host=host;if(this.effect==='laser')host.classList.add('vlook-laser-cursor');
            (host.closest('dialog')||host.ownerDocument.body).append(this.overlay);
            this.position();
        };
        // 幻灯片可能在独立窗口中开启，事件派发在各自的窗口文档上
        const listen=(doc:Document)=>{
            doc.addEventListener('vlook-presentation-change',presentationChanged);
            doc.addEventListener('vlook-presentation-effect',requested);
            return ()=>{doc.removeEventListener('vlook-presentation-change',presentationChanged);doc.removeEventListener('vlook-presentation-effect',requested);};
        };
        const resizeSpotlight=()=>{
            if(this.effect!=='spotlight'||!this.overlay)return;
            this.largeSpotlight=!this.largeSpotlight;
            this.overlay.style.setProperty('--vlook-spotlight-radius',this.largeSpotlight?'252px':`${SPOTLIGHT_RADIUS}px`);
        };
        const requested=(event:Event)=>{const effect=(event as CustomEvent<string>).detail;if(effect==='laser'||effect==='spotlight')this.toggle(effect);};
        registerEachDocument(p,listen);
        p.addCommand({id:'spotlight-size',name:'切换聚光灯大小',callback:resizeSpotlight});
        registerDocumentEvent(p, "keydown", ev => {
            if (ev.key === "Escape"&&this.effect&&!ev.ctrlKey&&!ev.metaKey&&!ev.altKey&&!ev.shiftKey) {
                ev.preventDefault();ev.stopImmediatePropagation();this.clear();return;
            }
            if(ev.key==='Shift'&&!ev.repeat&&!ev.ctrlKey&&!ev.metaKey&&!ev.altKey)resizeSpotlight();
        },true);
        p.registerEvent(p.app.workspace.on("active-leaf-change", () => this.clear()));
        p.registerEvent(p.app.workspace.on("layout-change", () => this.position()));
        p.register(() => {
            this.clear();
            for (const host of this.styled) host.classList.remove("vlook-reading-gray", "vlook-reading-wide");
            this.styled.clear();
        });
    }
}
