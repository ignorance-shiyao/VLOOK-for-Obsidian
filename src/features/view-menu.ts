import { setIcon } from 'obsidian';

import { newEl } from '../core/dom';
// 内容块的悬浮快速操作：悬停或聚焦内容块时在右上角浮现一排图标按钮，不再需要展开下拉。
const menus = new WeakMap<HTMLElement, HTMLElement>();

/** 题注容器与其内容共用一个工具条。 */
function viewMenuAnchor(target: HTMLElement): HTMLElement {
    return target.closest<HTMLElement>('.v-cap-cntr') ?? target;
}

function menuFor(anchor: HTMLElement): HTMLElement {
    const known = menus.get(anchor);
    if (known?.parentNode && known.nextElementSibling === anchor) return known;
    const doc = anchor.ownerDocument;
    const menu = newEl(doc, 'div');
    menu.className = 'vlook-view-menu';
    const panel = newEl(doc, 'div');
    panel.className = 'vlook-view-panel';
    panel.setAttribute('role', 'toolbar');
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') (doc.activeElement as HTMLElement | null)?.blur(); });
    menu.append(panel);
    anchor.before(menu);
    menus.set(anchor, menu);
    return menu;
}

/** 取得（或建立）菜单中的分组；className 保留各功能原有的容器类名。 */
export function viewMenuSection(target: HTMLElement, className: string, title: string, order: number): HTMLElement {
    const panel = menuFor(viewMenuAnchor(target)).querySelector<HTMLElement>(':scope > .vlook-view-panel')!;
    const existing = panel.querySelector<HTMLElement>(`:scope > .${className}`);
    if (existing) return existing;
    const doc = target.ownerDocument;
    const section = newEl(doc, 'div');
    section.className = `${className} vlook-view-section`;
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', title);
    section.dataset.order = String(order);
    const items = newEl(doc, 'div'); items.className = 'vlook-view-items';
    section.append(items);
    const after = Array.from(panel.children).find(child => Number((child as HTMLElement).dataset.order) > order);
    panel.insertBefore(section, after ?? null);
    return section;
}

export function viewMenuItem(section: HTMLElement, label: string, icon: string, action: (button: HTMLButtonElement) => void, pressed: boolean | null = null): HTMLButtonElement {
    const doc = section.ownerDocument;
    const button = newEl(doc, 'button');
    button.type = 'button';
    button.className = 'vlook-view-item';
    button.setAttribute('aria-label', label);
    button.title = label;
    if (pressed !== null) button.setAttribute('aria-pressed', String(pressed));
    const glyph = newEl(doc, 'span'); glyph.className = 'vlook-view-glyph'; setIcon(glyph, icon);
    const text = newEl(doc, 'span'); text.className = 'vlook-view-label'; text.textContent = label;
    button.append(glyph, text);
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); action(button); });
    section.querySelector(':scope > .vlook-view-items')!.append(button);
    return button;
}
