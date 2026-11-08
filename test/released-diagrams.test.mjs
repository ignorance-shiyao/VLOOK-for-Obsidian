import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs,{readFileSync} from 'node:fs';
import postcss from 'postcss';
import {releasedDiagramCss} from '../scripts/released-diagrams.mjs';

test('公开图表规则恢复所有 SVG 选择器及 important，不混入 Typora 编辑界面',{skip:!fs.existsSync(new URL('../upstream/released/themes',import.meta.url))},()=>{
    const original=postcss.parse(readFileSync(new URL('../upstream/released/themes/vlook-joint.css',import.meta.url),'utf8'));
    const valid=s=>/^(?:svg\[aria-roledescription|\.v-actor-(?:front|key-sys|ext-sys)$)/.test(s);
    const expected=[];original.walkRules(rule=>{const selectors=rule.selectors.filter(valid);if(selectors.length)expected.push({selectors,body:rule.nodes.map(n=>n.toString()).join(';')});});
    const restored=postcss.parse(releasedDiagramCss(original.toString())),actual=[];
    restored.walkRules(rule=>{assert.ok(rule.selectors.every(valid));actual.push({selectors:rule.selectors,body:rule.nodes.map(n=>n.toString()).join(';')});});
    assert.ok(actual.length>200);assert.deepEqual(actual,expected);
    assert.ok(!restored.toString().includes('#typora-sidebar'));
});

test('恢复图表规则保留深色媒体和支持条件，无规则明确阻止构建',()=>{
    const css='body{color:red}@media (prefers-color-scheme:dark){@supports (display:grid){svg[aria-roledescription] .node{fill:blue!important}.editor{color:pink}}}';
    const restored=releasedDiagramCss(css);
    assert.match(restored,/@media \(prefers-color-scheme:dark\)/);assert.match(restored,/@supports \(display:grid\)/);assert.ok(restored.includes('!important'));assert.ok(!restored.includes('.editor'));
    assert.throws(()=>releasedDiagramCss('body{color:red}'),/未找到 Mermaid/);
});
