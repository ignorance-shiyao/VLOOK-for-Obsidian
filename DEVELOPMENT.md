# 开发说明

## 构建与测试

```bash
npm install --legacy-peer-deps
npm run build          # 编译主题 + 打包插件，并同步到调试库
npm run dev            # 监听源码与样式，成功构建后自动同步
npm test               # jsdom 单元测试
npm run install:vault  # 安装到调试库；或 node scripts/install.mjs <库路径>
npm run verify:install # 只读校验构建文件与安装目录一致
```

`VLOOK_VAULT=/其他库路径` 可覆盖同步目标。同步不会覆盖插件的 `data.json`；构建文件缺失或校验失败时会中止并报告。

## 目录

| 路径 | 内容 |
| ---- | ---- |
| `src/core/` | 源码索引、编号、颜色等基础模块 |
| `src/features/` | 各语法的渲染实现 |
| `src/editor/` | 实时预览扩展（区块预览、行内装饰） |
| `src/preview/` | 完整预览、HTML 导出、导出页脚本（主题切换、弹出层避让、图片内嵌） |
| `src/notify.ts` | 统一的分级提示 |
| `src/theme-switcher.ts` | 主题与明暗切换 |
| `scripts/` | 主题构建（`build-themes.mjs`）、运行时转换、安装与校验脚本 |
| `styles/` | 插件样式 |
| `test/` | 单元测试与夹具 |
| `docs/` | 文档图片与示例笔记 |
| `upstream/` | 构建所需的 VLOOK for Typora 原版文件（主题 LESS 源码、运行时、基础样式与回归样例），仅作输入，不随插件修改 |

## 主题与导出页

主题源文件在 `themes/`：`common.css` 是各主题共用的样式，每套主题一个 `<id>.css`，均为可直接手改的普通 CSS；每个文件分 `obsidian`（编辑 / 阅读视图）与 `export`（预览与导出 HTML）两部分，加载时公共样式在前、主题在后。构建插件时原样复制到插件目录的 `themes/`，运行时只从目录读取，同 id 的定制主题（设置中的主题目录）覆盖内置主题。

默认主题 `blue.css` 与 `common.css` 打进 `main.js`，首次运行或插件升级后写入插件目录的 `themes/`；可用主题完全由目录内容决定：id 取文件名，文件头只用于名称与色点；其余主题由用户放入，或点击「获取更多主题」后按发布页上的 `themes.json` 清单、在选用时按插件版本下载 `theme-<id>.css`（`src/core/theme-download.ts`）。发布流程：`npm run build && npm run release:assets`（清单由 `themes/` 下的文件自动生成，新增主题无需改代码），把 `dist/release/` 下的全部文件上传到标签与 `manifest.json` 版本一致的发布页。

`npm run build:themes`（`scripts/build-themes.mjs`）只用于从 `src/less` 重新生成 `themes/`，会覆盖手改的内容：`dist/css` 供 Obsidian 内使用，`dist/css-typora` 供完整预览与导出页使用，再拆出公共样式并核对层叠结果不变。`--less` 参数生成不依赖 `common.css` 的单文件定制主题。导出页的阅读工具来自随插件打包的运行时，`scripts/runtime-transform.mjs` 在构建时对其做适配，匹配失败会直接报错而不是静默跳过。

## 测试文档

综合示例在 `docs/sample`；原版回归样例在 `upstream/released/samples`；`test-vault/` 里另有回归用的文库与链接文档。新增场景优先补进现有文档，不再为单个修复新建笔记。

## 发布

发布到社区插件市场需要仓库根目录有 `manifest.json`，每个 Release 附带 `main.js`、`manifest.json`、`styles.css`（`css`、`css-typora` 文件夹随插件一同提供）。`zenuml.js` 作为单独附件发布，不放进默认安装包。
