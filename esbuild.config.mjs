import esbuild from "esbuild";
import {validateThemeBuild} from "./scripts/validate-build.mjs";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const prod = process.argv[2] === "production";
const OUT = "dist/plugin";
fs.mkdirSync(OUT, { recursive: true });

// 生成：图标集、官方插件运行时等（从仓库 src/ 与 released/ 提取）
execSync("node scripts/gen-assets.mjs", { stdio: "inherit" });

const copyStatic = {
    name: "copy-static",
    setup(build) {
        build.onEnd(result => {
            if (result.errors.length) return;
            validateThemeBuild(".");
            fs.copyFileSync("manifest.json", path.join(OUT, "manifest.json"));
            const css = ["styles/plugin.css","styles/diagram-interaction.css","styles/image-compat.css","styles/header-toolbar.css"].map(f => fs.readFileSync(f, "utf8")).join("\n");
            fs.writeFileSync(path.join(OUT, "styles.css"), css);
            // 主题目录 themes/：common.css + 每套主题一个文件，直接维护、原样复制
            for (const sub of ["css", "css-typora", "themes"]) fs.rmSync(path.join(OUT, sub), { recursive: true, force: true });
            fs.mkdirSync(path.join(OUT, "themes"), { recursive: true });
            for (const f of fs.readdirSync("themes")) fs.copyFileSync(path.join("themes", f), path.join(OUT, "themes", f));
            execSync("node scripts/install.mjs", { stdio: "inherit" });
        });
    },
};

const ctx = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    // Obsidian 提供 CM 共享依赖；Markdown 解析器需随插件打包。
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/common", "@lezer/highlight", "@lezer/lr"],
    format: "cjs",
    target: "es2020",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    minify: prod,
    loader: { ".css": "text", ".txt": "text" },
    outfile: path.join(OUT, "main.js"),
    plugins: [copyStatic],
});

if (prod) {
    await ctx.rebuild();
    process.exit(0);
} else {
    await ctx.watch();
}
