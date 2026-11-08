// 自绘下拉选择器：替代系统 <select>，在 <dialog> 内也能正常展开，样式与动效统一。
import { setIcon } from "obsidian";

import { newEl } from './dom';
export interface DropdownOption { value: string; label: string }

export class Dropdown {
    readonly el: HTMLElement;
    private trigger: HTMLButtonElement;
    private list: HTMLElement;
    private options: DropdownOption[] = [];
    private current = "";
    private active = -1;
    private handler: (value: string) => void = () => {};
    private uid = Math.random().toString(36).slice(2, 7);

    constructor(private doc: Document, label: string, className = "") {
        this.el = newEl(doc, "div");
        this.el.className = `vlook-dropdown ${className}`.trim();
        this.trigger = newEl(doc, "button");
        this.trigger.type = "button";
        this.trigger.className = "vlook-dropdown-trigger";
        this.trigger.setAttribute("aria-haspopup", "listbox");
        this.trigger.setAttribute("aria-expanded", "false");
        this.trigger.setAttribute("aria-label", label);
        this.list = newEl(doc, "div");
        this.list.className = "vlook-dropdown-list";
        this.list.setAttribute("role", "listbox");
        this.list.setAttribute("aria-label", label);
        this.list.tabIndex = -1;
        this.el.append(this.trigger, this.list);
        this.trigger.addEventListener("click", () => this.isOpen() ? this.close() : this.open());
        this.trigger.addEventListener("keydown", ev => this.onTriggerKey(ev));
        this.list.addEventListener("keydown", ev => this.onListKey(ev));
        this.list.addEventListener("pointerdown", ev => ev.preventDefault());
        this.el.addEventListener("focusout", ev => { if (!this.el.contains(ev.relatedTarget as Node | null)) this.close(); });
    }

    get value(): string { return this.current; }
    set value(value: string) { this.select(value, false); }
    onChange(handler: (value: string) => void) { this.handler = handler; }
    set disabled(value: boolean) { this.trigger.disabled = value; }

    setOptions(options: DropdownOption[], value: string) {
        this.options = options;
        this.list.replaceChildren(...options.map((option, i) => {
            const item = newEl(this.doc, "div");
            item.className = "vlook-dropdown-option";
            item.setAttribute("role", "option");
            item.id = `vlook-dd-${this.uid}-${i}`;
            item.textContent = option.label;
            item.dataset.value = option.value;
            item.addEventListener("click", () => { this.select(option.value, true); this.close(); this.trigger.focus({ preventScroll: true }); });
            item.addEventListener("pointermove", () => this.highlight(i, false));
            return item;
        }));
        this.select(options.some(o => o.value === value) ? value : options[0]?.value ?? "", false);
    }

    private isOpen() { return this.el.classList.contains("is-open"); }

    private select(value: string, notify: boolean) {
        const changed = value !== this.current;
        this.current = value;
        const at = this.options.findIndex(o => o.value === value);
        this.trigger.replaceChildren();
        const text = newEl(this.doc, "span");
        text.className = "vlook-dropdown-text";
        text.textContent = this.options[at]?.label ?? "";
        const caret = newEl(this.doc, "span");
        caret.className = "vlook-dropdown-caret";
        setIcon(caret, "chevrons-up-down");
        this.trigger.append(text, caret);
        Array.from(this.list.children).forEach((item, i) => item.setAttribute("aria-selected", String(i === at)));
        if (notify && changed) this.handler(value);
    }

    private highlight(index: number, scroll = true) {
        const items = Array.from(this.list.children) as HTMLElement[];
        this.active = Math.max(0, Math.min(items.length - 1, index));
        items.forEach((item, i) => item.classList.toggle("is-active", i === this.active));
        this.list.setAttribute("aria-activedescendant", items[this.active]?.id ?? "");
        if (scroll) items[this.active]?.scrollIntoView?.({ block: "nearest" });
    }

    open() {
        if (!this.options.length || this.trigger.disabled) return;
        this.el.classList.add("is-open");
        this.trigger.setAttribute("aria-expanded", "true");
        // 空间不足时向上展开
        const rect = this.el.getBoundingClientRect(), view = this.doc.defaultView?.innerHeight ?? 800;
        this.el.classList.toggle("is-up", rect.bottom + 280 > view && rect.top > view - rect.bottom);
        this.highlight(Math.max(0, this.options.findIndex(o => o.value === this.current)));
        this.list.focus({ preventScroll: true });
    }

    close() {
        if (!this.isOpen()) return;
        this.el.classList.remove("is-open");
        this.trigger.setAttribute("aria-expanded", "false");
    }

    private onTriggerKey(ev: KeyboardEvent) {
        if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); ev.stopPropagation(); this.open(); }
    }

    private onListKey(ev: KeyboardEvent) {
        const move = (to: number) => { ev.preventDefault(); ev.stopPropagation(); this.highlight(to); };
        switch (ev.key) {
            case "ArrowDown": return move(this.active + 1);
            case "ArrowUp": return move(this.active - 1);
            case "Home": return move(0);
            case "End": return move(this.options.length - 1);
            case "Enter": case " ": {
                ev.preventDefault(); ev.stopPropagation();
                const option = this.options[this.active];
                if (option) this.select(option.value, true);
                this.close(); this.trigger.focus({ preventScroll: true });
                return;
            }
            case "Escape": case "Tab":
                // Esc 只收起列表，不关闭所在的弹窗
                if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); }
                this.close(); this.trigger.focus({ preventScroll: true });
        }
    }
}
