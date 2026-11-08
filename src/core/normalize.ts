import {isLiteralContent as shouldSkip} from './literal-dom';
import { newEl, newFragment } from './dom';
// 把 Obsidian 渲染出的 DOM 规整成 VLOOK 语法依赖的结构。
// Typora 支持 ~下标~、^上标^，Obsidian 不支持（会原样显示为文本），
// 而 VLOOK 的色号 _~Rd~_、页签组 _^tab^_、注音 _^zhù^_ 都依赖它们。

const SUB_RE = /(^|[^~\\])~([^\s~](?:[^~]*[^\s~])?)~(?!~)/g;
const SUP_RE = /(^|[^\\^[])\^([^\s^\]](?:[^^]*[^\s^])?)\^/g;

/** 将文本节点中的 ~x~ / ^x^ 转换为 <sub> / <sup> */
function convertTextNode(node: Text, generic: boolean): void {
    const doc = node.ownerDocument;
    const text = node.data;
    if (!text.includes("~") && !text.includes("^"))
        return;
    const parent = node.parentElement;
    if (!parent)
        return;
    // An auto-linked URL is an address, not authored superscript/subscript text.
    const link=parent.closest('a[href]');
    if(link&&link.textContent===link.getAttribute('href'))return;
    // 非通用模式下，只处理「整个 em 的内容就是 ~x~ / ^x^」的情况（VLOOK 语法所需的最小集合）
    if (!generic) {
        if (parent.tagName !== "EM" || parent.childNodes.length !== 1)
            return;
        const m = text.trim().match(/^([~^])([^~^]+)\1$/);
        if (!m)
            return;
        const tag = m[1] === "~" ? "sub" : "sup";
        const el = newEl(doc, tag);
        el.textContent = m[2];
        parent.replaceChildren(el);
        return;
    }
    const parts: (string | HTMLElement)[] = [];
    let changed = false;
    // 先下标后上标，两次扫描
    const pushMatches = (input: string, re: RegExp, tag: string): (string | HTMLElement)[] => {
        const out: (string | HTMLElement)[] = [];
        let last = 0;
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(input))) {
            const start = m.index + m[1].length;
            out.push(input.slice(last, start));
            const el = newEl(doc, tag);
            el.textContent = m[2];
            out.push(el);
            last = m.index + m[0].length;
            changed = true;
        }
        out.push(input.slice(last));
        return out;
    };
    for (const piece of pushMatches(text, SUB_RE, "sub")) {
        if (typeof piece === "string")
            parts.push(...pushMatches(piece, SUP_RE, "sup"));
        else
            parts.push(piece);
    }
    if (!changed)
        return;
    const frag = newFragment(doc);
    for (const p of parts)
        frag.append(typeof p === "string" ? doc.createTextNode(p) : p);
    node.replaceWith(frag);
}

/**
 * 刮刮卡 *提示**隐藏*** 在 Obsidian 中的解析结果与 Typora 不同，统一为 Typora 的 em > strong：
 * - `*提示<strong>隐藏*</strong>` → `<em>提示<strong>隐藏</strong></em>`
 * - `<strong><em>x</em></strong>`（***x***）→ `<em><strong>x</strong></em>`
 */
function normalizeEmphasis(root: HTMLElement): void {
    const doc = root.ownerDocument;
    root.querySelectorAll("strong").forEach(strong => {
        if(shouldSkip(strong))return;
        const last = strong.lastChild;
        const prev = strong.previousSibling;
        if (strong.parentElement?.tagName === "EM" || last?.nodeType !== Node.TEXT_NODE || prev?.nodeType !== Node.TEXT_NODE) return;
        const tail = last as Text, head = prev as Text;
        if (!/[^*\\]\*$/.test(tail.data)) return;
        const star = head.data.lastIndexOf("*");
        if (star < 0 || head.data[star - 1] === "\\" || /\s/.test(head.data[star + 1] ?? " ")) return;
        tail.data = tail.data.slice(0, -1);
        const em = newEl(doc, "em");
        em.append(head.data.slice(star + 1));
        head.data = head.data.slice(0, star);
        strong.replaceWith(em);
        em.append(strong);
    });
    root.querySelectorAll("strong > em:only-child").forEach(em => {
        if(shouldSkip(em))return;
        const strong = em.parentElement!;
        if ((strong.textContent || "") !== (em.textContent || "")) return;
        const inner = newEl(doc, "strong");
        inner.append(...Array.from(em.childNodes));
        em.append(inner);
        strong.replaceWith(em);
    });
}

/**
 * Obsidian 在部分组合（如 ==![](a.svg?x#icon2x)<br>文字==）中会把图片与 <br> 原样输出为文本，
 * 这里还原为图片占位（交给图片处理解析路径）与换行
 */
export function normalizeLiteralInline(root: HTMLElement): void {
    const doc = root.ownerDocument;
    const RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)|<br\s*\/?>/gi;
    root.normalize(); // Obsidian 可能把同一段文字拆成多个相邻文本节点
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n as Text;
        if ((t.data.includes("![") || /<br/i.test(t.data)) && !shouldSkip(t)) nodes.push(t);
    }
    for (const t of nodes) {
        const frag = newFragment(doc);
        let last = 0;
        for (const m of t.data.matchAll(RE)) {
            frag.append(t.data.slice(last, m.index));
            if (m[0].startsWith("!")) {
                const span = newEl(doc, "span");
                span.className = "internal-embed";
                span.setAttribute("src", m[2]);
                span.dataset.vlookLiteral = "1";
                if (m[1]) span.setAttribute("alt", m[1]);
                frag.append(span);
            } else frag.append(newEl(doc, "br"));
            last = m.index + m[0].length;
        }
        if (last === 0) continue;
        frag.append(t.data.slice(last));
        t.replaceWith(frag);
    }
}

export function normalizeSubSup(root: HTMLElement, generic: boolean): void {
    const doc = root.ownerDocument;
    normalizeEmphasis(root);
    normalizeLiteralInline(root);
    // 某些 Markdown 引擎把 ~x~ 解析为删除线：仅在内容为色号时还原为下标
    root.querySelectorAll("em > del:only-child, em > s:only-child").forEach(del => {
        if(shouldSkip(del))return;
        const em = del.parentElement!;
        if ((em.textContent || "").trim() !== (del.textContent || "").trim()) return;
        if (!/^(?:(?:rd|ro|og|ye|la|lm|g[nyd]|aq|au|cf|cy|wt|b[unk]|se|sk|vn|p[luk]|mn|wn|ol|t[12u])+!?)$/i.test((del.textContent || "").trim())) return;
        const sub = newEl(doc, "sub");
        sub.textContent = del.textContent;
        del.replaceWith(sub);
    });
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode())
        nodes.push(n as Text);
    for (const n of nodes) {
        if (!shouldSkip(n))
            convertTextNode(n, generic);
    }
}
