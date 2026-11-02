// 将 VLOOK™ 的 Typora 主题 CSS 转换为适用于 Obsidian 的 CSS
import postcss from "postcss";
import {readFileSync} from 'node:fs';

// Obsidian 中 VLOOK 文档根容器（保留与 #write 相同的选择器权重）
export const W = ":is(.markdown-rendered,#vlook-write)";

// 仅用于 Typora 编辑器 / 导出页面框架的选择器，在 Obsidian 中无意义
const DROP = [
    /content\s*>/,
    /#typora-/,
    /body\.(os-windows|html-for-mac|mac-seamless-mode|typora-export|print|ty-|pin-outline|on-focus-mode)/,
    /body\[class/,
    /body:not\(/,
    /\.ty-/,
    /\.md-image\b/,
    /\.md-htmlblock\b/,
    /\.md-mathblock-panel/,
    /\.md-diagram-panel/,
    /\.md-fences/,
    /\.md-meta/,
    /\.md-img-error/,
    /\.md-rawblock/,
    /\.md-focus/,
    /\.md-expand/,
    /\.cm-s-inner/,
    /\.CodeMirror/,
    /#top-titlebar|#file-library|#outline-content|\.outline-|\.info-panel|\.sidebar-|\.megamenu|\.file-|\.active-tab|#md-searchpanel|\.typora-|footer|header\b/,
    /^\s*(html|body)\s*$/,
    /^\s*#write(\.[\w-]+|:[\w-]+(\([^)]*\))?)*\s*$/, // #write 根容器自身的布局
    /\.slide\b/,
    /:not\(\.done\)/, // Typora 加载遮罩，由运行时加 .done 移除，Obsidian 中不存在该时机
];

/** 转换单个选择器，返回 null 表示丢弃 */
export function mapSelector(sel) {
    let s = sel.trim();
    s = s.replace(/\.typora-export\s+#write/g, "#write");
    // 阅读视图中每个块被单独的 div 包裹，:first-child / 兄弟选择器失效，改为插件标记的类
    s = s.replace(/#write\s*>\s*pre\.md-meta-block:first-child\s*\+\s*h6/g, "#write h6.vlook-cover");
    s = s.replace(/#write\s*>\s*h6:first-child\s*~\s*h1:last-child/g, "#write h1.vlook-back-cover");
    s = s.replace(/#write\s*>\s*h6:first-child\s*~\s*/g, "#write.vlook-has-cover ");
    s = s.replace(/#write\s*>\s*h6:first-child(?![\w-])/g, "#write h6.vlook-cover");
    s = s.replace(/#write\s*>\s*/g, "#write :where(.markdown-preview-sizer>div)>");
    if (DROP.some(re => re.test(s)))
        return null;
    if (/typora-export/.test(s))
        return null;
    s = s.replace(/#write(?![\w-])/g, W);
    s = s.replace(/^:root\b/, "body");
    // Typora 的文本总被 span 包裹，「无子元素」即空段落；Obsidian 纯文本段落也无子元素，改用 :empty
    s = s.replace(/:not\(:has\(\*\)\)/g, ":empty");
    return s;
}

/** 去除同一字体的重复镜像入口。 */
function rewriteImport(params) {
    if (/vlook\/github-io\//.test(params))
        return null; // 同一字体的镜像，保留一个即可
    return params;
}

const plugin = () => ({
    postcssPlugin: "vlook-obsidian",
    Once(root) {
        root.walkAtRules("import", rule => {
            const font=rule.params.match(/["']vlook\/pages-dev\/(fs-[\w-]+\.css)["']/);
            if(font){
                // The host blocks external stylesheet origins. Inline the released
                // font-face definitions while preserving their original font URLs.
                const css=readFileSync(new URL(`../upstream/released/themes/vlook/pages-dev/${font[1]}`,import.meta.url),'utf8');
                rule.replaceWith(postcss.parse(css).nodes);return;
            }
            const p = rewriteImport(rule.params);
            p === null ? rule.remove() : (rule.params = p);
        });
        root.walkRules(rule => {
            const parent = rule.parent;
            const inDark = parent?.type === "atrule" && parent.name === "media"
                && /prefers-color-scheme\s*:\s*dark/.test(parent.params);
            // keyframes 内的规则不处理
            if (parent?.type === "atrule" && /keyframes/.test(parent.name))
                return;
            const out = [];
            for (const sel of rule.selectors) {
                let m = mapSelector(sel);
                if (m === null)
                    continue;
                if (inDark)
                    m = m === "body" ? "body.theme-dark" : `body.theme-dark ${m}`;
                out.push(m);
            }
            out.length ? (rule.selectors = [...new Set(out)]) : rule.remove();
        });
        // 将深色模式的媒体查询展开为 .theme-dark 作用域
        root.walkAtRules("media", at => {
            if (/prefers-color-scheme\s*:\s*dark/.test(at.params))
                at.replaceWith(at.nodes);
        });
        // 清理空的 at-rule
        root.walkAtRules(at => {
            if (at.nodes && at.nodes.length === 0)
                at.remove();
        });
    },
});
plugin.postcss = true;

export async function transformCss(css) {
    const result = await postcss([plugin()]).process(css, { from: undefined });
    // @import 必须位于文件开头
    return result.css;
}
