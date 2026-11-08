import { newEl } from './dom';
/** 触屏设备没有 Esc：用一枚悬浮的“退出”按钮代替键盘提示。 */
export function exitChip(parent: HTMLElement, label: string, onExit: () => void): HTMLElement {
    const chip = newEl(parent.ownerDocument, "button");
    chip.type = "button";
    chip.className = "vlook-exit-chip";
    chip.textContent = label;
    chip.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); onExit(); });
    parent.append(chip);
    return chip;
}
