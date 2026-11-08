import { setIcon } from 'obsidian';
import { Dropdown } from '../core/dropdown';
import { viewMenuItem, viewMenuSection } from './view-menu';
import { isVideoEmbed } from '../core/video-embed';
import { pauseContainedMedia } from '../core/media-handoff';
import { moveContent } from '../core/content-move';
import { ContentZoom } from '../core/content-zoom';
import { bindContentShortcuts } from '../core/content-shortcuts';
import { sourceContentItems } from "../core/content-index";
import type { RenderCtx } from "../core/context";
import { openSourceContentViewer } from "./source-content-viewer";
export function contentKind(target: HTMLElement): string {
    if(target.matches('.mermaid,.md-diagram')||target.querySelector('.mermaid,.md-diagram'))return '插图';
    if (target.matches('table') || target.querySelector('table')) return '表格';
    if (target.matches('pre') || target.querySelector('pre')) return '代码';
    if (target.matches('.math-block') || target.querySelector('.math-block,mjx-container[display]')) return '公式';
    if (target.matches('audio,video,iframe') || target.querySelector('audio,video,iframe')) return '多媒体';
    return '插图';
}

const ICONS:Record<string,string>={'上一项':'chevron-left','下一项':'chevron-right','回到文档位置':'locate-fixed','关闭':'x','原始大小':'scan'};
/** 使用原内容节点，保留表格分组、音视频和复制等事件。 */
export function openContentViewer(target: HTMLElement, pictureInPicture = false): HTMLDialogElement {
    const existing = target.closest<HTMLDialogElement>('.vlook-content-viewer');
    if (existing) { existing.focus(); return existing; }
    const doc = target.ownerDocument;
    const scope = target.closest('.markdown-preview-view,.markdown-source-view') || target.parentElement!;
    const peers = Array.from(scope.querySelectorAll<HTMLElement>('[data-vlook-viewer]'));
    if (!peers.includes(target)) peers.push(target);
    const dialog = doc.createElement('dialog');
    dialog.className = `vlook-content-viewer ${pictureInPicture ? 'vlook-content-pip' : 'vlook-content-full'}`;
    dialog.setAttribute('aria-label', pictureInPicture ? 'VLOOK 画中画' : 'VLOOK 全屏内容');
    const hold = (item:HTMLElement) => {
        const node = doc.createElement('div'); node.className = 'vlook-content-placeholder';
        node.textContent = '内容正在浮动窗口中显示';
        node.style.setProperty('min-height', `${Math.min(item.getBoundingClientRect().height, 300)}px`);
        item.before(node); return node;
    };
    let placeholder = hold(target);
    const restoreItem = () => {
        if (placeholder.isConnected && placeholder.parentElement) {moveContent(placeholder.parentElement,target,placeholder);placeholder.remove();}
        else {pauseContainedMedia(target);target.remove();}
    };
    const controls = doc.createElement('div');
    controls.className = 'vlook-content-controls';
    const body = doc.createElement('div');
    body.className = 'markdown-rendered vlook-content-body';
    const zoom=pictureInPicture?null:new ContentZoom(body);
    const previousFocus = doc.activeElement as HTMLElement | null;
    const button = (label:string, action:()=>void) => {
        const b=doc.createElement('button');b.type='button';b.className='clickable-icon vlook-content-action';b.setAttribute('aria-label',label);setIcon(b,ICONS[label]??'circle');b.addEventListener('click',action);controls.append(b);return b;
    };
    let observer: MutationObserver | undefined;
    let restored = false;
    const restore = () => {
        if (restored) return;
        restored = true;
        zoom?.dispose();
        observer?.disconnect();
        restoreItem(); // 原文档卸载时不把旧节点放回新文档。
        dialog.remove();
        doc.defaultView?.removeEventListener('beforeprint', restore);
        if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
    };
    if (!pictureInPicture) {
        const category = new Dropdown(doc, '内容分类');
        category.setOptions(['全部', ...new Set(peers.map(contentKind))].map(kind => ({ value: kind, label: kind })), contentKind(target));
        const index = new Dropdown(doc, '内容索引', 'vlook-dropdown-wide');
        let filtered:HTMLElement[] = [];
        const show = (item:HTMLElement) => {
            if (item === target || !item.isConnected) return;
            zoom?.reset();restoreItem(); target = item; placeholder = hold(target); moveContent(body,target);zoom?.refresh();
            body.scrollTop = 0; body.scrollLeft = 0;
        };
        const previous = button('上一项', () => {
            const at = filtered.indexOf(target); if (at > 0) {show(filtered[at - 1]); update();}
        });
        const next = button('下一项', () => {
            const at = filtered.indexOf(target); if (at + 1 < filtered.length) {show(filtered[at + 1]); update();}
        });
        const update = () => {
            filtered = peers.filter(item => item.isConnected && (category.value === '全部' || contentKind(item) === category.value));
            index.setOptions(filtered.map((item, i) => {
                const caption = item.querySelector('figcaption')?.textContent?.trim();
                const image = item.matches('img') ? item : item.querySelector('img');
                const title = caption || image?.getAttribute('alt') || `${contentKind(item)} ${i + 1}`;
                return { value: String(i), label: `${i + 1} / ${filtered.length} · ${title}` };
            }), String(filtered.indexOf(target)));
            const at = filtered.indexOf(target); previous.disabled = at <= 0; next.disabled = at < 0 || at >= filtered.length - 1;
        };
        category.onChange(() => {
            const first = peers.find(item => item.isConnected && (category.value === '全部' || contentKind(item) === category.value));
            if (first) show(first); update();
        });
        index.onChange(value => {const item = filtered[Number(value)]; if (item) show(item); update();});
        controls.append(category.el, index.el); update();
        bindContentShortcuts(dialog,previous,next);
    }
    button('回到文档位置', () => {
        restore(); target.scrollIntoView?.({block:'center'});
    });
    if (pictureInPicture) {
        body.classList.add('is-scaled');
        button('原始大小', () => { body.classList.toggle('is-scaled'); });
    }
    button('关闭', () => dialog.close());
    dialog.addEventListener('close', restore, {once:true});
    doc.defaultView?.addEventListener('beforeprint', restore, {once:true});
    dialog.append(controls, body);
    doc.body.append(dialog);
    moveContent(body,target);zoom?.refresh();
    if (pictureInPicture) {
        dialog.show();
        dialog.tabIndex = -1;
        dialog.focus();
        dialog.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialog.close(); }
        });
        controls.classList.add('is-draggable');
        controls.addEventListener('pointerdown', event => {
            if ((event.target as Element).closest('button') || event.button !== 0) return;
            const rect = dialog.getBoundingClientRect();
            const x = event.clientX, y = event.clientY;
            controls.setPointerCapture(event.pointerId);
            const move = (move:PointerEvent) => {
                dialog.style.setProperty('left', `${Math.max(0, Math.min(doc.documentElement.clientWidth - 80, rect.left + move.clientX - x))}px`);
                dialog.style.setProperty('top', `${Math.max(0, Math.min(doc.documentElement.clientHeight - 40, rect.top + move.clientY - y))}px`);
                dialog.classList.add('vlook-dialog-moved');
            };
            const end = () => { controls.removeEventListener('pointermove', move); controls.removeEventListener('pointerup', end); controls.removeEventListener('pointercancel', end); };
            controls.addEventListener('pointermove', move);
            controls.addEventListener('pointerup', end);
            controls.addEventListener('pointercancel', end);
        });
    } else {dialog.showModal();zoom?.refresh();}
    // 文档被关闭或编辑器重建后及时销毁浮窗，避免保留卸载内容。
    observer = new doc.defaultView!.MutationObserver(() => {
        if (!placeholder.isConnected || !dialog.isConnected) { observer?.disconnect(); restore(); }
    });
    observer.observe(doc.body, {subtree:true, childList:true});
    dialog.addEventListener('close', () => observer?.disconnect(), {once:true});
    return dialog;
}

