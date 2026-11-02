// 对照原版 Typora 导出（docs/*.html）与 Obsidian 导出的 #write DOM，按章节比较结构特征。
// 用法：node scripts/compare-typora-export.mjs <原版.html> <Obsidian导出.html> [--json out.json]
// 只比较运行时执行前的静态结构；不同不一定是缺陷，需结合原版语法逐项判断。
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const [refPath, ourPath] = process.argv.slice(2);
const jsonAt = process.argv.indexOf('--json');
if (!refPath || !ourPath) { console.error('用法：compare-typora-export.mjs <原版.html> <Obsidian导出.html>'); process.exit(2); }

const FEATURES = {
    mark: 'mark', strong: 'strong', em: 'em', del: 'del', u: 'u', code: ':not(pre)>code', kbd: 'kbd', sup: 'sup', sub: 'sub',
    link: 'a[href]:not(.md-toc-inner)', img: 'img', table: 'table', 'table-row': 'tbody>tr', 'thead-row': 'thead>tr',
    blockquote: 'blockquote', ul: 'ul', ol: 'ol', li: 'li', task: 'input[type=checkbox]', fence: 'pre.md-fences',
    diagram: '.md-diagram-panel,pre[lang=mermaid]', math: '.md-math-block,mjx-container,math', audio: 'audio', video: 'video', iframe: 'iframe',
    hr: 'hr', footnote: 'sup.md-footnote,.md-footnote', alert: '.md-alert',
};

function sections(file) {
    const doc = new JSDOM(fs.readFileSync(file, 'utf8')).window.document;
    const write = doc.querySelector('#write');
    if (!write) throw new Error(`${file} 中没有 #write`);
    write.querySelectorAll('.md-toc, script, style').forEach(n => n.remove());
    const out = new Map(); let key = '(开头)', buf = [];
    const flush = () => {
        const box = doc.createElement('div'); buf.forEach(n => box.append(n.cloneNode(true)));
        const counts = {};
        for (const [name, sel] of Object.entries(FEATURES)) { const n = box.querySelectorAll(sel).length; if (n) counts[name] = n; }
        const imgParams = [...box.querySelectorAll('img')].map(i => (i.getAttribute('src') || '').split('#').slice(1).join('#')).filter(Boolean);
        if (imgParams.length) counts['img#params'] = imgParams.length;
        const prev = out.get(key);
        out.set(key, prev ? merge(prev, counts) : counts);
    };
    for (const node of [...write.children]) {
        if (/^H[1-4]$/.test(node.tagName)) { flush(); key = node.textContent.replace(/\s+/g, ' ').trim(); buf = []; continue; }
        buf.push(node);
    }
    flush();
    return out;
}
const merge = (a, b) => { const r = { ...a }; for (const [k, v] of Object.entries(b)) r[k] = (r[k] || 0) + v; return r; };

const ref = sections(refPath), ours = sections(ourPath);
const rows = [];
for (const [title, a] of ref) {
    const b = ours.get(title);
    if (!b) { rows.push({ title, status: 'missing-section' }); continue; }
    const diff = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[k] || 0) !== (b[k] || 0)) diff[k] = [a[k] || 0, b[k] || 0];
    rows.push({ title, status: Object.keys(diff).length ? 'diff' : 'same', diff });
}
for (const title of ours.keys()) if (!ref.has(title)) rows.push({ title, status: 'extra-section' });

const tally = rows.reduce((t, r) => (t[r.status] = (t[r.status] || 0) + 1, t), {});
console.log(JSON.stringify(tally));
for (const r of rows) if (r.status !== 'same') console.log(`${r.status}\t${r.title}\t${r.diff ? Object.entries(r.diff).map(([k, [x, y]]) => `${k}:${x}->${y}`).join(' ') : ''}`);
if (jsonAt > 0) fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify(rows, null, 2));
