// 主题拆分：公共样式 common.css + 每套主题一个文件，均为可直接手改的普通 CSS。
//   common.css 与 <id>.css 的结构相同：
//     /*@vlook-theme {"id":"hope","name":"Hope","color":"#709b57","colors":[...]}*/   （仅主题文件）
//     /*@vlook-part obsidian*/ …编辑 / 阅读视图样式…
//     /*@vlook-part export*/   …预览 / 导出 HTML 样式…
//   加载顺序：common 在前，主题在后；@import 自动提到最前。
//   文件头含 "standalone":true 的主题不依赖 common.css，可单独分发（定制主题）。
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";

export const PARTS = ["obsidian", "export"];
/** 两部分共用的大体积声明（内嵌图片）单独成 shared 段，加载时排在各部分最前。 */
const SHARED = "shared";

/** 顶层规则逐条切出。 */
function pieces(text) {
    const nodes = postcss.parse(text).nodes.filter(node => node.type !== "comment");
    const out = [];
    let at = 0;
    for (const node of nodes) {
        const start = node.source.start.offset, end = node.source.end.offset;
        if (text.slice(at, start).replace(/\/\*[\s\S]*?\*\//g, "").trim()) throw Error("主题切分失败：规则之间存在无法归属的内容");
        out.push(text.slice(start, end));
        at = end;
    }
    if (text.slice(at).replace(/\/\*[\s\S]*?\*\//g, "").trim()) throw Error("主题切分失败：末尾存在无法归属的内容");
    return out;
}

/** 最长递增子序列（返回下标），保证公共规则在每套主题里的先后次序一致。 */
function lis(values) {
    const tails = [], tailIdx = [], prev = new Array(values.length).fill(-1);
    for (let i = 0; i < values.length; i++) {
        let lo = 0, hi = tails.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < values[i]) lo = mid + 1; else hi = mid; }
        tails[lo] = values[i]; tailIdx[lo] = i; prev[i] = lo ? tailIdx[lo - 1] : -1;
    }
    const out = [];
    for (let k = tailIdx[tails.length - 1] ?? -1; k >= 0; k = prev[k]) out.push(k);
    return out.reverse();
}

/** 同一「上下文 | 选择器 | 属性」最后写入者胜出：用于核对改变先后次序后层叠结果不变。 */
function winners(list) {
    const map = new Map();
    const visit = (node, ctx) => {
        if (node.type === "rule") {
            for (const decl of node.nodes ?? []) if (decl.type === "decl") {
                const key = `${ctx}|${ROOTISH.test(node.selector) ? ":root" : node.selector}|${decl.prop}`;
                // !important 的声明不会被之后的普通声明覆盖
                if (map.get(key)?.endsWith("!") && !decl.important) continue;
                map.set(key, `${decl.value}${decl.important ? "!" : ""}`);
            }
        } else if (node.type === "atrule" && node.nodes && !/keyframes|font-face/.test(node.name)) {
            for (const child of node.nodes) visit(child, `${ctx}@${node.name} ${node.params}`);
        } else if (node.type === "atrule") {
            map.set(`${ctx}|${node.name} ${node.params}|*`, node.toString());
        }
    };
    for (const piece of list) for (const node of postcss.parse(piece).nodes) visit(node, "");
    return map;
}

const ROOTISH = /^(:root,body|body|:root)$/;
const BIG = 2000;

function differs(a, b) {
    for (const [key, value] of a) if (b.get(key) !== value) return true;
    return false;
}
const changed = (a, b) => differs(a, b) || differs(b, a);

/**
 * 一组主题同一部分的 CSS → 公共规则 + 各主题独有规则。
 * 公共规则前移不得改变任何主题的层叠结果，否则该规则留在各主题内。
 */
function split(texts) {
    const names = Object.keys(texts);
    const list = Object.fromEntries(names.map(n => [n, pieces(texts[n])]));
    const at = names.map(n => {
        const map = new Map(), dup = new Set();
        list[n].forEach((p, i) => { if (map.has(p)) dup.add(p); map.set(p, i); });
        for (const p of dup) map.delete(p);
        return map;
    });
    const isImport = p => /^@(import|charset)/i.test(p);
    let shared = list[names[0]].filter(p => !isImport(p) && at.every(map => map.has(p)));
    for (const map of at.slice(1)) shared = lis(shared.map(p => map.get(p))).map(i => shared[i]);
    for (let round = 0; ; round++) {
        if (round > 8) throw Error("公共规则无法稳定收敛");
        const drop = new Set();
        const set = new Set(shared);
        for (const n of names) {
            const before = winners(list[n]);
            if (!changed(before, winners([...shared, ...list[n].filter(p => !set.has(p))]))) continue;
            // 逐条定位：把每条公共规则单独前移，找出会改变结果的那些
            for (const p of shared)
                if (changed(before, winners([p, ...list[n].filter(q => q !== p)]))) drop.add(p);
            if (!drop.size) throw Error(`主题 ${n} 的公共规则前移后层叠结果改变，且无法定位到单条规则`);
        }
        if (!drop.size) break;
        shared = shared.filter(p => !drop.has(p));
    }
    const set = new Set(shared);
    const themes = Object.fromEntries(names.map(n => [n, list[n].filter(p => !set.has(p)).join("")]));
    return { common: shared.join(""), themes };
}

/** 与加载端一致：@import 提到最前，其余按公共在前、主题在后。 */
export function assemble(common, theme) {
    const imports = [];
    const body = (common + theme).replace(/@import\s+(?:url\(\s*)?(?:"[^"]*"|'[^']*'|[^"';)]+)\s*\)?[^;]*;/g, m => { imports.push(m); return ""; });
    return imports.join("\n") + body;
}

export function themeFile(meta, parts) {
    return `/*@vlook-theme ${JSON.stringify(meta)}*/\n` + [...(parts[SHARED] ? [SHARED] : []), ...PARTS].map(p => `/*@vlook-part ${p}*/\n${parts[p]}\n`).join("");
}

/**
 * 同一主题两部分里完全相同的大体积根变量声明（内嵌图片）提到 shared 段，避免在文件中存两份。
 * 返回 { shared, obsidian, export }；无可共享内容时 shared 为空串。
 */
export function shareParts(parts) {
    const roots = text => {
        const out = new Map();
        postcss.parse(text).each(node => {
            if (node.type !== "rule" || !ROOTISH.test(node.selector)) return;
            node.each(decl => { if (decl.type === "decl" && decl.value.length > BIG) out.set(`${decl.prop}|${decl.value}|${!!decl.important}`, decl); });
        });
        return out;
    };
    const a = roots(parts.obsidian), b = roots(parts.export);
    const common = [...a.keys()].filter(key => b.has(key));
    if (!common.length) return { shared: "", obsidian: parts.obsidian, export: parts.export };
    const take = (text, keys) => {
        const root = postcss.parse(text);
        root.each(node => {
            if (node.type !== "rule" || !ROOTISH.test(node.selector)) return;
            node.each(decl => { if (decl.type === "decl" && keys.has(`${decl.prop}|${decl.value}|${!!decl.important}`)) decl.remove(); });
            if (!node.nodes.length) node.remove();
        });
        return root.toString();
    };
    const keys = new Set(common);
    const decls = common.map(key => `${a.get(key).prop}:${a.get(key).value}${a.get(key).important ? "!important" : ""}`).join(";");
    const out = { shared: `:root,body{${decls}}`, obsidian: take(parts.obsidian, keys), export: take(parts.export, keys) };
    // 前移不得改变层叠结果（选择器 :root / body 视为同一处）
    for (const part of PARTS)
        if (changed(winners([parts[part]]), winners([out.shared, out[part]])))
            return { shared: "", obsidian: parts.obsidian, export: parts.export };
    return out;
}

/**
 * 打包内置主题。sources: { [part]: { [id]: css } }，metas: { [id]: {name,color,colors} }
 * 写入 outDir/common.css 与 outDir/<id>.css，并逐套核对：还原结果的层叠与原文一致。
 */
/** 仓库内的主题不含 http(s) 外链；在线字体的主机名以占位符保存，启用在线字体时才还原（见 resolveRemoteFonts）。 */
const defang = css => css.replaceAll("https://openfonts.pages.dev", "@vlook-fonts").replaceAll("https://fonts.googleapis.com", "@vlook-gfonts");

export function packThemes(sources, metas, outDir) {
    const common = {}, themed = {};
    for (const part of PARTS) {
        const result = split(sources[part]);
        common[part] = result.common;
        for (const [id, text] of Object.entries(result.themes)) (themed[id] ??= {})[part] = text;
    }
    for (const [id, parts] of Object.entries(themed))
        for (const part of PARTS)
            if (changed(winners([sources[part][id]]), winners([assemble(common[part], parts[part])])))
                throw Error(`主题 ${id} 拆分后层叠结果与原文不一致（${part}）`);
    for (const [id, parts] of Object.entries(themed)) themed[id] = { ...parts, ...shareParts(parts) };
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "common.css"), defang(PARTS.map(p => `/*@vlook-part ${p}*/\n${common[p]}\n`).join("")));
    for (const [id, parts] of Object.entries(themed))
        fs.writeFileSync(path.join(outDir, `${id}.css`), defang(themeFile({ ...metas[id] }, parts)));
    return {
        common: PARTS.reduce((a, p) => a + common[p].length, 0),
        themes: Object.fromEntries(Object.entries(themed).map(([id, p]) => [id, PARTS.reduce((a, part) => a + p[part].length, 0) + (p[SHARED]?.length ?? 0)])),
    };
}
