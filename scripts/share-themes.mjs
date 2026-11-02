// 对 themes/ 下已有主题文件做一次 shared 提取（幂等）：两部分共用的大体积声明只存一份
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PARTS, shareParts, themeFile } from "./pack-themes.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../themes");
let before = 0, after = 0;
for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".css") && f !== "common.css")) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const head = text.match(/^\/\*@vlook-theme (\{.*?\})\*\/\n/);
    const marks = text.split(/\/\*@vlook-part (\w+)\*\/\n/);
    const parts = {};
    for (let i = 1; i < marks.length; i += 2) parts[marks[i]] = marks[i + 1].replace(/\n$/, "");
    if (parts.shared || !head) continue;
    const next = shareParts(Object.fromEntries(PARTS.map(p => [p, parts[p]])));
    if (!next.shared) continue;
    const out = themeFile(JSON.parse(head[1]), next);
    fs.writeFileSync(path.join(dir, file), out);
    before += text.length; after += out.length;
    console.log(`✓ ${file}  ${(text.length / 1024).toFixed(0)} → ${(out.length / 1024).toFixed(0)} KB`);
}
console.log(`共节省 ${((before - after) / 1024).toFixed(0)} KB`);
