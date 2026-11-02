import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {publicChartCases} from '../scripts/chart-fixtures.mjs';


test('图表验收拆分不重复收录引用、列表与外层代码中的教学副本',()=>{
 const source='# 顶层\n\n```mermaid\nflowchart LR\n```\n\n> ```mermaid\n> pie\n> ```\n\n- ```mermaid\n  gantt\n  ```\n\n````md\n```mermaid\nexample\n```\n````';
 const cases=publicChartCases(source);assert.equal(cases.length,1);assert.equal(cases[0].title,'顶层');assert.equal(cases[0].line,3);
});
