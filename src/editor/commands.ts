import type { Editor } from "obsidian";
import type VlookPlugin from "../main";
import { moveTable, type TableMove } from "../core/table-move";

// 插入与渲染共用原版语法；在实时预览和源码模式均可使用。
export const INSERT_SYNTAX = [
    { id: "tag", name: "标签", before: "*`", after: "`*", placeholder: "标签" },
    { id: "badge", name: "多级标签", before: "*名称`", after: "`*", placeholder: "值" },
    { id: "scratch", name: "刮刮卡", before: "***", after: "***", placeholder: "隐藏内容" },
    { id: "ruby", name: "注音", before: "文字_^", after: "^_", placeholder: "wén zì" },
    { id: "color", name: "着色", before: "", after: "_~Bu~_", placeholder: "文字" },
    { id: "progress", name: "进度条", before: "**==", after: "==**", placeholder: "50" },
    { id: "caption", name: "题注", before: "\n\n*==", after: "==*\n\n", placeholder: "题注" },
    { id: "tabs", name: "页签组", before: "\n\n_^tab^_\n\n", after: "\n\n", placeholder: "> 第一个页签\n>\n> 内容\n\n> 第二个页签\n>\n> 内容" },
    { id: "columns", name: "分栏", before: "\n\n---\n\n", after: "\n\n", placeholder: "> 第一栏\n\n> 第二栏" },
    { id: "toc", name: "目录", before: "\n\n[TOC]\n\n", after: "", placeholder: "" },
    { id: "fold", name: "折叠引用块", before: "\n\n> ###### ", after: "\n>\n> 内容\n\n", placeholder: "标题" },
];

export function insertSyntax(editor: Editor, syntax: typeof INSERT_SYNTAX[number]) {
    const selected = editor.getSelection();
    editor.replaceSelection(syntax.before + (selected || syntax.placeholder) + syntax.after);
}

export function registerEditorCommands(plugin: VlookPlugin) {
    for (const syntax of INSERT_SYNTAX) plugin.addCommand({
        id: `insert-${syntax.id}`, name: `插入${syntax.name}`,
        editorCallback: editor => insertSyntax(editor, syntax),
    });
    const moves: [TableMove, string][] = [["up", "上移当前行"], ["down", "下移当前行"], ["left", "左移当前列"], ["right", "右移当前列"]];
    for (const [move, name] of moves) plugin.addCommand({
        id: `table-move-${move}`, name: `表格：${name}`,
        editorCheckCallback: (checking, editor) => {
            const cursor = editor.getCursor(), lines = editor.getValue().split("\n");
            const result = moveTable(lines, cursor.line, cursor.ch, move);
            if (!result) return false;
            if (!checking) {
                editor.replaceRange(result.lines.join("\n"), { line: result.from, ch: 0 }, { line: result.to, ch: lines[result.to].length });
                editor.setCursor({ line: result.line, ch: Math.min(cursor.ch, editor.getLine(result.line).length) });
            }
            return true;
        },
    });
}
