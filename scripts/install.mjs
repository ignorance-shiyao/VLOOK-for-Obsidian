// 将构建产物安装到 Obsidian 仓库（vault）
// 用法：node scripts/install.mjs [vault 路径]   默认安装到 test-vault/
//      VLOOK_VAULT=/path/to/vault npm run install:vault
import fs from "node:fs";
import {validatePluginBuild} from './validate-build.mjs';
import {verifyInstalled} from "./verify-installed.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const vault = path.resolve(process.argv[2] || process.env.VLOOK_VAULT || path.join(ROOT, "test-vault"));

if (!fs.existsSync(vault)) {
    console.error(`✗ 仓库不存在：${vault}`);
    process.exit(1);
}

function copyDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const f of fs.readdirSync(from)) {
        const s = path.join(from, f), d = path.join(to, f);
        fs.statSync(s).isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
    }
}

const pluginSrc = path.join(ROOT, "dist/plugin");
if (!fs.existsSync(path.join(pluginSrc, "main.js"))) {
    console.error("✗ 请先运行 npm run build");
    process.exit(1);
}
validatePluginBuild(pluginSrc);
const obs = path.join(vault, ".obsidian");
// 旧版按 css/、css-typora/ 存放主题，已由 themes/ 取代
for (const sub of ["css", "css-typora"]) fs.rmSync(path.join(obs, "plugins/vlook", sub), { recursive: true, force: true });
copyDir(pluginSrc, path.join(obs, "plugins/vlook"));
const checked = verifyInstalled(pluginSrc, path.join(obs, "plugins/vlook"));
const appearanceFile = path.join(obs, "appearance.json");
if (fs.existsSync(appearanceFile)) {
    const appearance = JSON.parse(fs.readFileSync(appearanceFile, "utf8"));
    if (/^VLOOK /i.test(appearance.cssTheme || "")) {
        appearance.cssTheme = "";
        fs.writeFileSync(appearanceFile, JSON.stringify(appearance, null, 2));
    }
}

// 启用插件（仅追加，不改动其他配置）
const listFile = path.join(obs, "community-plugins.json");
const list = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")) : [];
if (!list.includes("vlook")) {
    list.push("vlook");
    fs.writeFileSync(listFile, JSON.stringify(list, null, 2));
}
console.log(`✓ 已安装到 ${vault}，${checked} 个构建文件校验一致`);
console.log("  在 Obsidian 中：设置 ▸ 第三方插件 启用 VLOOK；通过插件调色板切换内置配色（默认蓝色）");
