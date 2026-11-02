// 生成 GitHub 发布页要上传的文件：main.js、manifest.json、styles.css，
// 以及 themes/ 下除内置默认主题外的每套主题（theme-<id>.css）和一份主题清单 themes.json。
// 可下载的主题完全由 themes/ 目录里的文件决定：新增主题只需放入文件、重新运行本脚本并上传，无需更新插件。
// 用法：npm run build && npm run release:assets，然后上传 dist/release/ 下全部文件，发布页标签须与 manifest.json 的 version 一致
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "dist/plugin");
const out = path.join(root, "dist/release");
const embedded = new Set(["common", "blue"]);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(path.join(plugin, file), path.join(out, file));
const index = [];
for (const file of fs.readdirSync(path.join(plugin, "themes")).filter(f => f.endsWith(".css")).sort()) {
    const id = file.replace(/\.css$/, "").toLowerCase();
    if (embedded.has(id)) continue;
    const text = fs.readFileSync(path.join(plugin, "themes", file), "utf8");
    const header = text.match(/^\/\*@vlook-theme (\{.*?\})\*\//);
    if (!header && !/\/\*@vlook-part \w+\*\//.test(text)) { console.warn(`跳过 ${file}：不是 VLOOK 主题`); continue; }
    const meta = header ? JSON.parse(header[1]) : {};
    const asset = `theme-${id}.css`;
    fs.copyFileSync(path.join(plugin, "themes", file), path.join(out, asset));
    index.push({ id, name: meta.name || id, color: meta.color || "", ...(meta.colors ? { colors: meta.colors } : {}), file: asset });
}
fs.writeFileSync(path.join(out, "themes.json"), JSON.stringify(index, null, 2));
const version = JSON.parse(fs.readFileSync(path.join(plugin, "manifest.json"), "utf8")).version;
console.log(`✓ ${version}：${4 + index.length} 个发布文件 → dist/release/（${index.length} 套可下载主题）`);
