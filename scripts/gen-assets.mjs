import { adaptRuntime } from "./runtime-transform.mjs";
// 从 VLOOK™ 源码提取插件需要复用的资源，生成到 src/generated/
// - icons.ts：VLOOK 图标集（SVG symbol sprite）
// - vlook-runtime.txt：官方 VLOOK 插件（单机版），用于「VLOOK 预览 / 导出 HTML」
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const REPO = path.join(ROOT, "upstream");
const GEN = path.join(ROOT, "src/generated");
fs.mkdirSync(GEN, { recursive: true });

const vlookJs = fs.readFileSync(path.join(REPO, "src/vlook.js"), "utf8");

/** 提取 vlook.js 顶部的字符串常量定义（const _ = ``, ... ;） */
function extractConsts() {
    const start = vlookJs.indexOf("const _ = ``");
    const end = vlookJs.indexOf("// 全局变量", start);
    return vlookJs.slice(start, end).replace(/^const /, "var ");
}

/** 按函数名提取顶层函数源码 */
function extractFunction(name) {
    const re = new RegExp(`^function ${name}\\(`, "m");
    const m = re.exec(vlookJs);
    if (!m)
        throw new Error(`未找到函数 ${name}`);
    let i = vlookJs.indexOf("{", m.index), depth = 0;
    for (; i < vlookJs.length; i++) {
        const c = vlookJs[i];
        if (c === "{") depth++;
        else if (c === "}" && --depth === 0) break;
    }
    return vlookJs.slice(m.index, i + 1);
}

function genIcons() {
    // 递归收集 VLOOKui_iconSet 依赖的 V_ui_* / V_attr 辅助函数
    const need = new Set(["VLOOKui_iconSet"]), queue = ["VLOOKui_iconSet"];
    while (queue.length) {
        const src = extractFunction(queue.pop());
        for (const [, dep] of src.matchAll(/\b(V_ui_\w+|V_attr)\(/g))
            if (!need.has(dep)) { need.add(dep); queue.push(dep); }
    }
    const helpers = [...need].map(extractFunction).join("\n");
    const sandbox = `
        function V_ui_var(v){return "var(" + v + ")";}
        function V_length(v){return v.length;}
        function V_getQueryParamVal(){return null;}
        var gUndefined = undefined, gIconStyle_uico = "";
        ${extractConsts()}
        ${helpers}
        return VLOOKui_iconSet();`;
    const sprite = new Function(sandbox)();
    const ids = [...sprite.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]);
    fs.writeFileSync(path.join(GEN, "icons.ts"),
        `// 自动生成，请勿修改（来源：src/vlook.js VLOOKui_iconSet）\n`
        + `export const ICON_SPRITE = ${JSON.stringify(sprite)};\n`
        + `export const ICON_IDS = ${JSON.stringify(ids)};\n`);
    return ids.length;
}

function genRuntime() {
    const src = path.join(REPO, "released/plugin/plugin.txt");
    // jQuery 的 DOMEval 会动态创建 script 元素执行文本；笔记内容不应执行脚本，整体改为空操作
    const DOM_EVAL = /function (\w)\((\w),(\w),(\w)\)\{var (\w),(\w)=\(\4=\4\|\|\w\)\.createElement\("script"\);[^}]*\}/;
    const runtime = adaptRuntime(fs.readFileSync(src, "utf8"));
    if (!DOM_EVAL.test(runtime)) throw new Error("未找到 jQuery DOMEval，无法移除动态脚本创建");
    fs.writeFileSync(path.join(GEN, "vlook-runtime.txt"), runtime.replace(DOM_EVAL, "function $1($2,$3,$4){}"));
    const ver = (fs.readFileSync(src, "utf8").match(/VLOOK "([^"]+)"/) || [])[1] || "unknown";
    fs.writeFileSync(path.join(GEN, "version.ts"), `export const VLOOK_VERSION = ${JSON.stringify(ver)};\n`);
    return ver;
}

/** Typora 导出 HTML 的基础样式（VLOOK 主题以其为基础），从 docs/ 中的导出文件提取 */
function genTyporaBase() {
    const html = fs.readFileSync(path.join(REPO, "docs/guide2.html"), "utf8");
    const head = html.slice(0, html.indexOf("</head>"));
    const ids = ["style-base", "style-codemirror", "style-mathjax", "style-mathjax-ni"];
    const css = ids.map(id => {
        const m = head.match(new RegExp(`<style[^>]*id="${id}"[^>]*>([\\s\\S]*?)</style>`));
        return m ? `/* ${id} */\n${m[1]}` : "";
    }).join("\n");
    fs.writeFileSync(path.join(GEN, "typora-base.txt"), css);
    return css.length;
}

const n = genIcons();
const baseLen = genTyporaBase();
const ver = genRuntime();
console.log(`gen-assets: ${n} icons, runtime ${ver}, typora-base ${(baseLen / 1024).toFixed(0)} KB`);