export function processContentViewers(root: HTMLElement, ctx?: RenderCtx): void {
    const selector = '.v-cap-cntr,pre,table,.mermaid,.math-block,img,audio,video,iframe';
    root.querySelectorAll<HTMLElement>(selector).forEach(target => {
        if (target.matches('audio[id^="vk-id-mini-audio"]') || target.tagName === 'IFRAME' && !isVideoEmbed(target.getAttribute('src') || '')) return;
        if (target.dataset.vlookViewer || target.closest('.vlook-content-viewer')) return;
        // 行内图标（#icon）是文字的一部分，原版不为其提供内容助手。
        if (target.tagName === 'IMG' && /#(?:[^#]*#)*icon(?:#|$)/.test(target.getAttribute('src') || '')) return;
        // 题注容器统一打开；不重复给其内表格、图片或语法装饰图标加按钮。
        if (target.parentElement?.closest(selector) || target.closest('.vlook-code-tools,.vlook-view-menu')) return;
        target.dataset.vlookViewer = '1';
        const tools = viewMenuSection(target, 'vlook-content-tools', '显示方式', 1);
        for (const [label, pip, icon] of [['全屏显示', false, 'maximize'], ['画中画', true, 'picture-in-picture-2']] as const)
            viewMenuItem(tools, label, icon, () => { if (!pip && ctx?.app && ctx.index && sourceContentItems(ctx.index).length) openSourceContentViewer(target, ctx); else openContentViewer(target, pip); });
    });
}
