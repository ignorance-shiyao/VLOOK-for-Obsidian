// 监听源码、样式和主题；成功构建后由 esbuild 配置同步到 VLOOK_VAULT / test-vault。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let timer, running = false, pending = false;
function build() {
    if (running) { pending = true; return; }
    running = true;
    const child = spawn("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
    child.on("error", error => console.error(error));
    child.on("close", code => {
        running = false;
        if (code) console.error("构建失败，本轮未同步；修复后保存文件会重试。");
        if (pending) { pending = false; build(); }
    });
}
const directories = ["src", "styles", "scripts", "upstream/src/less", "upstream/released/plugin"];
for (const directory of directories) {
    fs.watch(path.resolve(root, directory), { recursive: true }, (_, name) => {
        if (directory === "src" && name && /^generated(?:[\\/]|$)/.test(String(name))) return;
        clearTimeout(timer);
        timer = setTimeout(build, 300);
    });
}
for (const file of ["manifest.json", "esbuild.config.mjs", "package.json"]) {
    fs.watch(path.join(root, file), () => {
        clearTimeout(timer);
        timer = setTimeout(build, 300);
    });
}
console.log("监听已启动：构建成功后自动安装到", process.env.VLOOK_VAULT || path.join(root, "test-vault"));
build();
