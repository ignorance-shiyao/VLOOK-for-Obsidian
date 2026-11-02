import {readFileSync} from 'node:fs';
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { setup, html, dropdown } from "./harness.mjs";

let M;
before(async () => { M = await setup(); });

test('真实顺序图特殊角色去除前缀并标记首尾角色与生命线，消息内容不变且可重复处理',()=>{
    const fixture=JSON.parse(readFileSync(new URL('./fixtures/sequence-original-svg.json',import.meta.url),'utf8'));
    const root=html(`<div class="mermaid">${fixture.svg}</div>`),svg=root.querySelector('svg');
    const messages=Array.from(svg.querySelectorAll('text.messageText'),el=>el.textContent);
    M.processMermaid(root);
    assert.equal(svg.querySelectorAll('rect.actor.v-actor-key-sys').length,2);
    assert.equal(svg.querySelectorAll('rect.actor.v-actor-ext-sys').length,2);
    assert.equal(svg.querySelectorAll('line.actor-line.v-actor-key-sys').length,1);
    assert.ok(Array.from(svg.querySelectorAll('text.actor'),el=>el.textContent).every(text=>!text.startsWith('**')&&!text.startsWith('--')));
    assert.deepEqual(Array.from(svg.querySelectorAll('text.messageText'),el=>el.textContent),messages);
    const result=svg.outerHTML;M.processMermaid(root);assert.equal(svg.outerHTML,result);
    M.toTyporaDom(root,true);assert.equal(root.querySelector('svg').outerHTML,result);
});

test('真实顺序图片断保留类型，按原版配色和定位，可重复处理及切换语言',()=>{
    const fixture=JSON.parse(readFileSync(new URL('./fixtures/sequence-original-svg.json',import.meta.url),'utf8'));
    const root=html(`<div class="mermaid">${fixture.svg}</div>`);
    M.processMermaid(root,{language:'zh-cn'});
    const definitions={alt:['分支','vn','Alt.'],opt:['可选',undefined,'Opt.'],loop:['循环','cy','Loop.'],par:['并行','og','Par.'],break:['中断','bk','Break'],critical:['关键','rd','Critical']};
    const labels=Array.from(root.querySelectorAll('text[data-vlook-sequence-type]'));
    assert.ok(labels.length>=6);
    for(const label of labels){
        const [title,color]=definitions[label.dataset.vlookSequenceType];assert.equal(label.textContent,title);
        const group=label.parentElement,box=group.querySelector('polygon.labelBox');
        if(color){assert.equal(box.style.getPropertyValue('fill'),`var(--ac-${color})`);assert.equal(box.style.getPropertyPriority('fill'),'important');}
        const points=box.getAttribute('points').split(/[\s,]+/).map(Number),right=Math.max(...points.filter((_n,i)=>i%2===0));
        Array.from(group.children).filter(el=>el.matches('text.loopText')).forEach((text,i)=>{
            assert.equal(text.getAttribute('x'),String(right+(i===0?10:40)));
            for(const span of text.querySelectorAll('tspan'))assert.equal(span.getAttribute('x'),text.getAttribute('x'));
        });
    }
    const result=root.innerHTML;M.processMermaid(root,{language:'zh-cn'});assert.equal(root.innerHTML,result);
    M.processMermaid(root,{language:'en'});for(const label of labels)assert.equal(label.textContent,definitions[label.dataset.vlookSequenceType][2]);
});

test('导出保留顺序图片断原始关键词，交由官方运行时处理',()=>{
    const fixture=JSON.parse(readFileSync(new URL('./fixtures/sequence-original-svg.json',import.meta.url),'utf8'));
    const root=html(`<div class="mermaid">${fixture.svg}</div>`);
    const before=Array.from(root.querySelectorAll('text.labelText'),el=>el.textContent);
    M.toTyporaDom(root,true);
    assert.deepEqual(Array.from(root.querySelectorAll('text.labelText'),el=>el.textContent),before);
    assert.equal(root.querySelectorAll('[data-vlook-sequence-type]').length,0);
});

test('角色前缀跨文字节点只消耗语法字符，不重建 tspan 排版',()=>{
    const root=html('<svg aria-roledescription="sequence"><rect class="actor" name="A"/><text class="actor"><tspan x="10">*</tspan><tspan dy="20">*角色</tspan></text><line class="actor-line" name="A"/><text class="messageText">**消息保留</text><text class="sequenceNumber" textLength="30">1</text></svg>');
    const spans=Array.from(root.querySelectorAll('tspan'));M.processMermaid(root);
    assert.equal(root.querySelector('text.actor').textContent,'角色');assert.equal(root.querySelector('text.messageText').textContent,'**消息保留');
    assert.equal(root.querySelectorAll('tspan')[0],spans[0]);assert.equal(spans[0].getAttribute('x'),'10');assert.equal(spans[1].getAttribute('dy'),'20');
    assert.equal(root.querySelector('text.sequenceNumber').hasAttribute('textLength'),false);
});

test('多语言字数与原版 V_countWord 一致，阅读时长保持原版边界',async()=>{
    const vm=await import('node:vm'),original=readFileSync(new URL('../upstream/src/vlook.js',import.meta.url),'utf8').match(/function V_countWord\(content\) \{[\s\S]*?\n\}/)[0].replaceAll('content.m(','content.match(');
    for(const text of ['中文 日本語 カタカナ 한글 Hello world 123','Привет мир العربية café mañana','a中文b','']){
        const expected=vm.runInNewContext(original+';V_countWord(input)',{input:text,V_length:value=>value.length});
        assert.deepEqual(M.vlookWordCount(text),{latin:expected.latin,CJK:expected.CJK,total:expected.total});
    }
    for(const [total,duration] of [[0,'1 分钟'],[199,'1 分钟'],[399,'1 分钟'],[400,'2 分钟'],[12000,'60 分钟'],[12200,'1.0 小时']])assert.equal(M.readingDuration(total),duration);
});

test('阅读正文估算排除元数据、链接地址、图片和代码语言，保留可见文本与代码',()=>{
    const source='---\ntitle: 不应统计\n---\n\n[正文链接](https://secret.example/path "说明") ![图片描述](image.png)\n\n```html\n<div>代码正文</div>\n```\n\n<div>HTML 正文</div>\n\n&copy;';
    const text=M.readingText(source);
    for(const included of ['正文链接','<div>代码正文</div>','HTML 正文','©'])assert.ok(text.includes(included),included);
    for(const excluded of ['不应统计','secret.example','图片描述','image.png','说明'])assert.ok(!text.includes(excluded),excluded);
});

test('阅读时长 Wiki 别名只计显示文字，嵌入路径不算正文，代码示例仍保留',()=>{
    const source='[[folder/target#章节|可见别名]] ![[assets/image.png|200]] [[普通笔记]]\n\n`[[code/target|代码示例]]`\n\n```md\n![[代码里的图片]]\n```';
    const text=M.readingText(source);
    assert.ok(text.includes('可见别名'));assert.ok(text.includes('普通笔记'));
    assert.ok(!text.includes('folder/target'));assert.ok(!text.includes('assets/image.png'));assert.ok(!text.includes('200'));
    assert.ok(text.includes('[[code/target|代码示例]]'));assert.ok(text.includes('![[代码里的图片]]'));
});

test('真实 MathJax CHTML 样式和字体内嵌，复用相同 URL 并保留字符规则',async()=>{
    const base=document.createElement('base');base.href='http://127.0.0.1:18753/';document.head.append(base);
    const evidence=JSON.parse(readFileSync(new URL('./fixtures/host-mathjax-results.json',import.meta.url),'utf8'));
    const styles=evidence.styles.map(item=>{const style=document.createElement('style');style.id=item.id;style.textContent=item.css;document.head.append(style);return style;});
    const root=html(evidence.results.map(item=>item.html).join('\n')),calls=[];
    try{
        const css=await M.collectMathStyles(root,async url=>{calls.push(url);return new Uint8Array([0,1,2,253,254,255]);});
        assert.ok(calls.length>=20);assert.equal(calls.length,new Set(calls).size);
        assert.ok(!/url\(["']?\//.test(css));assert.match(css,/data:font\/woff2;base64,AAEC\/f7\//);
        assert.ok(css.includes('mjx-container'));assert.ok(css.includes('@font-face'));
    }finally{styles.forEach(style=>style.remove());base.remove();}
});

test('无 CHTML 不读取字体；缺样式、字体读取失败或空字体明确阻止导出',async()=>{
    assert.equal(await M.collectMathStyles(html('<p>普通文本</p>'),async()=>{assert.fail('不应读取');}), '');
    const root=html('<mjx-container jax="CHTML"><mjx-math/></mjx-container>');
    await assert.rejects(M.collectMathStyles(root),/CHTML 样式尚未就绪/);
    const style=document.createElement('style');style.id='MJX-CHTML-styles';style.textContent='@font-face{src:url("https://example.org/font.woff2")}';document.head.append(style);
    try{
        await assert.rejects(M.collectMathStyles(root,async()=>{throw Error('failed asset');}),/failed asset/);
        await assert.rejects(M.collectMathStyles(root,async()=>new Uint8Array()),/数学字体为空/);
    }finally{style.remove();}
});

test('宿主真实23个数学输出经过导出 DOM 转换，CHTML、编号和引用保留',()=>{
    const evidence=JSON.parse(readFileSync(new URL('./fixtures/host-mathjax-results.json',import.meta.url),'utf8'));
    assert.equal(evidence.results.length,23);assert.ok(evidence.results.every(item=>item.result==='通过'));
    for(const sample of evidence.results){
        const root=html(`<div class="math math-block">${sample.html}</div>`),output=root.querySelector('mjx-container');assert.ok(output,sample.name);
        const before=output.outerHTML;M.toTyporaDom(root,true);
        assert.equal(root.querySelector('mjx-container').outerHTML,before,sample.name);
        assert.equal(html(root.innerHTML).querySelector('mjx-container').outerHTML,before,sample.name);
    }
    assert.deepEqual(evidence.labels,['mjx-eqn:mymath-1','mjx-eqn:mymath-2','mjx-eqn:mymath-3']);
    assert.deepEqual(evidence.references,['#mjx-eqn%3Amymath-1']);
});

test('公式围栏数量排除外层代码示例，覆盖引用和列表里的真实 math',()=>{
    const source='```math\nx=1\n```\n\n> ```math\n> y=2\n> ```\n\n- 条目\n\n  ```math\n  z=3\n  ```\n\n````markdown\n```math\nfake=4\n```\n````';
    assert.equal(M.sourceMathFenceCount(source),3);
    assert.equal(M.sourceMathFenceCount('`math` 和普通正文\n\n```js\nx=1\n```'),0);
});

test('公式围栏最低数量阻止空输出或部分公式通过，异步补齐后才完成',async()=>{
    await assert.rejects(M.waitForMath(html('<pre><code class="language-math">x=1</code></pre>'),25,1,undefined,1),/1 个未完成/);
    await assert.rejects(M.waitForMath(html('<div data-vlook-math-fence="1"><div class="math math-block"><mjx-container><svg/></mjx-container></div></div>'),25,1,undefined,2),/1 个未完成/);
    const root=html('<div></div>');
    const done=M.waitForMath(root,150,1,undefined,2);
    root.innerHTML='<div data-vlook-math-fence="1"><div class="math math-block"><mjx-container><svg/></mjx-container></div></div><div data-vlook-math-fence="1"><div class="math math-block"><mjx-container><svg/></mjx-container></div></div>';
    await done;
    const unrelated=html('<div class="math math-block"><mjx-container><svg/></mjx-container></div>');
    await assert.rejects(M.waitForMath(unrelated,25,1,undefined,1),/1 个未完成/,'普通美元公式不能掩盖缺失的围栏公式');
});

test('math 围栏复用宿主数学渲染，保留原 TeX、来源路径和生命周期组件',async()=>{
    const original=M.MarkdownRenderer.render,source='\\begin{align*}\nx&=1\\label{Energy:A+B}\\tag{Energy}\\\\\ny&=2\n\\end{align*}';
    const app={},component={},root=html('<div></div>');let call;
    try{
        M.MarkdownRenderer.render=async(...args)=>{call=args;args[2].innerHTML='<div class="math math-block"><mjx-container><svg><text>Energy</text></svg></mjx-container></div>';};
        await M.renderMathFence(app,source,root,'folder/math.md',component);
        assert.equal(call[0],app);assert.equal(call[1],`<!--vlook-raw-render-->\n$$\n${source}\n$$`);
        assert.equal(call[3],'folder/math.md');assert.equal(call[4],component);
        await M.waitForMath(root,100,1);
        assert.equal(root.querySelector('svg').textContent,'Energy');
    }finally{M.MarkdownRenderer.render=original;}
});

test('math 围栏宿主渲染失败不会被吞掉或伪装成普通代码成功',async()=>{
    const original=M.MarkdownRenderer.render,error=Error('host MathJax failure');
    try{M.MarkdownRenderer.render=async()=>{throw error;};await assert.rejects(M.renderMathFence({},'x=1',html('<div/>'),'math.md',{}),value=>value===error);}
    finally{M.MarkdownRenderer.render=original;}
});

test('动态 ZenUML 配色样式随 SVG 进入独立 HTML，转换不依赖插件外置样式',()=>{
    const evidence=JSON.parse(readFileSync(new URL('./fixtures/zenuml-dark-result.json',import.meta.url),'utf8'));
    assert.equal(evidence.diagrams.length,2);
    for(const item of evidence.diagrams){
        const root=html(`<div class="mermaid">${item.svg}</div>`),svg=root.querySelector('svg'),before=svg.outerHTML;
        assert.equal(svg.querySelectorAll('style[data-vlook-zenuml-palette]').length,1);
        assert.match(svg.querySelector('style[data-vlook-zenuml-palette]').textContent,/var\(--db,var\(--background-primary,#fff\)\)/);
        M.toTyporaDom(root,true);
        assert.equal(root.querySelector('svg').outerHTML,before);
        assert.equal(html(root.innerHTML).querySelector('svg').outerHTML,before);
    }
});

test('ZenUML 参与者嵌套 SVG 上的手势缩放整张图，退出保留图标原样',()=>{
    const {zenuml}=JSON.parse(readFileSync(new URL('./fixtures/host-mermaid-zenuml-results.json',import.meta.url),'utf8'));
    const body=html(`<div class="mermaid">${zenuml[0].svg}</div>`);
    const diagram=body.querySelector('svg'),icon=diagram.querySelector('svg');assert.ok(icon);
    const original=icon.outerHTML,zoom=new M.ContentZoom(body);
    try{
        icon.dispatchEvent(new window.WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));
        assert.match(diagram.style.transform,/scale\(1.5\)/);
        assert.equal(icon.outerHTML,original);
        icon.firstElementChild.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true,cancelable:true}));
        assert.match(diagram.style.transform,/scale\(1\)/);
        assert.equal(icon.outerHTML,original);
    }finally{zoom.dispose();}
    assert.equal(diagram.style.transform,'');assert.equal(icon.outerHTML,original);
});

test('MathJax 内部 SVG 与图标手势缩放公式容器，不单独移动字形',()=>{
    const body=html('<div class="math-block"><mjx-container display="true"><svg><g><svg><path d="M0 0L1 1"/></svg></g></svg></mjx-container></div>');
    const formula=body.querySelector('mjx-container'),glyph=body.querySelector('path'),zoom=new M.ContentZoom(body);
    try{
        glyph.dispatchEvent(new window.WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));
        assert.match(formula.style.transform,/scale\(1.5\)/);
        for(const svg of body.querySelectorAll('svg'))assert.equal(svg.style.transform,'');
    }finally{zoom.dispose();}
});

test('实际宿主加 ZenUML 输出经过导出 DOM 转换，节点、样式与引用完整保留', () => {
    const evidence=JSON.parse(readFileSync(new URL('./fixtures/host-mermaid-zenuml-results.json',import.meta.url),'utf8'));
    assert.equal(evidence.rows.length,32);assert.ok(evidence.rows.every(row=>row.result==='通过'));
    for(const sample of evidence.zenuml){
        const root=html(`<pre class="mermaid">${sample.svg}</pre>`);
        const svg=root.querySelector('svg');
        const before=svg.outerHTML;
        assert.ok(svg.querySelector('style'),'使用真实引擎的自带样式');
        assert.ok(svg.querySelector('text'),'使用真实引擎的文字节点');
        M.toTyporaDom(root,true);
        assert.equal(root.querySelectorAll('.md-diagram-panel').length,1);
        assert.equal(root.querySelector('svg'),svg,'移动原节点，避免重建时丢属性');
        assert.equal(svg.outerHTML,before);
        const restored=html(root.innerHTML);
        assert.equal(restored.querySelector('svg').outerHTML,before,'HTML 序列化再加载保留 SVG');
        M.toTyporaDom(root,true);
        assert.equal(root.querySelectorAll('svg').length,1+svg.querySelectorAll('svg').length,'参与者图标可含嵌套 SVG');
        assert.equal(root.querySelector('svg').outerHTML,before);
    }
});

const opts = { captionGroup: false, captionNumber: true };

test("数字格式转换", () => {
    assert.equal(M.decimalToZh(1, false), "一");
    assert.equal(M.decimalToZh(10, false), "十");
    assert.equal(M.decimalToZh(15, false), "十五");
    assert.equal(M.decimalToZh(20, false), "二十");
    assert.equal(M.decimalToZh(105, false), "一百零五");
    assert.equal(M.decimalToZh(3, true), "叁");
    assert.equal(M.decimalToRoman(14, true), "XIV");
    assert.equal(M.decimalToAlpha(28, true), "AB");
});

test("标题自动编号：默认模板", () => {
    const md = "# A\n\n## B\n\n## C\n\n### D\n\n# E\n\n## F";
    const idx = M.getSourceIndex(md, { ...opts, headerTemplate: "h1{{###. }},h2{{### }},h3{{### }}" });
    const nums = idx.blocks.filter(b => b.type === "heading").map(b => b.headerNum);
    assert.deepEqual(nums, ["1. ", "1.1 ", "1.2 ", "1.2.1 ", "2. ", "2.1 "]);
});

test("标题自动编号：中文、前缀与 -min", () => {
    const md = "# 总则\n\n## 目的\n\n## 范围";
    const idx = M.getSourceIndex(md, { ...opts, headerTemplate: "h1{{第#zh#章 }},h2{{步骤 #00#-min# - }}" });
    const nums = idx.blocks.filter(b => b.type === "heading").map(b => b.headerNum);
    assert.deepEqual(nums, ["第一章 ", "步骤 01 - ", "步骤 02 - "]);
});

test("封面与封底不参与编号", () => {
    const md = "---\ntitle: x\n---\n\n###### 封面标题\n\n# 第一章\n\n正文\n\n# 封底";
    const idx = M.getSourceIndex(md, { ...opts, headerTemplate: "h1{{###. }}" });
    const hs = idx.blocks.filter(b => b.type === "heading");
    assert.equal(hs[0].cover, "front");
    assert.equal(hs[2].cover, "back");
    assert.equal(hs[1].headerNum, "1. ");
    assert.equal(hs[2].headerNum, undefined);
    assert.equal(idx.frontmatter.title, "x");
});

test("题注：表格与代码块编号、双题注", () => {
    const md = [
        "*==第一个表==*", "", "| a | b |", "| - | - |", "| 1 | 2 |", "",
        "| c |", "| - |", "| 3 |", "",
        "_==代码示例_语言：JS_==_", "", "```js", "let a = 1;", "```",
    ].join("\n");
    const idx = M.getSourceIndex(md, opts);
    const tables = idx.blocks.filter(b => b.type === "table");
    assert.equal(tables[0].caption.cap1, "第一个表");
    assert.equal(tables[0].caption.num, "1");
    assert.equal(tables[1].caption.num, "2");
    assert.equal(tables[1].caption.cap1, undefined);
    const code = idx.blocks.find(b => b.type === "code");
    assert.equal(code.caption.cap1, "代码示例");
    assert.equal(code.caption.cap2, "语言：JS");
    assert.equal(idx.blocks[0].captionFor, 1);
});

test("题注按章节分组编号", () => {
    const md = "# 一\n\n| a |\n| - |\n| 1 |\n\n# 二\n\n| b |\n| - |\n| 2 |\n\n| c |\n| - |\n| 3 |";
    const idx = M.getSourceIndex(md, { captionGroup: true, captionNumber: true, headerTemplate: "h1{{###. }}" });
    assert.deepEqual(idx.blocks.filter(b => b.type === "table").map(b => b.caption.num), ["1-1", "2-1", "2-2"]);
});

test("页签组：连续内容", () => {
    const md = "_^tab^_\n\n*==表 A==*\n\n| a |\n| - |\n| 1 |\n\n```js\nx\n```\n\n> **小标题**\n> 内容\n\n普通段落";
    const idx = M.getSourceIndex(md, opts);
    const marker = idx.blocks[0];
    assert.deepEqual(marker.tabMarker, { id: 1, count: 3 });
    const members = idx.blocks.filter(b => b.tabGroup && b.captionFor === undefined);
    assert.deepEqual(members.map(b => b.type), ["table", "code", "blockquote"]);
    assert.equal(idx.blocks.at(-1).tabGroup, undefined);
});

test("分栏：hr 数量决定列数", () => {
    const md = "开头\n\n---\n---\n\n> 一\n\n> 二\n\n> 三\n\n正文\n\n---\n\n- a\n- b";
    const idx = M.getSourceIndex(md, opts);
    const quotes = idx.blocks.filter(b => b.type === "blockquote");
    assert.deepEqual(quotes.map(q => [q.columns.count, q.columns.index]), [[3, 1], [3, 2], [3, 3]]);
    const list = idx.blocks.find(b => b.type === "list");
    assert.equal(list.columns.count, 2);
    assert.equal(list.columns.kind, "list");
});

test("不发布的章节", () => {
    const md = "# 公开\n\n内容\n\n## ~~草稿~~\n\n隐藏内容\n\n### 子章节\n\n## 公开 2";
    const idx = M.getSourceIndex(md, opts);
    assert.deepEqual(idx.blocks.map(b => !!b.unpub), [false, false, true, true, true, false]);
});

test("渲染：表格题注与隐藏题注源", () => {
    const md = "*==销售数据==*\n\n| a |\n| - |\n| 1 |";
    const index = M.getSourceIndex(md, opts);
    const base = { app: null, settings: { ...M.DEFAULT_SETTINGS }, query: new M.Query("capnum=on"), sourcePath: "t.md", cssVar: () => "", index };
    const capEl = html(`<p><em><mark>销售数据</mark></em></p>`);
    M.renderSection(capEl, { ...base, block: index.blockAt(0) });
    assert.ok(capEl.classList.contains("vlook-caption-source"));
    const tblEl = html(`<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>`);
    M.renderSection(tblEl, { ...base, block: index.blockAt(2) });
    assert.ok(tblEl.querySelector("figure[data-cntr=table] .v-caption.table"));
    assert.match(tblEl.querySelector(".v-cap-1").textContent, /表 1 销售数据|Table 1 销售数据/);
});

test("渲染：页签栏与成员显隐", () => {
    const md = "_^tab^_\n\n| a |\n| - |\n| 1 |\n\n```js\nx\n```";
    const index = M.getSourceIndex(md, opts);
    const base = { app: null, settings: { ...M.DEFAULT_SETTINGS }, query: new M.Query(""), sourcePath: "t.md", cssVar: () => "", index };
    const parent = html("");
    const bar = document.createElement("div"); bar.innerHTML = `<p><em><sup>tab</sup></em></p>`;
    const t = document.createElement("div"); t.innerHTML = `<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>`;
    const c = document.createElement("div"); c.innerHTML = `<pre><code class="language-js">x</code></pre>`;
    parent.append(bar, t, c);
    M.renderSection(bar, { ...base, block: index.blockAt(0) });
    M.renderSection(t, { ...base, block: index.blockAt(2) });
    M.renderSection(c, { ...base, block: index.blockAt(6) });
    const tabs = bar.querySelectorAll(".tab-group-wrap > span");
    assert.equal(tabs.length, 2);
    assert.ok(!t.classList.contains("vlook-tab-hidden"));
    assert.ok(c.classList.contains("vlook-tab-hidden"));
    tabs[1].click();
    assert.ok(t.classList.contains("vlook-tab-hidden"));
    assert.ok(!c.classList.contains("vlook-tab-hidden"));
});

test("渲染：页签栏卸载后重新挂载的成员按已选页签显隐", () => {
    const md = "_^tab^_\n\n| a |\n| - |\n| 1 |\n\n```js\nx\n```";
    const index = M.getSourceIndex(md, opts);
    const base = { app: null, settings: { ...M.DEFAULT_SETTINGS }, query: new M.Query(""), sourcePath: "t.md", cssVar: () => "", index };
    const parent = html("");
    const bar = document.createElement("div"); bar.innerHTML = `<p><em><sup>tab</sup></em></p>`;
    parent.append(bar);
    M.renderSection(bar, { ...base, block: index.blockAt(0) });
    bar.querySelectorAll(".tab-group-wrap > span")[1].click();
    bar.remove();
    const t = document.createElement("div"); t.innerHTML = `<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>`;
    const c = document.createElement("div"); c.innerHTML = `<pre><code class="language-js">x</code></pre>`;
    M.renderSection(t, { ...base, block: index.blockAt(2) });
    M.renderSection(c, { ...base, block: index.blockAt(6) });
    assert.ok(t.classList.contains("vlook-tab-hidden"));
    assert.ok(!c.classList.contains("vlook-tab-hidden"));
    const again = document.createElement("div"); again.innerHTML = `<p><em><sup>tab</sup></em></p>`;
    M.renderSection(again, { ...base, block: index.blockAt(0) });
    assert.ok(again.querySelectorAll(".tab-group-wrap > span")[1].classList.contains("current"));
    const alone = document.createElement("div"); alone.innerHTML = `<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>`;
    M.renderSection(alone, { ...base, block: index.blockAt(2), suppressContentViewers: true });
    assert.ok(!alone.classList.contains("vlook-tab-hidden"));
});

test("渲染：标题编号写入 data-header-num", () => {
    const md = "# 一\n\n## 二";
    const index = M.getSourceIndex(md, { ...opts, headerTemplate: "h1{{###. }},h2{{### }}" });
    const el = html(`<h2 data-heading="二">二</h2>`);
    M.renderSection(el, { app: null, settings: { ...M.DEFAULT_SETTINGS }, query: new M.Query(""), sourcePath: "t.md", cssVar: () => "", index, block: index.blockAt(2) });
    assert.equal(el.querySelector("h2").getAttribute("data-header-num"), "1.1 ");
});

test("Typora DOM 转换", () => {
    const el = html(`<div class="el-h1"><h1 data-heading="标题">标题<span class="heading-collapse-indicator"></span></h1></div>
        <div class="el-pre"><pre class="language-js"><code class="language-js"><span class="token keyword">let</span> a = <span class="token string">"x\ny"</span>;</code><button class="copy-code-button">Copy</button></pre></div>
        <div class="el-table"><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div>
        <div class="el-div"><div class="callout" data-callout="tip"><div class="callout-title"><div class="callout-title-inner">Tip</div></div><div class="callout-content"><p>内容</p></div></div></div>
        <div class="el-p"><p><em>~Rd~</em>文字</p></div>`);
    M.toTyporaDom(el, true);
    assert.equal(el.querySelector("h1").id, "标题");
    assert.equal(el.querySelector(".heading-collapse-indicator"), null);
    const fence = el.querySelector("pre.md-fences");
    assert.equal(fence.getAttribute("lang"), "js");
    assert.equal(fence.querySelectorAll(".CodeMirror-line").length, 2, "跨行字符串应拆分为两行");
    assert.ok(fence.querySelector(".cm-keyword"));
    assert.ok(el.querySelector("figure.table-figure > table"));
    assert.ok(el.querySelector(".md-alert.md-alert-tip .md-alert-text-tip"));
    assert.ok(el.querySelector("em > sub"), "色号应转为 em>sub");
    assert.ok(el.querySelector("p > span"), "文本应被 span 包裹");
    assert.equal(el.querySelector(":scope > div.el-p"), null, "块包装应被拍平");
});

test("导出：移除不发布的章节", () => {
    const el = html(`<h1>公开</h1><p>a</p><h2><del>草稿</del></h2><p>隐藏</p><h3>子章节</h3><p>隐藏 2</p><h2>公开 2</h2><p>b</p>`);
    M.removeUnpublished(el);
    assert.deepEqual(Array.from(el.children).map(e => e.textContent), ["公开", "a", "公开 2", "b"]);
});

test("带括号标题的图片行仍识别为图片块并编号", () => {
    const idx = M.getSourceIndex('![音频](media/a.mp3 "(MP3 格式)")\n\n![图](a.png)', opts);
    assert.deepEqual(idx.blocks.map(b => [b.type, b.caption?.kind, b.caption?.num]), [["image", "media", "1"], ["image", "figure", "1"]]);
});

test("页签标题：引用块首行去掉图片、<br> 与行内标记", () => {
    const md = "> ==![](pic/a.svg?fill=text&darksrc=invert#icon2x)<br><br>小标题（左侧风格)的语法==\n> 内容";
    const b = M.getSourceIndex(md, opts).blocks[0];
    assert.equal(M.tabInfo(b).title, "小标题（左侧风格)的语法");
});

test("导航索引覆盖图片题注并排除代码中的伪标题和脚注", () => {
    const source = '# 正文\n\n![壁纸](pic/test.png)\n\n```md\n# 伪标题\n[^fake]: 忽略\n```\n\n[^real]: 真实脚注\n';
    const index = M.getSourceIndex(source, {captionGroup:false, captionNumber:true});
    const items = M.navigationItems(index);
    assert.ok(items.some(i => i.kind === "插图" && i.title.includes("壁纸")));
    assert.ok(items.some(i => i.kind === "脚注" && i.title.includes("真实脚注")));
    assert.ok(!items.some(i => i.title.includes("伪标题") || i.title.includes("忽略")));
});

test("编辑块预览：页签组与题注形成完整、不重叠的替换范围", () => {
    const md = '前言\n\n_^tab^_\n\n*==表==*\n\n| A |\n| - |\n| B |\n\n```js\nalert(1)\n```\n\n# 其他\n\n*==独立题注==*\n\n```js\nalert(2)\n```';
    const index = M.getSourceIndex(md, {captionGroup:false, captionNumber:true});
    const plans = M.blockPreviewPlans(index, M.DEFAULT_SETTINGS);
    assert.equal(plans.length, 2);
    assert.ok(plans[0].blocks[0].tabMarker);
    assert.ok(plans[0].blocks.some(b => b.type === 'table'));
    assert.ok(plans[0].blocks.some(b => b.type === 'code'));
    assert.ok(plans[0].end < plans[1].start);
    assert.equal(plans[1].blocks[0].captionFor !== undefined, true);
});

test('编辑普通代码：无题注代码也预览，选中代码或围栏恢复源码，退出再次预览',()=>{
    const doc='前言\n\n```js\nconst answer = 42;\n```\n\n结尾';
    const index=M.getSourceIndex(doc,{captionGroup:false,captionNumber:true});
    const plans=M.blockPreviewPlans(index,M.DEFAULT_SETTINGS);
    assert.equal(plans.length,1);assert.equal(plans[0].blocks[0].type,'code');
    const field=M.blockPreviewExtension({settings:{...M.DEFAULT_SETTINGS}});
    let state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
    assert.equal(state.field(field).size,1);
    for(const anchor of [doc.indexOf('```'),doc.indexOf('answer'),doc.lastIndexOf('```')]){
        state=state.update({selection:{anchor}}).state;assert.equal(state.field(field).size,0);
        state=state.update({selection:{anchor:doc.length}}).state;assert.equal(state.field(field).size,1);
    }
    const disabled=M.blockPreviewExtension({settings:{...M.DEFAULT_SETTINGS,livePreview:false}});
    const raw=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,disabled]});
    assert.equal(raw.field(disabled).size,0);
});

test('编辑无题注代码 Widget 复用宿主高亮，换行及长代码折叠可操作',async()=>{
    const original=M.MarkdownRenderer.render;let widget,dom;
    const code=Array.from({length:24},(_,i)=>`const line${i} = ${i};`).join('\n');
    try{
        M.MarkdownRenderer.render=async(_app,_source,el)=>{const pre=document.createElement('pre'),node=document.createElement('code');node.className='language-js';const span=document.createElement('span');span.className='token';span.textContent=code;node.append(span);pre.append(node);el.append(pre);};
        const doc=`前言\n\n\`\`\`js\n${code}\n\`\`\``,field=M.blockPreviewExtension({settings:{...M.DEFAULT_SETTINGS},app:{}});
        const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
        state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)widget=deco.spec.widget;});
        assert.ok(widget);dom=widget.toDOM({requestMeasure(){},dispatch(){},focus(){}});
        await new Promise(resolve=>setTimeout(resolve,0));
        const pre=dom.querySelector('pre');assert.equal(pre.querySelector('code').textContent,code);assert.ok(pre.querySelector('.token'));
        const wrap=Array.from(dom.querySelectorAll('button')).find(b=>b.textContent==='自动换行');assert.ok(wrap);wrap.click();assert.equal(pre.classList.contains('vlook-code-wrap'),false);
        const expand=Array.from(dom.querySelectorAll('button')).find(b=>b.textContent==='展开代码');assert.ok(expand);expand.click();assert.equal(pre.classList.contains('vlook-code-collapsed'),false);
    }finally{if(dom)widget?.destroy(dom);M.MarkdownRenderer.render=original;}
});

test("编辑块预览：选择组内任意位置时恢复整组源码", () => {
    const doc = '前言\n\n_^tab^_\n\n> **甲**\n> 一\n\n> **乙**\n> 二';
    const plugin = {settings:{...M.DEFAULT_SETTINGS}};
    const field = M.blockPreviewExtension(plugin);
    let state = M.EditorState.create({doc, extensions:[M.editorInfoField, M.editorLivePreviewField, field]});
    assert.equal(state.field(field).size, 1);
    state = state.update({selection:{anchor:doc.indexOf('乙')}}).state;
    assert.equal(state.field(field).size, 0);
    state = state.update({selection:{anchor:0}}).state;
    assert.equal(state.field(field).size, 1);
});

test("编辑区块重用 DOM 后仍能清理原渲染组件", async () => {
    const plugin = {settings:{...M.DEFAULT_SETTINGS}, app:{}};
    const field = M.blockPreviewExtension(plugin);
    let state = M.EditorState.create({doc:'前言\n\n> 引用内容', extensions:[M.editorInfoField, M.editorLivePreviewField, field]});
    let widget;
    state.field(field).between(0, state.doc.length, (_a,_b,deco) => {if(deco.spec.widget)widget=deco.spec.widget});
    const dom = widget.toDOM({requestMeasure(){}, dispatch(){}, focus(){}});
    await Promise.resolve();
    const component = M.Component.instances.at(-1);
    assert.equal(component.loaded, true);
    state = state.update({selection:{anchor:1}}).state;
    let reused;
    state.field(field).between(0, state.doc.length, (_a,_b,deco) => {if(deco.spec.widget)reused=deco.spec.widget});
    assert.ok(reused.eq(widget));
    reused.destroy(dom);
    assert.equal(component.loaded, false);
});

test("预览导出保留真实首段，只清除内部注释标记", () => {
    const el = html('<!--vlook-raw-render--><p>第一段必须保留</p><p>第二段</p>');
    M.removeRenderingMarker(el);
    assert.equal(el.querySelector('p').textContent, '第一段必须保留');
    assert.equal(el.querySelectorAll('p').length, 2);
    const empty = html('<p><!--vlook-raw-render--></p><p>正文</p>');
    M.removeRenderingMarker(empty);
    assert.equal(empty.children.length, 1);
    assert.equal(empty.textContent, '正文');
});

test("导出链接：Wiki、同名文件、编码路径和锚点使用真实相对地址", () => {
    const files = {
        '目标': {path:'资料/目标.md', extension:'md'},
        '空 格#问?': {path:'资料/空 格#问?.md', extension:'md'},
    };
    const app = {metadataCache:{getFirstLinkpathDest:(path, from) => {
        assert.equal(from, '笔记/当前.md');
        return files[path] || null;
    }}};
    const el = html('<p><a href="目标" data-href="目标" class="internal-link">文档</a> <a href="空%20格%23问%3F#章节">编码</a> <a href="#本节">锚点</a> <a href="https://example.org/a.md">外链</a></p>');
    M.rewriteExportLinks(el, app, '笔记/当前.md');
    const a = el.querySelectorAll('a');
    assert.equal(a[0].getAttribute('href'), '../%E8%B5%84%E6%96%99/%E7%9B%AE%E6%A0%87.html');
    assert.equal(a[0].hasAttribute('data-href'), false);
    assert.ok(a[1].getAttribute('href').endsWith('%E7%A9%BA%20%E6%A0%BC%23%E9%97%AE%3F.html#章节'));
    assert.equal(a[2].getAttribute('href'), '#本节');
    assert.equal(a[3].getAttribute('href'), 'https://example.org/a.md');
});

test("导出链接：更换导出目录后以实际导出目录为基准", () => {
    const app = {metadataCache:{getFirstLinkpathDest:() => ({path:'资料/目标.md', extension:'md'})}};
    const el = html('<p><a href="目标" class="internal-link">文档</a></p>');
    M.rewriteExportLinks(el, app, '笔记/当前.md', 'html', '输出/子目录');
    assert.equal(el.querySelector('a').getAttribute('href'), '../../%E8%B5%84%E6%96%99/%E7%9B%AE%E6%A0%87.html');
    const root = html('<p><a href="目标">文档</a></p>');
    M.rewriteExportLinks(root, app, '笔记/当前.md', 'html', '');
    assert.equal(root.querySelector('a').getAttribute('href'), '%E8%B5%84%E6%96%99/%E7%9B%AE%E6%A0%87.html');
});

test('任务导出使用当前勾选属性，清除陈旧属性，嵌套任务不借用子复选框',()=>{
    const root=html('<ul class="contains-task-list"><li class="task-list-item is-checked"><input type="checkbox" checked>取消完成</li><li class="task-list-item"><input type="checkbox">已完成</li><li class="task-list-item">父项<ul><li class="task-list-item"><input type="checkbox" checked>子项</li></ul></li></ul>');
    const inputs=root.querySelectorAll('input');inputs[0].checked=false;inputs[1].checked=true;
    M.toTyporaDom(root,true);
    const items=root.querySelectorAll('li');
    assert.equal(items[0].classList.contains('task-list-done'),false);assert.equal(inputs[0].hasAttribute('checked'),false);
    assert.equal(items[1].classList.contains('task-list-done'),true);assert.equal(inputs[1].hasAttribute('checked'),true);
    assert.equal(items[2].classList.contains('task-list-done'),false);assert.equal(items[3].classList.contains('task-list-done'),true);
    assert.equal(inputs[2].closest('li'),items[3]);assert.equal(items[2].querySelector(':scope > p').textContent,'父项');
});

test('部分完成任务经过 HTML 序列化恢复属性，普通复选框不受影响',()=>{
    const root=html('<ul><li class="task-list-item"><input type="checkbox">部分完成</li><li class="task-list-item"><input type="checkbox" checked>完成</li></ul>');
    root.querySelector('input').indeterminate=true;M.toTyporaDom(root,true);
    const saved=html(root.innerHTML);assert.equal(saved.querySelector('input').indeterminate,false);
    M.restoreExportTaskStates(saved);
    assert.equal(saved.querySelector('input').indeterminate,true);assert.equal(saved.querySelectorAll('input')[1].checked,true);
    assert.equal(saved.querySelector('[data-vlook-indeterminate]'),null);
});

test('序列化恢复后的三态任务由原版处理器识别为未完成、已完成、部分完成',async()=>{
    const root=html('<ul><li class="task-list-item"><input type="checkbox">未完成</li><li class="task-list-item"><input type="checkbox" checked>完成</li><li class="task-list-item"><input type="checkbox">部分</li></ul>');
    root.querySelectorAll('input')[2].indeterminate=true;M.toTyporaDom(root,true);
    const saved=html(root.innerHTML);
    // Execute the same self-contained function form used by the exported footer.
    new Function('root',`(${M.restoreExportTaskStates.toString()})(root)`)(saved);
    const original=readFileSync(new URL('../upstream/src/vlook.js',import.meta.url),'utf8').match(/function Restyler_forTaskList\(\) \{[\s\S]*?\n\}/)[0];
    const icons=[],vm=await import('node:vm');
    const wrap=element=>({0:element,po:key=>element[key],bf:icon=>icons.push(icon),rm:()=>element.remove()});
    vm.runInNewContext(original+';Restyler_forTaskList()',{
        $:value=>typeof value==='string'?{e:callback=>saved.querySelectorAll('input').forEach((el,i)=>callback(i,el))}:wrap(value),
        _idWrite_:'#write',___:' ',_input_:'input',_type_:'type',_checkbox_:'checkbox',
        _no_:'no',_yes_:'yes',_un_:'un',_dark_:'dark',_theme_:'theme',_checked_:'checked',gTrue:true,
        _icoChkbox__:'icoChkbox_',_v__:'v-',_svg_:'svg',_:'',
        V_attrCSS:()=>'',V_ui_label:(_type,_text,icon)=>icon,V_ui_svgIcon:id=>id,
    });
    assert.deepEqual(icons,['icoChkbox_no','icoChkbox_yes','icoChkbox_un']);assert.equal(saved.querySelector('input'),null);
});

test('代码导出保留无 code 的 pre 正文及 BR 换行，并从 pre 补取语言',()=>{
    const root=html('<pre class="language-js">第一行\n第二行</pre><pre class="language-html"><code><span class="token tag">&lt;div&gt;<br>&lt;/div&gt;</span></code></pre>');
    M.toTyporaDom(root,true);const fences=root.querySelectorAll(':scope > pre');
    assert.deepEqual(Array.from(fences[0].querySelectorAll('.CodeMirror-line'),el=>el.textContent),['第一行','第二行']);
    assert.equal(fences[0].getAttribute('lang'),'js');assert.equal(fences[1].getAttribute('lang'),'html');
    assert.deepEqual(Array.from(fences[1].querySelectorAll('.CodeMirror-line'),el=>el.textContent),['<div>','</div>']);
    assert.equal(fences[1].querySelectorAll('.cm-tag').length,2);
});

test('代码语言属性通过 DOM 设置，特殊字符不改变导出结构',()=>{
    const root=html('<pre><code>内容</code></pre>'),language='js"data-test="x';
    root.querySelector('code').classList.add('language-'+language);
    M.toTyporaDom(root,true);const fence=root.querySelector('pre'),cm=fence.querySelector('.CodeMirror');
    assert.equal(fence.getAttribute('lang'),language);assert.equal(cm.getAttribute('lang'),language);
    assert.equal(root.querySelector('[data-test]'),null);assert.equal(cm.querySelector('.CodeMirror-line').textContent,'内容');
});

test('Mermaid SVG 的 xlink 链接在预览中可解析，导出同步两个命名空间且保留图形',()=>{
    const root=html('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="目标.md#章节" target="_blank"><rect width="50" height="30"/><text>图表节点</text></a><a xlink:href="https://example.org/"><text>外部</text></a><a xlink:href="#node"><text>本图</text></a></svg>');
    const anchors=root.querySelectorAll('a'),rect=root.querySelector('rect'),ns='http://www.w3.org/1999/xlink';
    M.preservePreviewLinks(root);assert.equal(M.previewLinkHref(anchors[0]),'目标.md#章节');
    const app={metadataCache:{getFirstLinkpathDest:path=>path==='目标.md'?{path:'资料/目标.md',extension:'md'}:null}};
    M.rewriteExportLinks(root,app,'笔记/源.md');
    assert.equal(anchors[0].getAttribute('href'),'../%E8%B5%84%E6%96%99/%E7%9B%AE%E6%A0%87.html#章节');
    assert.equal(anchors[0].getAttributeNS(ns,'href'),anchors[0].getAttribute('href'));
    assert.equal(anchors[0].getAttribute('target'),'_blank');assert.equal(root.querySelector('rect'),rect);
    assert.equal(anchors[1].getAttributeNS(ns,'href'),'https://example.org/');assert.equal(anchors[2].getAttributeNS(ns,'href'),'#node');
    const output=root.innerHTML;M.rewriteExportLinks(root,app,'笔记/源.md');assert.equal(root.innerHTML,output);
});

test("预览链接：原版改写 .html 后仍解析到 Markdown，保留 query/hash", () => {
    const file = {path:'folder/目标.md', extension:'md'};
    const app = {metadataCache:{getFirstLinkpathDest:p=>p === '目标.md' ? file : null}};
    assert.deepEqual(M.resolveVaultLink(app, '目标.html?target=vdl#段落', 'a.md'), {file, query:'?target=vdl', hash:'#段落'});
    assert.equal(M.resolveVaultLink(app, '//example.org/a.md', 'a.md'), null);
    assert.equal(M.resolveVaultLink(app, 'obsidian://open?file=a', 'a.md'), null);
    assert.equal(M.resolveVaultLink(app, '#当前', 'a.md'), null);
});

test("文库绝对地址：仅解析插件生成的 vault 空间，并按库根定位", () => {
    const file = {path:'folder/目标.md', extension:'md'};
    const app = {metadataCache:{getFirstLinkpathDest:(path, source)=>
        path === 'folder/目标.md' && source === '' ? file : null}};
    assert.deepEqual(M.resolveVaultLink(app,
        'app://obsidian.md/__vlook_vault__/folder/%E7%9B%AE%E6%A0%87.html?target=vdl#章节',
        'other/source.md'), {file, query:'?target=vdl', hash:'#章节'});
    assert.equal(M.resolveVaultLink(app, 'app://obsidian.md/other/目标.md', 'a.md'), null);
    assert.equal(M.resolveVaultLink(app, 'https://example.org/__vlook_vault__/folder/目标.md', 'a.md'), null);
});

test("导出链接：遵从单链接 xmd 与全局 off 设置", () => {
    const app = {metadataCache:{getFirstLinkpathDest:()=>({path:'target.md', extension:'md'})}};
    const el = html('<a href="target.md?xmd=php#x">一</a><a href="target.md">二</a>');
    M.rewriteExportLinks(el, app, 'source.md', 'off');
    assert.equal(el.children[0].getAttribute('href'), 'target.md?xmd=php#x');
    assert.equal(el.children[1].getAttribute('href'), 'target.md');
    M.rewriteExportLinks(el, app, 'source.md', 'html');
    assert.equal(el.children[0].getAttribute('href'), 'target.php?xmd=php#x');
    assert.equal(el.children[1].getAttribute('href'), 'target.html');
});

test("题注分组遵循原版最近 h1～h5 编号，YAML 优先于主题默认值", () => {
    const md = '---\nvlook-query: capgroup=on\nvlook-header-autonum: h1{{###. }},h2{{### }}\n---\n\n# 一\n\n## 甲\n\n| A |\n| - |\n| 1 |\n\n## 乙\n\n| B |\n| - |\n| 2 |\n';
    const index = M.getSourceIndex(md, {captionGroup:false, captionNumber:true, headerTemplate:'h1{{第#zh#章 }}'});
    assert.deepEqual(index.blocks.filter(b=>b.type === 'table').map(b=>b.caption.num), ['1.1-1','1.2-1']);
    const disabled = M.getSourceIndex(md, {captionGroup:true, captionNumber:true, headerEnabled:false});
    assert.deepEqual(disabled.blocks.filter(b=>b.type === 'table').map(b=>b.caption.num), ['1','2']);
});

test("无显式 TOC 的预览/导出也生成导航数据，且保留封面首位置", () => {
    const el = html('<h6>封面</h6><p>首段保留</p><h1>正文</h1><p>内容</p>');
    M.toTyporaDom(el, true);
    assert.equal(el.firstElementChild.tagName, 'H6');
    assert.ok(el.querySelector('.md-toc[data-vlook-auto-toc]'));
    assert.equal(el.querySelectorAll('.md-toc-inner').length, 2);
    assert.ok(el.textContent.includes('首段保留'));
    M.toTyporaDom(el, true);
    assert.equal(el.querySelectorAll('.md-toc').length, 1);
});

test('文库子文档：运行时删除或改写 href 后仍能恢复源链接', () => {
    const root = html('<a href="目标.html?target=vdl#章节">文库</a><a href="Wiki" data-href="folder/真实.md#章节">Wiki</a><a href="#本节">锚点</a>');
    M.preservePreviewLinks(root);
    const [library, wiki, hash] = root.querySelectorAll('a');
    library.removeAttribute('href'); // DocLib.init(vdl=off) 的实际行为
    wiki.setAttribute('href', 'about:srcdoc');
    assert.equal(M.previewLinkHref(library), '目标.html?target=vdl#章节');
    assert.equal(M.previewLinkHref(wiki), 'folder/真实.md#章节');
    assert.equal(M.previewLinkHref(hash), '#本节');
    const file = {path:'目标.md', extension:'md'};
    assert.equal(M.resolveVaultLink({metadataCache:{getFirstLinkpathDest:p=>p === '目标.md' ? file : null}}, M.previewLinkHref(library), '源.md').file, file);
});

test('原生文库：兼容原版多链接、标题中的逗号、裸地址及 YAML 列表', () => {
    assert.deepEqual(M.documentLibraryItems('[手册](guide.html "查询, 入门"),[图表](guide2.html#类型),https://example.org'), [
        {title:'手册', href:'guide.html', description:'查询, 入门'},
        {title:'图表', href:'guide2.html#类型', description:''},
        {title:'https://example.org', href:'https://example.org', description:''},
    ]);
    assert.deepEqual(M.documentLibraryItems(['[](guide.html "==默认名称==")', '[括号](folder/a(b).html)']), [
        {title:'默认名称', href:'guide.html', description:'==默认名称=='},
        {title:'括号', href:'folder/a(b).html', description:''},
    ]);
    assert.deepEqual(M.documentLibraryItems(undefined), []);
});

test('全文内容索引：跨越未挂载区块，保留类型、题注和源行位置', () => {
    const source = '# 文档\n\n*==第一张表==*\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n' + ('普通段落\n\n'.repeat(300)) + '*==远端代码==*\n\n```javascript\nconsole.log(1);\n```\n\n![图片](a.png)\n\n![声音](a.mp3?controls=mini)\n\n$$\nx=1\n$$';
    const index = M.getSourceIndex(source, {captionGroup:false, captionNumber:true});
    const items = M.sourceContentItems(index);
    assert.deepEqual(items.map(item=>item.kind), ['表格','代码','插图','多媒体','公式']);
    assert.equal(items[0].title, '第一张表');
    assert.equal(items[1].title, '远端代码');
    assert.ok(items[1].block.start > 600);
    assert.equal(items[1].block.text.includes('console.log(1)'), true);
});

test('全文媒体分类：Wiki 与 OGV/M4V 参数地址一致，代码示例与笔记嵌入不误分类', () => {
    const source='![[声音.ogg|配乐]]\n\n![视频](clip.m4v?pause=3#400w)\n\n![[clip.ogv]]\n\n![[note.md]]\n\n`![示例](x.mp3)`\n\n```md\n![语法示例](sample.mp3)\n```\n\n<img src="logo.png" alt="标志">';
    const index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true});
    const items=M.sourceContentItems(index);
    assert.deepEqual(items.map(item=>item.kind),['多媒体','多媒体','多媒体','代码','插图']);
    assert.equal(items[0].title,'配乐');
    assert.equal(items.at(-1).title,'标志');
});

test('引用式图片块：跨区块定义的图片和音频进入各自题注编号', () => {
    const index=M.getSourceIndex('![插图][picture]\n\n![声音][audio]\n\n[picture]: image.png\n[audio]: song.mp3',{captionGroup:false,captionNumber:true});
    assert.equal(index.blocks[0].type,'image');
    assert.equal(index.blocks[0].caption.kind,'figure');
    assert.equal(index.blocks[1].caption.kind,'media');
    assert.equal(index.blocks[1].caption.num,'1');
});

test('编辑引用图片：独立渲染区块携带全文引用定义', async () => {
    const original=M.MarkdownRenderer.render;const rendered=[];
    M.MarkdownRenderer.render=async(_app,source,el)=>{rendered.push(source);el.textContent='已渲染';};
    let widget,dom;
    try {
        const plugin={settings:{...M.DEFAULT_SETTINGS},app:{}};
        const doc='前言\n\n![引用][picture]\n\n[picture]: pic/image.png#200w "题注"';
        const field=M.blockPreviewExtension(plugin);
        const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
        state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)widget=deco.spec.widget});
        assert.ok(widget);
        dom=widget.toDOM({requestMeasure(){},dispatch(){},focus(){}});
        await new Promise(resolve=>setTimeout(resolve,0));
        assert.ok(rendered[0].includes('![引用][picture]'));
        assert.ok(rendered[0].includes('[picture]: pic/image.png#200w "题注"'));
    } finally {if(dom)widget.destroy(dom);M.MarkdownRenderer.render=original;}
});

test('段落漫游：全文行号包含列表项和引用段落，排除元数据、题注及引用定义', () => {
    const source='---\ntitle: 测试\n---\n\n# 标题\n\n正文\n\n- 第一项\n- 第二项\n\n> 引用甲\n>\n> 引用乙\n\n*==代码题注==*\n\n```js\nconsole.log(1);\n```\n\n[picture]: image.png';
    const index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true});
    const lines=M.roamingLines(index);
    const text=source.split('\n');
    assert.deepEqual(lines.map(line=>text[line]),['# 标题','正文','- 第一项','- 第二项','> 引用甲','> 引用乙','```js']);
    assert.equal(M.roamingStep({shiftKey:false,metaKey:false,ctrlKey:false,altKey:false}),1);
    assert.equal(M.roamingStep({shiftKey:false,metaKey:true,ctrlKey:false,altKey:false}),5);
    assert.equal(M.roamingStep({shiftKey:true,metaKey:true,ctrlKey:false,altKey:false}),10);
    assert.equal(M.roamingStep({shiftKey:false,metaKey:false,ctrlKey:false,altKey:true}),0);
});

test('阅读进度：短文档完整可见、弹性滚动边界、无效尺寸', () => {
    assert.equal(M.readingPercent(0,500,500),100);
    assert.equal(M.readingPercent(500,1500,500),50);
    assert.equal(M.readingPercent(-20,1500,500),0);
    assert.equal(M.readingPercent(1020,1500,500),100);
    assert.equal(M.readingPercent(0,1500,0),0);
    assert.equal(M.readingPercent(NaN,1500,500),0);
});

test('不发布：原版分号与正则、重复全局正则、引用小标题及章节范围', () => {
    const match=M.unpublishedMatcher('内部;/^草稿/g; /[invalid/');
    assert.equal(match('内部'),true);assert.equal(match('草稿甲'),true);assert.equal(match('草稿甲'),true);
    assert.equal(match('公开'),false);
    const root=html('<h1>公开</h1><p>保留</p><h2>内部</h2><p>隐藏正文</p><h3>子章</h3><p>子章正文</p><h2>恢复</h2><p>恢复正文</p><blockquote><p><strong><del>秘密引用</del></strong></p><p>秘密引用正文</p></blockquote><blockquote><h6>草稿引用</h6><p>不公开内容</p></blockquote>');
    M.removeUnpublished(root,'内部;/^草稿/');
    assert.ok(root.textContent.includes('保留'));assert.ok(root.textContent.includes('恢复正文'));
    assert.equal(/隐藏正文|子章正文|秘密引用|不公开内容/.test(root.textContent),false);
    const index=M.getSourceIndex('---\nvlook-unpub: 内部;草稿\n---\n\n# 内部\n\n隐藏\n\n# 草稿\n\n隐藏2\n\n# 公开',{captionGroup:false,captionNumber:true});
    assert.equal(index.blocks.find(b=>b.text==='# 内部').unpub,true);
    assert.equal(index.blocks.find(b=>b.text==='# 草稿').unpub,true);
    const off=M.getSourceIndex('---\nvlook-query: unpub=off\n---\n\n# ~~草稿~~\n\n保留',{captionGroup:false,captionNumber:true});
    assert.ok(off.blocks.every(b=>!b.unpub));
});

test('不发布表格列：导出正文静态移除删除线列，跨公开列的合并单元格缩短跨度', () => {
    const root=html('<table><thead><tr><th>公开</th><th><del>内部</del></th><th>说明</th></tr></thead><tbody><tr><td>A</td><td>秘密单元格</td><td>B</td></tr><tr><td colspan="3">跨列公开说明</td></tr></tbody></table>');
    M.removeUnpublished(root);
    assert.equal(root.textContent.includes('秘密单元格'),false);
    assert.equal(root.querySelectorAll('th').length,2);
    assert.equal(root.querySelector('[colspan]').getAttribute('colspan'),'2');
});

test('静态不发布列对齐原版首元素规则，嵌套表格分别删除各自私有列',()=>{
    const root=html('<table id="outer"><thead><tr><th><span>公开标题</span><del>旧备注</del></th><th><del>外私有</del></th></tr></thead><tbody><tr><td>外公开<table id="inner"><thead><tr><th>内公开</th><th><del>内私有</del></th></tr></thead><tbody><tr><td>保留内数据</td><td>删除内数据</td></tr></tbody></table></td><td>删除外数据</td></tr></tbody></table>');
    M.removeUnpublished(root);const outer=root.querySelector('#outer'),inner=root.querySelector('#inner');
    assert.ok(inner);assert.ok(root.textContent.includes('公开标题旧备注'));assert.ok(root.textContent.includes('外公开'));assert.ok(root.textContent.includes('保留内数据'));
    assert.equal(root.textContent.includes('删除外数据'),false);assert.equal(root.textContent.includes('删除内数据'),false);
    assert.equal(outer.tHead.rows[0].cells.length,1);assert.equal(inner.tHead.rows[0].cells.length,1);
});

test("不发布淡化遵从主题开关并清理旧状态", () => {
    const section=html('<section></section>').firstElementChild;
    const context={block:{unpub:true},query:new M.Query('')};
    M.processUnpublished(section,context);
    assert.equal(section.classList.contains('vlook-unpub'),true);
    M.processUnpublished(section,{...context,query:new M.Query('unpub=off')});
    assert.equal(section.classList.contains('vlook-unpub'),false);
    M.processUnpublished(section,context);
    M.processUnpublished(section,{...context,block:{}});
    assert.equal(section.classList.contains('vlook-unpub'),false);
});

test("不发布章节：直接部分删除线与嵌套代码、链接、强调保持原版边界", () => {
    for(const title of ['前 ~~内部~~ 后','~~**内部加粗**~~','~~内部~~'])
        assert.equal(M.hasDirectStrike(title),true,title);
    for(const title of ['`~~代码~~`','**~~强调内~~**','[~~链接内~~](note.md)','\\~~转义~~','~~ 未闭合','普通标题'])
        assert.equal(M.hasDirectStrike(title),false,title);
    const source='# 前 ~~内部~~ 后\n\n隐藏正文\n\n## 子章节\n\n隐藏子正文\n\n# `~~示例~~`\n\n公开正文';
    const index=M.getSourceIndex(source,opts);
    assert.equal(index.blocks.find(b=>b.text==='隐藏正文').unpub,true);
    assert.equal(index.blocks.find(b=>b.text==='隐藏子正文').unpub,true);
    assert.ok(!index.blocks.find(b=>b.text==='公开正文').unpub);
});

test("不发布关闭：目录恢复主题关闭开关下的章节", () => {
    const index=M.getSourceIndex('# 公开\n\n## ~~内部~~\n\n内部正文',opts);
    const context={index,query:new M.Query(''),app:null,sourcePath:'test.md'};
    const active=html('<p>[TOC]</p>');
    M.processToc(active,context);
    assert.equal(active.querySelectorAll('a').length,1);
    const off=html('<p>[TOC]</p>');
    M.processToc(off,{...context,query:new M.Query('unpub=off')});
    assert.equal(off.querySelectorAll('a').length,2);
    assert.match(off.textContent,/内部/);
});

test("标题目录：代码字面符号、多反引号及强调内代码不丢失", () => {
    for(const [src,expected] of [
        ['# `~~代码~~`','~~代码~~'],
        ['# **`a_b*~~`** 后','a_b*~~ 后'],
        ['# `` `literal` ``','`literal`'],
        ['# `[label](target)`','[label](target)'],
        ['# `VLOOKCODE0END` 与 `==x==`','VLOOKCODE0END 与 ==x=='],
        ['# ~~内部~~ **加粗**','内部 加粗'],
        ['多行\n标题\n===','多行 标题'],
    ]) assert.equal(M.headingPlain(src),expected,src);
    const opened=[];
    const index=M.getSourceIndex('# `~~代码~~`',opts);
    const root=html('<p>[TOC]</p>');
    M.processToc(root,{index,query:new M.Query(''),sourcePath:'test.md',app:{workspace:{openLinkText(...args){opened.push(args)}}}});
    root.querySelector('a').click();
    assert.equal(root.querySelector('a').textContent,'~~代码~~');
    assert.equal(opened[0][0],'test.md');
    assert.deepEqual(opened[0][3],{eState:{line:0}});
});

test("不发布 Setext：精确 YAML 标题与部分删除线均控制子章节范围", () => {
    const source='---\nvlook-unpub: 内部标题\n---\n\n内部标题\n===\n\n内部内容\n\n公开标题\n===\n\n公开内容\n\n部分 ~~草稿~~ 标题\n---\n\n草稿内容\n\n恢复\n---\n\n恢复内容';
    const index=M.getSourceIndex(source,opts);
    for(const text of ['内部内容','草稿内容'])assert.equal(index.blocks.find(b=>b.text===text).unpub,true,text);
    for(const text of ['公开内容','恢复内容'])assert.ok(!index.blocks.find(b=>b.text===text).unpub,text);
});

test("编辑不发布：正文与 Setext 两行均提示，替换块不重复装饰，同级恢复", () => {
    const doc='# 部分 ~~内部~~\n\n内部正文\n第二行\n\n> 引用正文\n\n公开\n===\n\n公开正文';
    const plugin={settings:{...M.DEFAULT_SETTINGS}};
    const field=M.blockPreviewExtension(plugin);
    let state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
    const hidden=[];state.field(field).between(0,doc.length,(from,to,deco)=>{if(deco.spec.attributes?.class==='vlook-unpub')hidden.push(state.doc.lineAt(from).text)});
    assert.ok(hidden.includes('内部正文'));assert.ok(hidden.includes('第二行'));
    assert.ok(!hidden.includes('> 引用正文'));assert.ok(!hidden.includes('公开正文'));
    state=state.update({selection:{anchor:doc.indexOf('引用正文')}}).state;
    let marked=false;state.field(field).between(0,doc.length,(from,to,deco)=>{if(state.doc.lineAt(from).text==='> 引用正文'&&deco.spec.attributes?.class==='vlook-unpub')marked=true});
    assert.ok(marked);
    const off='---\nvlook-query: unpub=off\n---\n\n# ~~内部~~\n\n正文';
    state=M.EditorState.create({doc:off,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
    state.field(field).between(0,off.length,(_from,_to,deco)=>assert.notEqual(deco.spec.attributes?.class,'vlook-unpub'));
});

test("不发布 YAML：按渲染后标题匹配加粗、链接与代码字面文本", () => {
    const source='---\nvlook-unpub: 内部标题;~~字面代码~~\n---\n\n# **内部标题**\n\n加粗内部\n\n# [内部标题](note.md)\n\n链接内部\n\n# `~~字面代码~~`\n\n代码匹配内部\n\n# 公开\n\n公开正文';
    const index=M.getSourceIndex(source,opts);
    for(const text of ['加粗内部','链接内部','代码匹配内部'])assert.equal(index.blocks.find(b=>b.text===text).unpub,true,text);
    assert.ok(!index.blocks.find(b=>b.text==='公开正文').unpub);
});

test("标题显示文字：字面标点、嵌套链接、实体和 HTML 与实际格式区分", () => {
    for(const [source,expected] of [
        ['# snake_case 与 foo__bar','snake_case 与 foo__bar'],
        ['# 未闭合 * 与 ~~ 与 ==','未闭合 * 与 ~~ 与 =='],
        ['# [**链接** `a_b`](a_(b) "题目") 后','链接 a_b 后'],
        ['# <b>HTML</b> &amp; &#35;','HTML & #'],
        ['# <https://example.com/a_b>','https://example.com/a_b'],
        ['# ==高亮 **加粗**== 和 `==字面==`','高亮 加粗 和 ==字面=='],
        ['# \\*字面星号\\*','*字面星号*'],
    ]) assert.equal(M.headingPlain(source),expected,source);
    const index=M.getSourceIndex('---\nvlook-unpub: snake_case\n---\n\n# snake_case\n\n应匹配\n\n# snakecase\n\n应保留',opts);
    assert.equal(index.blocks.find(b=>b.text==='应匹配').unpub,true);
    assert.ok(!index.blocks.find(b=>b.text==='应保留').unpub);
});


test("原生目录定位：重复标题和含 # 标题按各自源码行跳转", () => {
    const index=M.getSourceIndex('# 重复\n\n正文\n\n# HTML & &#35;\n\n正文\n\n# 重复\n\n结尾正文',opts);
    const calls=[];
    const root=html('<p>[TOC]</p>');
    M.processToc(root,{index,query:new M.Query(''),sourcePath:'folder/doc.md',app:{workspace:{openLinkText(...args){calls.push(args)}}}});
    const anchors=root.querySelectorAll('a');
    anchors[2].click();anchors[1].dispatchEvent(new window.MouseEvent('click',{bubbles:true,ctrlKey:true}));
    assert.deepEqual(calls[0],['folder/doc.md','',false,{eState:{line:8}}]);
    assert.deepEqual(calls[1],['folder/doc.md','',true,{eState:{line:4}}]);
    assert.equal(anchors[1].getAttribute('href'),'#HTML%20%26%20%23');
});

test("图表导出：SVG 外样式、选择器类、无障碍标签与内部定义完整保留", () => {
    const root=html('<div class="mermaid chart-theme" role="img" aria-label="原版流程图"><style>.chart-theme .node{fill:blue}</style><svg viewBox="0 0 200 100" aria-labelledby="chart-title"><title id="chart-title">流程图</title><defs><marker id="arrow"><path d="M0 0L5 5"/></marker></defs><style>.edge{stroke:red}</style><path class="edge" marker-end="url(#arrow)" d="M0 0L100 50"/><foreignObject width="100" height="30"><div xmlns="http://www.w3.org/1999/xhtml">节点文字</div></foreignObject></svg></div>');
    M.toTyporaDom(root,true);
    const panel=root.querySelector('.md-diagram-panel');
    assert.ok(panel.classList.contains('chart-theme'));
    assert.equal(panel.getAttribute('aria-label'),'原版流程图');
    assert.equal(panel.querySelectorAll('style').length,2);
    assert.equal(panel.querySelector('svg').getAttribute('viewBox'),'0 0 200 100');
    assert.ok(panel.querySelector('marker#arrow'));
    assert.equal(panel.querySelector('.edge').getAttribute('marker-end'),'url(#arrow)');
    assert.match(panel.querySelector('foreignObject').textContent,/节点文字/);
});

test("图表就绪：等待全部异步 SVG，未渲染代码和错误图不能成功", async () => {
    const root=html('<div class="mermaid"></div><pre><code class="language-mermaid">graph TD; A-->B</code></pre>');
    let resolved=false;
    const ready=M.waitForDiagrams(root,500,5).then(()=>{resolved=true});
    root.firstElementChild.innerHTML='<svg><g><text>第一图</text></g></svg>';
    await new Promise(resolve=>window.setTimeout(resolve,15));
    assert.equal(resolved,false);
    root.querySelector('pre').outerHTML='<div class="mermaid"><svg><g><text>第二图</text></g></svg></div>';
    await ready;assert.equal(resolved,true);
    await assert.rejects(M.waitForDiagrams(html('<div class="mermaid"><svg><text class="error-text">Syntax error in text</text></svg></div>'),100,1),/渲染失败/);
    await assert.rejects(M.waitForDiagrams(html('<pre><code class="language-mermaid">radar-beta</code></pre>'),20,1),/1 个未完成/);
    await M.waitForDiagrams(html('<p>无图表</p>'),20,1);
});

test('Pele 错误容器不能带着旧 SVG 被当成可导出图表',async()=>{
    const root=html('<div class="mermaid"><div class="pele pele-error">No diagram type detected<svg><text>旧结果</text></svg></div></div>');
    await assert.rejects(M.waitForDiagrams(root,100,1),/渲染失败/);
    const pending=html('<div class="mermaid"></div>');
    const ready=M.waitForDiagrams(pending,500,1);
    pending.firstElementChild.innerHTML='<div class="pele pele-error">Parse error</div>';
    await assert.rejects(ready,/渲染失败/);
});

test("图表容器：pre Mermaid 不被普通代码转换清空，重复转换不嵌套或丢图", () => {
    for(const source of [
        '<pre class="mermaid"><svg id="mermaid-pre" viewBox="0 0 10 10"><g><text>图表节点</text></g></svg></pre>',
        '<pre><div class="mermaid"><svg id="mermaid-inner"><g><text>图表节点</text></g></svg></div></pre>',
    ]) {
        const root=html(source);
        M.toTyporaDom(root,true);
        assert.equal(root.querySelectorAll('svg').length,1);
        assert.match(root.querySelector('svg').textContent,/图表节点/);
        M.toTyporaDom(root,true);
        assert.equal(root.querySelectorAll('svg').length,1);
        assert.equal(root.querySelectorAll('.md-diagram-panel').length,1);
        assert.match(root.querySelector('svg').textContent,/图表节点/);
    }
});

test("完整文档目录：重复标题 ID 唯一，保留自然后缀、其他元素 ID 和原版片段值", () => {
    const root=html('<p>[TOC]</p><h1>重复</h1><p>甲</p><h1>重复</h1><p>乙</p><h1>重复-2</h1><p>丙</p><div id="重复-3">已有锚点</div><h2>HTML &amp; #</h2><p>丁</p>');
    M.toTyporaDom(root,true);
    const heads=Array.from(root.querySelectorAll('h1,h2'));
    assert.deepEqual(heads.map(h=>h.id),['重复','重复-4','重复-2','HTML & #']);
    const links=root.querySelectorAll('.md-toc-inner');
    links.forEach((a,i)=>assert.equal(decodeURIComponent(a.getAttribute('href').slice(1)),heads[i].id));
    assert.equal(links[3].getAttribute('href'),'#HTML & #');
    const ids=Array.from(root.querySelectorAll('[id]'),el=>el.id);
    assert.equal(new Set(ids).size,ids.length);
});


test("原版不发布目录契约：非 ASCII 标题的 href 原值与标题 ID 精确一致", () => {
    const root=html('<p>[TOC]</p><h1><del>内部章节</del></h1><p>内部正文</p><h1>公开章节</h1><p>公开正文</p>');
    M.toTyporaDom(root,true);
    for(const h of root.querySelectorAll('h1')) {
        const exact=Array.from(root.querySelectorAll('.md-toc-inner')).filter(a=>a.getAttribute('href')==='#'+h.id);
        assert.equal(exact.length,1,h.id);
    }
});

test("脚注导出：保留原锚点并建立原版弹层 name 配对，不把嵌套列表当新脚注", () => {
    const root=html('<h1>公开</h1><p>正文<sup class="footnote-ref"><a id="fnref-1" href="#fn-1">1</a></sup>重复<sup class="footnote-ref"><a href="#fn-1">1</a></sup></p><h2><del>内部</del></h2><p>内部正文</p><section class="footnotes"><ol><li id="fn-1"><p>公开脚注<a class="footnote-backref" href="#fnref-1">回</a></p><ul><li>脚注嵌套列表</li></ul></li></ol></section>');
    M.toTyporaDom(root,true);
    assert.equal(root.querySelectorAll('.footnote-line').length,1);
    assert.equal(root.querySelectorAll('sup a[name="ref-footnote-1"]').length,2);
    const definition=root.querySelector('a[name="dfref-footnote-1"]');
    assert.equal(definition.parentElement.id,'fn-1');
    assert.equal(root.querySelectorAll('.footnote-backref').length,0);
    M.removeUnpublished(root);
    assert.match(root.querySelector('.footnotes-area').textContent,/公开脚注/);
    assert.match(root.querySelector('.footnotes-area ul').textContent,/脚注嵌套列表/);
    assert.ok(!root.textContent.includes('内部正文'));
});

test("不发布原始 HTML：只认直接删除线节点，嵌套、代码和转义保持公开", () => {
    for(const title of ['前 <del>内部</del> 后','<DEL class="draft">内部</DEL>','<s>内部</s>','<br><del>内部</del>'])
        assert.equal(M.hasDirectStrike(title),true,title);
    for(const title of ['<span><del>内部</del></span>','<span>~~内部~~</span>','`<del>代码</del>`','\\<del>转义\\</del>','**<del>强调内</del>**','<script>~~示例~~</script>'])
        assert.equal(M.hasDirectStrike(title),false,title);
    const index=M.getSourceIndex('# 部分 <del>内部</del> 标题\n\n内部正文\n\n# <span><del>嵌套</del></span>\n\n公开正文',opts);
    assert.equal(index.blocks.find(b=>b.text==='内部正文').unpub,true);
    assert.ok(!index.blocks.find(b=>b.text==='公开正文').unpub);
});

test("文内导航历史：回退前进、新分支截断、重复位置去重和容量限制", () => {
    const history=new M.LineHistory();
    history.push(0,10);history.push(10,20);
    assert.equal(history.move(-1),10);assert.equal(history.move(-1),0);
    assert.equal(history.move(-1),undefined);assert.equal(history.move(1),10);
    history.push(10,30);assert.equal(history.move(1),undefined);
    assert.deepEqual(history.entries().map(item=>item.line),[0,10,30]);
    history.push(30,30);assert.equal(history.entries().length,3);
    assert.equal(history.select(0),0);assert.equal(history.select(999),undefined);
    for(let i=0;i<250;i++)history.push(i,i+1);
    assert.equal(history.entries().length,200);
    assert.equal(history.entries().at(-1).line,250);
});

test("文内历史集成：命令回退前进、文件夹重命名迁移、修改删除卸载清理", () => {
    const commands=new Map(),events=new Map(),cleanups=[];
    let cursor=5;const applied=[];
    const app={workspace:{getActiveViewOfType(){return view}},vault:{on(name,fn){events.set(name,fn);return {}}}};
    const view={app,file:{path:'folder/doc.md'},getMode:()=> 'source',setEphemeralState(state){applied.push(state.line)},editor:{getCursor:()=>({line:cursor}),lineCount:()=>101,getLine:line=>'行'+line,setCursor(pos){cursor=pos.line},scrollIntoView(){}}};
    const plugin={app,addCommand(command){commands.set(command.id,command.callback)},registerEvent(){},register(fn){cleanups.push(fn)}};
    M.registerNavigationHistory(plugin);
    M.navigateViewLine(view,40);M.navigateViewLine(view,80);
    commands.get('history-back')();assert.equal(cursor,40);
    commands.get('history-back')();assert.equal(cursor,5);
    commands.get('history-forward')();assert.equal(cursor,40);
    events.get('rename')({path:'renamed'},'folder');view.file.path='renamed/doc.md';
    commands.get('history-forward')();assert.equal(cursor,80);
    events.get('modify')(view.file);const count=applied.length;
    commands.get('history-back')();assert.equal(applied.length,count);
    M.navigateViewLine(view,20);events.get('delete')({path:'renamed'});
    commands.get('history-back')();assert.equal(cursor,20);
    M.navigateViewLine(view,30);cleanups.forEach(fn=>fn());
    commands.get('history-back')();assert.equal(cursor,30);
});

test("目录旧 DOM：点击按最新源码重算第二处同名标题，删除目标不跳旧行", () => {
    const original='# 同名\n\n甲\n\n# 同名\n\n乙';
    const calls=[];let current='新增\n\n'+original,cursor=0;
    const app={workspace:{getActiveViewOfType(){return view},openLinkText(...args){calls.push(args)}}};
    const view={app,file:{path:'test.md'},getMode:()=> 'source',editor:{getValue:()=>current,getCursor:()=>({line:cursor})}};
    const root=html('<p>[TOC]</p>');
    M.processToc(root,{index:M.getSourceIndex(original,opts),query:new M.Query(''),sourcePath:'test.md',app,cssVar:()=>''});
    root.querySelectorAll('a')[1].click();
    assert.equal(calls[0][3].eState.line,6);
    current='# 只剩其他章节\n\n正文';
    root.querySelectorAll('a')[1].click();
    assert.equal(calls.length,1);
});

test("分屏目录定位：按包含目录的窗格重算源码与跳转，不误用活动窗格", () => {
    const section=html('<p>[TOC]</p>'),container=html('<div></div>');container.append(section);
    const applied=[],opens=[];let cursor=4;
    const own={file:{path:'test.md'},contentEl:container,getMode:()=> 'source',setEphemeralState(state){applied.push(state.line)},editor:{getValue:()=> '新增\n\n# 目标\n\n正文',getCursor:()=>({line:cursor}),lineCount:()=>5,setCursor(pos){cursor=pos.line},scrollIntoView(){}}};
    const other={file:{path:'test.md'},contentEl:html('<p>其他窗格</p>'),getMode:()=> 'source',editor:{getValue:()=> '# 不同内容\n\n正文'}};
    const app={workspace:{getLeavesOfType:()=>[{view:other},{view:own}],getActiveViewOfType:()=>other,openLinkText(...args){opens.push(args)}}};own.app=app;
    M.processToc(section,{index:M.getSourceIndex('# 目标\n\n正文',opts),query:new M.Query(''),sourcePath:'test.md',app,cssVar:()=>''});
    section.querySelector('a').click();
    assert.deepEqual(applied,[2]);assert.equal(cursor,2);assert.equal(opens.length,0);
});

test("继续阅读位置：未变化源码可恢复，修改内容、越界与非法记录拒绝", () => {
    const source='第一行\n第二行\n第三行';
    const entry={line:1,signature:M.readingSignature(source),updated:1};
    assert.equal(M.resumeLine(entry,source),1);
    assert.equal(M.resumeLine(entry,source.replace('第二','修改')),undefined);
    for(const line of [-1,3,1.5,NaN])assert.equal(M.resumeLine({...entry,line},source),undefined);
    assert.equal(M.resumeLine(null,source),undefined);
});

test("继续阅读集成：保存深处阅读位置、恢复命令与清除后卸载不重存", async () => {
    const content=html('<div class="markdown-preview-view"><div data-vlook-source-line="2">目标</div></div>');
    const scroller=content.querySelector('.markdown-preview-view'),block=content.querySelector('[data-vlook-source-line]');
    scroller.scrollTop=1200;scroller.getBoundingClientRect=()=>({top:0});
    block.getBoundingClientRect=()=>({top:10,bottom:40,height:30});
    const events=new Map(),commands=new Map(),cleanups=[],saved=[],applied=[];
    const source='甲\n乙\n目标\n结束';
    const app={workspace:{getActiveViewOfType:()=>view,getActiveFile:()=>view.file,on(name,fn){events.set(name,fn);return {}},onLayoutReady(fn){fn()}},vault:{on(name,fn){events.set(name,fn);return {}}}};
    const view={app,file:{path:'doc.md'},contentEl:content,getMode:()=> 'preview',setEphemeralState(state){applied.push(state.line)},editor:{getValue:()=>source,lineCount:()=>4}};
    const plugin={app,settings:{},saveData(data){saved.push(JSON.parse(JSON.stringify(data)));return Promise.resolve()},addCommand(cmd){commands.set(cmd.id,cmd.callback)},registerEvent(){},register(fn){cleanups.push(fn)}};
    new M.ResumeReading(plugin).register();
    events.get('active-leaf-change')();
    cleanups[0]();await Promise.resolve();await Promise.resolve();
    assert.equal(plugin.settings.readingPositions['doc.md'].line,2);
    commands.get('resume-reading')();assert.deepEqual(applied,[2]);
    assert.ok(saved.length);
    const second=new M.ResumeReading(plugin);second.register();
    commands.get('forget-reading-position')();cleanups.at(-1)();
    assert.equal(plugin.settings.readingPositions['doc.md'],undefined);
});

test("阅读位置切换时序：滚动快照不串到复用视图的新文件，未写入前重命名仍迁移", async () => {
    const content=html('<div class="markdown-preview-view"><div data-vlook-source-line="2">目标</div></div>');
    const scroller=content.querySelector('.markdown-preview-view'),block=content.querySelector('[data-vlook-source-line]');
    block.dataset.vlookSourcePath='old/doc.md';scroller.scrollTop=1200;scroller.getBoundingClientRect=()=>({top:0});block.getBoundingClientRect=()=>({top:10,bottom:40,height:30});
    const events=new Map(),cleanups=[];let source='甲\n乙\n目标\n结束';
    const app={workspace:{getActiveViewOfType:()=>view,on(name,fn){events.set(name,fn);return {}},onLayoutReady(fn){fn()}},vault:{on(name,fn){events.set(name,fn);return {}}}};
    const view={app,file:{path:'old/doc.md'},contentEl:content,getMode:()=> 'preview',editor:{getValue:()=>source}};
    const plugin={app,settings:{},saveData:async()=>{},addCommand(){},registerEvent(){},register(fn){cleanups.push(fn)}};
    new M.ResumeReading(plugin).register();
    scroller.dispatchEvent(new window.Event('scroll'));
    view.file.path='renamed/doc.md';events.get('rename')({path:'renamed'},'old');
    view.file.path='new.md';source='新1\n新2\n新3\n新4';events.get('file-open')();
    await Promise.resolve();
    assert.equal(plugin.settings.readingPositions['renamed/doc.md'].line,2);
    assert.equal(plugin.settings.readingPositions['old/doc.md'],undefined);
    assert.equal(plugin.settings.readingPositions['new.md'],undefined);
    cleanups.forEach(fn=>fn());
    assert.equal(plugin.settings.readingPositions['new.md'],undefined);
});

test("幻灯片源码分组：封面前言、h1-h5 分卡、h6 留卡、脚注另卡与不发布过滤", () => {
    const source='---\ntitle: 标题\n---\n\n###### 封面\n\n前言\n\n# 第一章\n\n正文\n\n###### 小标题\n\n小正文\n\n## ~~内部章节~~\n\n隐藏正文\n\n## 恢复\n\n恢复正文\n\n[^one]: 脚注一\n\n[^two]: 脚注二';
    const index=M.getSourceIndex(source,opts);
    const groups=M.slideGroups(index);
    assert.deepEqual(groups.map(group=>group.kind),['intro','chapter','chapter','footnotes']);
    assert.deepEqual(groups.map(group=>group.title),['封面与前言','第一章','恢复','脚注']);
    assert.ok(groups[1].blocks.some(block=>block.text==='###### 小标题'));
    assert.equal(groups.at(-1).blocks.length,2);
    assert.ok(groups.every(group=>group.start<=group.end));
    assert.equal(M.slideGroups(index,true).length,5);
    assert.equal(M.slideGroups(M.getSourceIndex('',opts)).length,0);
});

test("原生幻灯片：切页边界、退出恢复和文件夹删除清理", async () => {
    const proto=window.HTMLDialogElement.prototype;
    const oldShow=proto.showModal,oldClose=proto.close;
    proto.showModal=function(){this.open=true};
    proto.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'))};
    const content=html('<button>焦点</button><div class="markdown-preview-view"></div>');document.body.append(content);
    const scroller=content.querySelector('.markdown-preview-view');scroller.scrollTop=400;content.querySelector('button').focus();
    const events=new Map(),removed=[];
    const emitter={on(name,fn){events.set(name,fn);return {name}},offref(ref){removed.push(ref.name)}};
    const view={file:{path:'folder/doc.md'},contentEl:content,getMode:()=> 'preview',editor:{getValue:()=> '# 第一页\n\n正文\n\n# 第二页\n\n末尾'}};
    const app={workspace:{...emitter,getActiveViewOfType:()=>view},vault:{...emitter}};
    const slides=new M.NativeSlides({app,settings:{}});
    try{
        slides.toggle();await new Promise(resolve=>setTimeout(resolve,0));
        const dialog=document.querySelector('.vlook-native-slides');assert.ok(dialog.open);
        const buttons=dialog.querySelectorAll('button');assert.equal(buttons[0].disabled,true);
        buttons[1].click();await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(dropdown(dialog,0).value,'1');assert.equal(buttons[1].disabled,true);
        assert.match(dialog.querySelector('[role=status]').textContent,/2 \/ 2/);
        scroller.scrollTop=999;
        dialog.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        assert.equal(document.querySelector('.vlook-native-slides'),null);assert.equal(scroller.scrollTop,400);
        assert.equal(document.activeElement,content.querySelector('button'));assert.ok(removed.includes('modify'));
        slides.toggle();events.get('delete')({path:'folder'});
        await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(document.querySelector('.vlook-native-slides'),null);
    }finally{slides.close();content.remove();proto.showModal=oldShow;proto.close=oldClose;}
});

test("幻灯片内部链接：标题跨卡、重复目录按源码行和脚注原位回跳", async () => {
    const proto=window.HTMLDialogElement.prototype,oldShow=proto.showModal,oldClose=proto.close,oldRender=M.MarkdownRenderer.render;
    proto.showModal=function(){this.open=true};proto.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'))};
    M.MarkdownRenderer.render=async(_app,source,el)=>{
        const block=source.replace('<!--vlook-raw-render-->\n','').replace(/^<span data-vlook-footnote-seed><\/span>[^\n]*\n\n/,'').split('\n\n')[0];
        if(block==='[TOC]')el.innerHTML='<p>[TOC]</p>';
        else if(block.startsWith('# ')){const h=document.createElement('h1');h.textContent=block.slice(2);el.append(h)}
        else if(block==='链接区')el.innerHTML='<p><a href="#重复">去标题</a><a href="#引用标题">去引用标题</a><a href="#配乐二">去第二媒体</a><sup class="footnote-ref"><a href="#local-two">2</a></sup></p><section class="footnotes"><ol><li id="local-one">首条脚注</li><li id="local-two">脚注</li></ol></section>';
        else if(block.startsWith('[^one]:'))el.innerHTML='<section class="footnotes"><ol><li id="fn-one"><p>首条脚注</p></li><li id="fn-two"><p>脚注<a class="footnote-backref" href="#fnref-one">返回</a></p></li></ol></section>';
        else el.textContent=block;
    };
    const content=html('<div class="markdown-preview-view"></div>');document.body.append(content);
    const source='[TOC]\n\n# 起点\n\n链接区\n\n# 重复\n\n第一处\n\n> **引用标题**\n>\n> 内容\n\n![配乐一](one.mp3) ![配乐二](two.mp3)\n\n# 重复\n\n第二处\n\n[^one]: 脚注\n\n[^two]: 第二条';
    const view={file:{path:'doc.md'},contentEl:content,getMode:()=> 'preview',editor:{getValue:()=>source}};
    const events={on:()=>({}),offref:()=>{}};
    const slides=new M.NativeSlides({app:{workspace:{...events,getActiveViewOfType:()=>view},vault:events},settings:{}});
    const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
    try{
        slides.toggle();await settle();const dialog=document.querySelector('.vlook-native-slides'),select=dropdown(dialog,0);
        const toc=dialog.querySelectorAll('.md-toc-inner');assert.equal(toc.length,3);
        toc[2].click();await settle();assert.equal(select.value,'3');assert.match(dialog.querySelector('.vlook-slide-card').textContent,/第二处/);
        select.value='1';await settle();
        dialog.querySelector('a[href="#配乐二"]').click();await settle();assert.equal(select.value,'2');
        select.value='1';await settle();
        dialog.querySelector('a[href="#引用标题"]').click();await settle();assert.equal(select.value,'2');
        select.value='1';await settle();
        dialog.querySelector('a[href="#重复"]').click();await settle();assert.equal(select.value,'2');
        select.value='1';await settle();
        const body=dialog.querySelector('.vlook-slide-body');body.scrollTop=77;
        dialog.querySelector('sup a').click();await settle();assert.equal(select.value,'4');assert.equal(document.activeElement.id,'fn-two');
        dialog.querySelector('.footnote-backref').click();await settle();assert.equal(select.value,'1');assert.equal(body.scrollTop,77);
    }finally{slides.close();content.remove();proto.showModal=oldShow;proto.close=oldClose;M.MarkdownRenderer.render=oldRender;}
});

test("脚注跨渲染稳定定位：不同宿主 ID、URI 编码和重复引用映射同一条目", () => {
    const seed=M.slideFootnoteSeed('[^一]: 注释\n\n[^two]: 第二条\n\n[^一]: 重复');
    assert.equal((seed.match(/\[\^一\]/g)||[]).length,1);
    assert.equal(M.slideFootnoteSeed(''), '');
    const first=html('<p><span data-vlook-footnote-seed></span>初始化引用</p><p><sup class="footnote-ref"><a href="#local-%E4%BA%8C">2</a></sup><sup class="footnote-ref"><a href="#local-%E4%BA%8C">2</a></sup></p><section class="footnotes"><ol><li id="local-one">一</li><li id="local-二">二<ol><li>嵌套列表不算脚注</li></ol></li></ol></section>');
    const second=html('<section class="footnotes"><ol><li id="other-abc">一</li><li id="other-def">二</li></ol></section>');
    M.indexSlideFootnotes(first);M.indexSlideFootnotes(second);
    assert.equal(first.querySelector('[data-vlook-footnote-seed]'),null);
    assert.equal(first.querySelectorAll('p').length,1);
    assert.deepEqual(Array.from(first.querySelectorAll('sup a'),a=>a.dataset.vlookFootnote),['1','1']);
    assert.equal(second.querySelector('[data-vlook-footnote="1"]').id,'other-def');
    assert.equal(first.querySelector('li li').dataset.vlookFootnote,undefined);
});

test("幻灯片不吞正文：散落脚注定义集中成一页，后续段落仍留原章节", () => {
    const source='[^first]: 前置定义\n\n前言\n\n# 章节\n\n第一段\n\n[^second]: 中间定义\n\n第二段\n\n###### 小标题\n\n第三段\n\n# 末章\n\n第四段\n\n[^third]: 末尾定义\n\n第五段';
    const index=M.getSourceIndex(source,opts),groups=M.slideGroups(index);
    assert.deepEqual(groups.map(g=>g.kind),['intro','chapter','chapter','footnotes']);
    assert.deepEqual(groups[1].blocks.map(b=>b.text),['# 章节','第一段','第二段','###### 小标题','第三段']);
    assert.deepEqual(groups[2].blocks.map(b=>b.text),['# 末章','第四段','第五段']);
    assert.equal(groups[3].blocks.length,3);
    const all=groups.flatMap(g=>g.blocks).map(b=>b.start).sort((a,b)=>a-b);
    assert.deepEqual(all,index.blocks.filter(b=>b.type!=='frontmatter').map(b=>b.start));
});

test("脚注初始化按首次真实引用排序：跳过代码、转义、图片与定义，重复只记一次", () => {
    const defs='[^first]: 定义一\n\n[^second]: 定义二\n\n[^unused]: 未使用';
    const source='```md\n[^first]\n```\n\n`[^first]` 和 \\[^first]，![替代文本[^first]](x.png)\n\n先引用[^second] 再引用[^first] 又引用[^second]，不存在[^missing]\n\n'+defs;
    assert.equal(M.slideFootnoteSeed(defs,source),'<span data-vlook-footnote-seed></span>[^second] [^first] [^unused]\n\n');
    assert.equal(M.slideFootnoteSeed(defs,'    [^first]\n\n正文[^second]\n\n'+defs),'<span data-vlook-footnote-seed></span>[^second] [^first] [^unused]\n\n');
});

test("任务源码定位：嵌套引用、大小写与 CRLF 精确字符，排除围栏和行内代码", () => {
    const source='- [ ] 第一项\r\n  - [X] 子任务\r\n\r\n> - [x] 引用任务\r\n\r\n```md\r\n- [ ] 代码示例\r\n```\r\n\r\n`- [ ] 行内示例`';
    const tasks=M.sourceTasks(source);
    assert.deepEqual(tasks.map(t=>({line:t.line,ch:t.ch,checked:t.checked})),[{line:0,ch:3,checked:false},{line:1,ch:5,checked:true},{line:3,ch:5,checked:true}]);
    for(const task of tasks)assert.match(source[task.offset],/[ xX]/);
});

test("幻灯片任务写回：只替换任务状态字符，源码变化后拒绝再次写入", async () => {
    const proto=window.HTMLDialogElement.prototype,oldShow=proto.showModal,oldClose=proto.close,oldRender=M.MarkdownRenderer.render;
    proto.showModal=function(){this.open=true};proto.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'))};
    M.MarkdownRenderer.render=async(_app,source,el)=>{el.innerHTML=source.includes('- [ ] 任务')?'<ul><li class="task-list-item"><input class="task-list-item-checkbox" type="checkbox">任务</li></ul>':'<h1>任务章</h1>'};
    const content=html('<div class="markdown-preview-view"></div>');document.body.append(content);
    let source='# 任务章\n\n- [ ] 任务';const writes=[];
    const view={file:{path:'tasks.md'},contentEl:content,getMode:()=> 'preview',editor:{getValue:()=>source,replaceRange(text,from,to){writes.push({text,from,to});source=source.replace('[ ]','[x]')}}};
    const events={on:()=>({}),offref:()=>{}};
    const slides=new M.NativeSlides({app:{workspace:{...events,getActiveViewOfType:()=>view},vault:events},settings:{}});
    try{
        slides.toggle();await new Promise(resolve=>setTimeout(resolve,0));
        const input=document.querySelector('.vlook-native-slides input');assert.equal(input.disabled,false);input.click();
        assert.deepEqual(writes,[{text:'x',from:{line:2,ch:3},to:{line:2,ch:4}}]);
        await Promise.resolve();assert.equal(input.checked,true);
        input.click();assert.equal(writes.length,1);
    }finally{slides.close();content.remove();proto.showModal=oldShow;proto.close=oldClose;M.MarkdownRenderer.render=oldRender;}
});

test("演示工具跨顶层弹窗：激光笔迁入幻灯片、聚光灯坐标和关闭清理", () => {
    const content=html('<div class="markdown-preview-view">正文</div>');document.body.append(content);
    content.getBoundingClientRect=()=>({left:10,top:20,width:500,height:400});
    const commands=new Map(),cleanups=[];
    const plugin={app:{workspace:{getActiveViewOfType:()=>({contentEl:content}),on:()=>({})}},addCommand(cmd){commands.set(cmd.id,cmd.callback)},registerEvent(){},register(fn){cleanups.push(fn)},registerDomEvent(el,name,fn){el.addEventListener(name,fn);cleanups.push(()=>el.removeEventListener(name,fn))}};
    const tools=new M.ReadingTools(plugin);tools.register();
    let dialog;
    try{
        commands.get('laser-pointer')();let overlay=document.querySelector('.vlook-effect-laser');assert.equal(overlay.parentElement,document.body);
        dialog=document.createElement('dialog');dialog.className='vlook-native-slides';dialog.open=true;
        const body=document.createElement('div');body.className='vlook-slide-body';body.getBoundingClientRect=()=>({left:40,top:50,width:300,height:200});dialog.append(body);document.body.append(dialog);
        document.dispatchEvent(new window.Event('vlook-presentation-change'));
        assert.equal(overlay.parentElement,dialog);assert.equal(overlay.style.left,'40px');
        document.dispatchEvent(new window.CustomEvent('vlook-presentation-effect',{detail:'spotlight'}));overlay=document.querySelector('.vlook-effect-spotlight');assert.equal(overlay.parentElement,dialog);
        document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Shift'}));assert.equal(overlay.style.getPropertyValue('--vlook-spotlight-radius'),'252px');
        document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Shift',repeat:true}));assert.equal(overlay.style.getPropertyValue('--vlook-spotlight-radius'),'252px');
        commands.get('spotlight-size')();assert.equal(overlay.style.getPropertyValue('--vlook-spotlight-radius'),'180px');
        document.dispatchEvent(new window.MouseEvent('pointermove',{clientX:75,clientY:90}));
        assert.equal(overlay.style.getPropertyValue('--vlook-pointer-x'),'35px');assert.equal(overlay.style.getPropertyValue('--vlook-pointer-y'),'40px');
        document.dispatchEvent(new window.MouseEvent('pointermove',{clientX:1,clientY:1}));assert.equal(overlay.hidden,true);
        dialog.remove();document.dispatchEvent(new window.Event('vlook-presentation-change'));assert.equal(document.querySelector('.vlook-reading-effect'),null);
    }finally{cleanups.forEach(fn=>fn());content.remove();dialog?.remove();}
});

test("幻灯片退出优先级：第一次 Esc 仅关闭激光笔，第二次退出幻灯片", async () => {
    const proto=window.HTMLDialogElement.prototype,oldShow=proto.showModal,oldClose=proto.close;
    proto.showModal=function(){this.open=true};proto.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'))};
    const content=html('<div class="markdown-preview-view"></div>');document.body.append(content);
    const cleanups=[],commands=new Map(),events={on:()=>({}),offref:()=>{}};
    const view={contentEl:content,file:{path:'esc.md'},getMode:()=> 'preview',editor:{getValue:()=> '# 演示\n\n正文'}};
    const plugin={app:{workspace:{...events,getActiveViewOfType:()=>view},vault:events},settings:{},addCommand(cmd){commands.set(cmd.id,cmd.callback)},registerEvent(){},register(fn){cleanups.push(fn)},registerDomEvent(el,name,fn,options){el.addEventListener(name,fn,options);cleanups.push(()=>el.removeEventListener(name,fn,options))}};
    const tools=new M.ReadingTools(plugin);tools.register();const slides=new M.NativeSlides(plugin);
    try{
        slides.toggle();await new Promise(resolve=>setTimeout(resolve,0));
        const dialog=document.querySelector('.vlook-native-slides'),body=dialog.querySelector('.vlook-slide-body');
        Array.from(dialog.querySelectorAll('button')).find(b=>b.textContent==='激光笔').click();
        assert.ok(body.classList.contains('vlook-laser-cursor'));
        const first=new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});body.dispatchEvent(first);
        assert.equal(first.defaultPrevented,true);assert.ok(dialog.isConnected);assert.equal(document.querySelector('.vlook-reading-effect'),null);assert.equal(body.classList.contains('vlook-laser-cursor'),false);
        body.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(dialog.isConnected,false);
    }finally{slides.close();cleanups.forEach(fn=>fn());content.remove();proto.showModal=oldShow;proto.close=oldClose;}
});

test("导航标题与脚注：引用式图片保留标题，列表代码与 HTML 注释不产生脚注", () => {
    const source='# 正文\n\n![引用式图片][pic]\n\n[pic]: pic/test.png\n\n- 示例\n\n  ```md\n  [^fake]: 代码里的脚注示例\n  ```\n\n<!--\n[^comment]: 注释里的脚注\n-->\n\n   [^real]: 带缩进的真实脚注';
    const index=M.getSourceIndex(source,opts),items=M.navigationItems(index);
    assert.ok(items.some(item=>item.kind==='插图'&&item.title.includes('引用式图片')));
    assert.ok(items.some(item=>item.kind==='脚注'&&item.title.includes('带缩进的真实脚注')));
    assert.ok(!items.some(item=>item.kind==='脚注'&&/示例|注释/.test(item.title)));
});

test("导航目标重定位：插入正文、编号变化和同名标题的第二个入口", () => {
    const original='# 起点\n\n## 重复\n\n第一处\n\n## 重复\n\n第二处';
    const old=M.navigationItems(M.getSourceIndex(original,opts));
    const item=old.filter(item=>item.kind==='章节'&&item.title.includes('重复'))[1];
    const changed='# 新增章节\n\n插入段落\n\n'+original;
    const current=M.navigationItems(M.getSourceIndex(changed,opts));
    const resolved=M.resolveNavigationItem(item,current);
    assert.equal(resolved.line,item.line+4);
    assert.equal(resolved.occurrence,1);
    assert.equal(M.resolveNavigationItem(item,M.navigationItems(M.getSourceIndex(changed+'\n\n## 重复',opts))),undefined);
    assert.equal(M.resolveNavigationItem(item,M.navigationItems(M.getSourceIndex('# 不同文档',opts))),undefined);
});

test("导航弹窗选择：按最新源码跳转，复用视图切换文件后拒绝旧入口", () => {
    let source='# 标题\n\n正文';const applied=[];
    const view={contentEl:html('<div class="markdown-preview-view"></div>'),file:{path:'one.md'},app:{workspace:{getLeavesOfType:()=>[]}},getMode:()=> 'preview',setEphemeralState(state){applied.push(state.line)},editor:{getValue:()=>source,lineCount:()=>source.split('\n').length}};
    const current=()=>M.navigationItems(M.getSourceIndex(source,opts));
    const items=current(),modal=new M.NavigationModal(view,items,current);
    source='插入前言\n\n'+source;modal.onChooseItem(items[0]);assert.deepEqual(applied,[2]);
    view.file={path:'two.md'};source='# 标题\n\n同名不同文档';modal.onChooseItem(items[0]);assert.deepEqual(applied,[2]);
});

test("导出附件链接：短文件名还原实际路径，保留后缀、参数与页码锚点", () => {
    const files={
        '报告.pdf':{path:'资料/季度 报告#1.pdf',extension:'pdf'},
        '数据.csv':{path:'附件/数据.csv',extension:'csv'},
        '目标.md':{path:'笔记/目标.md',extension:'md'},
    };
    const app={metadataCache:{getFirstLinkpathDest:(path)=>files[path]||null}};
    const el=html('<a class="internal-link" data-href="报告.pdf#page=3" href="报告.pdf#page=3">报告</a><a href="数据.csv?download=1&xmd=php">数据</a><a href="目标.md">笔记</a><a href="https://example.org/报告.pdf">外链</a>');
    M.rewriteExportLinks(el,app,'笔记/当前.md');
    assert.equal(el.children[0].getAttribute('href'),'../%E8%B5%84%E6%96%99/%E5%AD%A3%E5%BA%A6%20%E6%8A%A5%E5%91%8A%231.pdf#page=3');
    assert.equal(el.children[0].hasAttribute('data-href'),false);
    assert.equal(el.children[1].getAttribute('href'),'../%E9%99%84%E4%BB%B6/%E6%95%B0%E6%8D%AE.csv?download=1&xmd=php');
    assert.equal(el.children[2].getAttribute('href'),'%E7%9B%AE%E6%A0%87.html');
    assert.equal(el.children[3].getAttribute('href'),'https://example.org/报告.pdf');
    assert.equal(M.resolveVaultLink(app,'报告.pdf','笔记/当前.md'),null);
});

test("完整预览保留 Markdown 回退：同名 HTML 附件不阻止查找原始笔记", () => {
    const md={path:'目标.md',extension:'md'},htmlFile={path:'目标.html',extension:'html'};
    const app={metadataCache:{getFirstLinkpathDest:path=>path==='目标.html'?htmlFile:path==='目标.md'?md:null}};
    assert.equal(M.resolveVaultLink(app,'目标.html#章节','source.md').file,md);
    const root=html('<a href="目标.html#章节">HTML 文件</a>');M.rewriteExportLinks(root,app,'source.md');
    assert.equal(root.firstElementChild.getAttribute('href'),'%E7%9B%AE%E6%A0%87.html#章节');
});

test("文库配置路径重写：保留高亮标题、带逗号说明、空格和 YAML 列表", () => {
    const original=[' [==手册==](guide.md "查询, 入门") , [括号](folder/a(b).md "说明") ', 'https://example.org',42];
    const mapped=M.rewriteDocumentLibrary(original,href=>href==='guide.md'?'../实际目录/guide.html':href==='folder/a(b).md'?'../附件/a(b).html':href);
    assert.deepEqual(mapped,[' [==手册==](../实际目录/guide.html "查询, 入门") , [括号](../附件/a(b).html "说明") ','https://example.org',42]);
    assert.equal(original[0],' [==手册==](guide.md "查询, 入门") , [括号](folder/a(b).md "说明") ');
    assert.equal(M.rewriteDocumentLibrary(undefined,href=>href),undefined);
    assert.equal(M.rewriteDocumentLibrary('[标题](<some path.md> "说明")',()=> 'resolved%20path.html'),'[标题](<resolved%20path.html> "说明")');
});

test("文库宿主解析：预览使用真实库路径，导出使用相对 HTML 路径且外链不变", () => {
    const file={path:'资料/手册 #1.md',extension:'md'};
    const app={metadataCache:{getFirstLinkpathDest:path=>path==='手册.md'||path===file.path?file:null}};
    const config='[==手册==](手册.md?target=_self#章节 "查询, 说明"),https://example.org';
    const preview=M.rewriteLibraryLinks(config,app,'笔记/当前.md','preview');
    const entry=M.documentLibraryItems(preview)[0];
    assert.equal(M.resolveVaultLink(app,entry.href,'笔记/当前.md').file,file);
    assert.match(entry.href,/__vlook_vault__\/%E8%B5%84%E6%96%99\/%E6%89%8B%E5%86%8C%20%231.md\?target=_self#章节$/);
    const exported=M.rewriteLibraryLinks(config,app,'笔记/当前.md','export');
    assert.match(exported,/\[==手册==\]\(\.\.\/%E8%B5%84%E6%96%99\/%E6%89%8B%E5%86%8C%20%231.html\?target=_self#章节 "查询, 说明"\),https:\/\/example.org$/);
});

test("文库分隔：标题逗号、URL 逗号、单引号说明与括号互不拆散", () => {
    const config='[手册,进阶](folder/a,b.md \'查询, 说明\'),[括号](folder/a(b,c).md "括号 ) 说明"),https://example.org';
    const items=M.documentLibraryItems(config);
    assert.equal(M.documentLibraryItems("[A 'quoted, <3](a.md),[B](b.md)").length,2);
    assert.equal(items.length,3);assert.equal(items[0].title,'手册,进阶');assert.equal(items[0].href,'folder/a,b.md');assert.equal(items[0].description,'查询, 说明');
    assert.equal(items[1].href,'folder/a(b,c).md');
    assert.equal(M.rewriteDocumentLibrary(config,href=>href==='folder/a,b.md'?'actual/a%2Cb.html':href),'[手册,进阶](actual/a%2Cb.html \'查询, 说明\'),[括号](folder/a(b,c).md "括号 ) 说明"),https://example.org');
});

test("链接地图：全文链接、引用式链接、Wiki 与外链锚点计数，排除代码和图片", () => {
    const source='---\nurl: https://frontmatter.example\n---\n\n[第一处](guide.md#one) [第二处](guide.md#one) [第三处][ref]\n\n[ref]: guide.md#two "说明"\n\n[[其它文档#章节|Wiki 标题]] <https://example.org/a#anchor> https://example.org/b\n\n![图片](pic.png) ![[嵌入图片.png]]\n\n`[伪图](fake.md)`\n\n```md\n[代码](code.md)\n```\n\n[页内](#local) <user@example.org>\n\n引用[^note]\n\n[^note]: 脚注内容';
    const index=M.getSourceIndex(source,opts),links=M.sourceLinks(index),groups=M.linkMapGroups(index);
    assert.ok(links.some(link=>link.title==='Wiki 标题'&&link.href==='其它文档#章节'));
    assert.ok(!links.some(link=>/fake|code|pic\.png|嵌入|frontmatter|脚注内容/.test(link.href)));
    const guide=groups.find(group=>group.document==='guide.md');assert.equal(guide.links.length,3);assert.deepEqual(guide.anchors,[{hash:'one',count:2},{hash:'two',count:1}]);
    assert.ok(groups.some(group=>group.document==='https://example.org/a'));assert.ok(groups.some(group=>group.document==='https://example.org/b'));
    assert.ok(!groups.some(group=>group.document.startsWith('mailto:')||group.document.startsWith('#')));
    assert.equal(source.split('\n')[guide.links[0].line].startsWith('[第一处]'),true);
});

test("链接地图引用解析：完整、折叠和快捷引用一致，未定义引用不猜测", () => {
    const source='[显示文字][手册] [手册][] [手册] [未定义]\n\n[手册]: guide.md#章节';
    const links=M.sourceLinks(M.getSourceIndex(source,opts));assert.equal(links.length,3);
    assert.ok(links.every(link=>link.href==='guide.md#章节'));assert.equal(links[0].title,'显示文字');
});

test("链接地图 HTML：内联与块级链接、实体参数及图片替代文本，排除注释脚本和代码", () => {
    const source='开头 <a href="guide.html?x=1&amp;y=2#one"><strong>HTML 标题</strong></a>\n\n<div><a href="other.html#two"><img src="a.png" alt="图片链接"></a></div>\n\n<a href="third.html">https://label.example</a>\n\n<!-- <a href="comment.html">伪链接</a> -->\n\n<script>const text=\'<a href="script.html">伪链接</a>\';</script>\n\n```html\n<a href="code.html">示例</a>\n```';
    const links=M.sourceLinks(M.getSourceIndex(source,opts));
    assert.deepEqual(links.map(link=>({title:link.title,href:link.href})),[{title:'HTML 标题',href:'guide.html?x=1&y=2#one'},{title:'图片链接',href:'other.html#two'},{title:'https://label.example',href:'third.html'}]);
    assert.deepEqual(links.map(link=>link.line),[0,2,4]);
});

test("链接地图同一行保持真实顺序，行内脚本里的 URL 不参与统计", () => {
    const source='[Markdown](first.md) <a href="second.html">HTML</a> [第三](third.md) 普通文本 <script>https://fake.example</script> <a href="fourth.html">第四</a>';
    const links=M.sourceLinks(M.getSourceIndex(source,opts));assert.deepEqual(links.map(link=>link.href),['first.md','second.html','third.md','fourth.html']);
});

test("链接地图块级脚本结束后继续识别正常链接", () => {
    const source='<script>https://fake.example</script>\n\n[正常链接](real.md)';
    assert.deepEqual(M.sourceLinks(M.getSourceIndex(source,opts)).map(link=>link.href),['real.md']);
});

test("库内锚点识别：标题、题注、HTML id/name 与块引用，代码/YAML 伪锚点排除", () => {
    const source='---\nexample: ^yaml\n---\n\n# 中文 标题\n\n![插图题注](pic.png)\n\n正文 ^real-block\n\n<a id="HTML-Id" name="named"></a>\n\n```md\n# 假标题\n代码 ^fake\n```';
    const index=M.getSourceIndex(source,opts);
    for(const anchor of ['中文-标题','%E4%B8%AD%E6%96%87%20%E6%A0%87%E9%A2%98','插图题注','HTML-Id','named','^real-block'])assert.equal(M.hasSourceAnchor(index,anchor),true,anchor);
    for(const anchor of ['^yaml','^fake','假标题','不存在'])assert.equal(M.hasSourceAnchor(index,anchor),false,anchor);
});

test("库内链接检查：文件/锚点失效分开，远程与附件锚点不伪报通过，目标只读取一次", async () => {
    const source='[当前](#标题) [外链](https://example.org/#remote) [缺文件](lost.md) [有效](target.md#存在) [失效锚点](target.md#缺失) [重复](target.md#存在) [附件](report.pdf#page=2)\n\n# 标题';
    const current={path:'current.md',extension:'md'},target={path:'target.md',extension:'md'},pdf={path:'report.pdf',extension:'pdf'};let reads=0;
    const app={metadataCache:{getFirstLinkpathDest:path=>path==='target.md'?target:path==='report.pdf'?pdf:null},vault:{async cachedRead(file){assert.equal(file,target);reads++;return '# 存在'}}};
    const results=await M.auditVaultLinks(app,current,source);
    assert.deepEqual(results.map(result=>result.status),['ok','unchecked','missing-file','ok','missing-anchor','ok','unchecked']);assert.equal(reads,1);
});

test("链接检查优先实际 HTML 文件、支持导出后缀回退，并保留读取失败状态", async () => {
    const file={path:'current.md',extension:'md'},htmlFile={path:'target.html',extension:'html'},md={path:'alias.md',extension:'md'},broken={path:'broken.md',extension:'md'};
    const files={'target.html':htmlFile,'alias.md':md,'broken.md':broken};
    const app={metadataCache:{getFirstLinkpathDest:path=>files[path]||null},vault:{async cachedRead(file){if(file===htmlFile)return '<div id="html-only">HTML</div>';if(file===md)return '# 标题';throw Error('暂不可读')}}};
    const result=await M.auditVaultLinks(app,file,'[HTML](target.html#html-only) [导出链接](alias.html#标题) [不可读](broken.md#x)');
    assert.deepEqual(result.map(item=>item.status),['ok','ok','unchecked']);
});

test("重复标题规范检查：标题与题注共用锚点空间，报告后续位置", () => {
    const source='# 重复\n\n正文\n\n## 重复\n\n![重复](pic.png)\n\n```md\n# 重复\n```';
    const index=M.getSourceIndex(source,opts),warnings=M.duplicateAnchorWarnings(index);
    assert.equal(warnings.length,2);assert.ok(warnings.every(result=>result.status==='warning'));
    assert.deepEqual(warnings.map(result=>result.link.line),[4,6]);assert.ok(warnings.every(result=>result.detail.includes('第 1 行')));
});

test("允许重复配置：精确标题和正则白名单，带 g 的规则重复使用不漏项", () => {
    const source='---\nvlook-header-dup: 允许;/^正则/g\n---\n\n# 允许\n\n## 允许\n\n# 正则标题\n\n## 正则标题\n\n### 正则标题\n\n# 未允许\n\n## 未允许';
    const warnings=M.duplicateAnchorWarnings(M.getSourceIndex(source,opts));assert.equal(warnings.length,1);assert.equal(warnings[0].link.title,'未允许');
});

test("引用标题源码识别：首/次段、首个 h6、嵌套与列表引用，排除后续正文和代码", () => {
    const source='> **首段标题**\n>\n> ==次段标题==\n>\n> **第三段正文**\n\n> ###### 折叠标题\n>\n> 普通正文\n\n- > **列表小标题**\n\n> 外层正文\n>\n> > **内层标题**\n\n```md\n> **代码标题**\n```';
    const titles=M.quoteSourceTitles(source);
    assert.deepEqual(titles.map(item=>item.title),['首段标题','次段标题','折叠标题','列表小标题','内层标题']);
    assert.equal(titles.find(item=>item.title==='折叠标题').kind,'fold');
});

test("引用标题进入重复与锚点检查：普通第三段强调不作为标题", () => {
    const source='# 同名\n\n> **同名**\n>\n> 普通正文\n>\n> **不作为标题**\n\n> ###### 折叠\n>\n> 正文\n\n# 折叠\n\n结束正文';
    const index=M.getSourceIndex(source,opts),warnings=M.duplicateAnchorWarnings(index);
    assert.deepEqual(warnings.map(result=>result.link.title),['同名','折叠']);
    assert.equal(M.hasSourceAnchor(index,'同名'),true);assert.equal(M.hasSourceAnchor(index,'不作为标题'),false);
});


test('原版锚点规范：标点、加号、破折号、大小写和连续空白', () => {
    assert.equal(M.vlookAnchor('API: A+B，测试！'), 'api-ab测试');
    assert.equal(M.vlookAnchor('A–B—C'), 'a--b---c');
    assert.equal(M.vlookAnchor('~~隐藏标题~~'), '隐藏标题');
    assert.equal(M.vlookAnchor(' A  B '), 'a--b');
    const index=M.getSourceIndex('# API: A+B，测试！\n\n正文\n\n<div id="Exact:ID"></div>',opts);
    assert.equal(M.hasSourceAnchor(index,'api-ab测试'),true);
    assert.equal(M.hasSourceAnchor(index,'Exact:ID'),true);
    assert.equal(M.hasSourceAnchor(index,'exactid'),false);
});

test('公式生成锚点不按源码误报通过或缺失，保留渲染后待检查', async () => {
    const file={path:'公式.md',extension:'md'};
    const app={metadataCache:{getFirstLinkpathDest:()=>file},vault:{cachedRead:async()=>{throw new Error('不应读取生成锚点')}}};
    const results=await M.auditVaultLinks(app,file,'[本页](#mjx-eqn%3Aenergy) [跨页](其它.md#mjx-eqn%3Aenergy)');
    assert.equal(results.length,2);assert.ok(results.every(result=>result.status==='unchecked'&&result.detail.includes('MathJax')));
});

test('资源故障历史限制快照和条目数量，结果修改不影响内部记录', () => {
    const history=new M.ResourceFailureHistory();
    const failure=n=>({link:{title:String(n),href:`${n}.png`,line:n},status:'missing-resource',detail:''});
    for(let n=0;n<501;n++)history.record('a.md','source',failure(n));
    assert.equal(history.results('a.md','source').length,500);
    const copy=history.results('a.md','source');copy[0].link.title='修改';
    assert.notEqual(history.results('a.md','source')[0].link.title,'修改');
    for(let n=0;n<10;n++)history.record(`${n}.md`,'source',failure(n));
    assert.equal(history.results('a.md','source').length,0);
});

test('公式跨卡源位置：精确标签、不吃标点大小写、排除代码和 TeX 注释', () => {
    const source='# 说明\n\n```tex\n\\label{fake}\n```\n\n# 公式\n\n$$\nx=1 % \\label{comment}\n\\label{Energy:A+B}\\tag{能量}\n\\\\label{escaped}\n\\% \\label{after-percent}\n$$';
    const index=M.getSourceIndex(source,opts);
    assert.equal(M.equationSourceLine(index,'mjx-eqn:Energy:A+B'),8);
    assert.equal(M.equationSourceLine(index,'mjx-eqn:after-percent'),8);
    for(const label of ['fake','comment','escaped','energy:ab'])assert.equal(M.equationSourceLine(index,'mjx-eqn:'+label),undefined);
    assert.equal(M.equationSourceLine(index,'mjx-other:Energy:A+B'),undefined);
});

test('公式引用切换幻灯片并聚焦精确 MathJax ID；未知生成锚点不拦截', async () => {
    const proto=window.HTMLDialogElement.prototype,oldShow=proto.showModal,oldClose=proto.close,oldRender=M.MarkdownRenderer.render;
    proto.showModal=function(){this.open=true};proto.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'))};
    M.MarkdownRenderer.render=async(_app,source,el)=>{
        if(source.includes('\\label{Energy:A+B}'))el.innerHTML='<div class="math-block"><span id="mjx-eqn:Energy:A+B">公式</span></div>';
        else if(source.includes('引用区'))el.innerHTML='<a href="#mjx-eqn%3AEnergy%3AA%2BB">公式引用</a><a href="#mjx-unknown">未知</a>';
        else el.textContent=source;
    };
    const content=html('<div class="markdown-preview-view"></div>');document.body.append(content);
    const source='# 起点\n\n引用区\n\n# 公式\n\n$$\nE=mc^2 \\label{Energy:A+B}\n$$\n\n正文';
    const view={file:{path:'doc.md'},contentEl:content,getMode:()=> 'preview',editor:{getValue:()=>source}};
    const events={on:()=>({}),offref:()=>{}};
    const slides=new M.NativeSlides({app:{workspace:{...events,getActiveViewOfType:()=>view},vault:events},settings:{}});
    const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
    try{
        slides.toggle();await settle();const dialog=document.querySelector('.vlook-native-slides');
        const unknown=new window.MouseEvent('click',{bubbles:true,cancelable:true});dialog.querySelector('a[href="#mjx-unknown"]').dispatchEvent(unknown);
        assert.equal(unknown.defaultPrevented,false);
        dialog.querySelector('a[href*="Energy"]').click();await settle();
        assert.equal(dropdown(dialog,0).value,'1');assert.equal(document.activeElement.id,'mjx-eqn:Energy:A+B');
    }finally{slides.close();content.remove();proto.showModal=oldShow;proto.close=oldClose;M.MarkdownRenderer.render=oldRender;}
});

test('引用块内公式标签保留原始源行，引用内代码不产生公式锚点', () => {
    const source='前言\n\n> 说明\n>\n> $$\n> x=1 \\label{quoted}\n> $$\n>\n> ```tex\n> \\label{fake}\n> ```';
    const index=M.getSourceIndex(source,opts);
    assert.equal(M.equationSourceLine(index,'mjx-eqn:quoted'),4);
    assert.equal(M.equationSourceLine(index,'mjx-eqn:fake'),undefined);
});

test('列表公式：有序/嵌套列表和引用保留源行，列表代码示例不作为目标', () => {
    const source='说明\n\n1. 项目\n\n   $$\n   a=1 \\label{ordered}\n   $$\n\n2. 第二项\n\n   - 嵌套\n\n     $$\n     b=2 \\label{nested}\n     $$\n\n   - > 引用\n     >\n     > $$\n     > c=3 \\label{quote-in-list}\n     > $$\n\n   - 示例\n\n     ```math-example\n     $$\n     \\label{fake}\n     $$\n     ```';
    const index=M.getSourceIndex(source,opts);
    for(const [label,line] of [['ordered',4],['nested',12],['quote-in-list',18]])assert.equal(M.equationSourceLine(index,'mjx-eqn:'+label),line,label);
    assert.equal(M.equationSourceLine(index,'mjx-eqn:fake'),undefined);
});

test('列表首行公式、多位序号和引用中的列表公式仍精确定位', () => {
    for(const source of ['-\t$$\n\tx=1 \\label{first}\n\t$$','- $$\n  x=1 \\label{first}\n  $$','12. $$\n    x=1 \\label{first}\n    $$','> - $$\n>   x=1 \\label{first}\n>   $$']){
        assert.equal(M.equationSourceLine(M.getSourceIndex(source,opts),'mjx-eqn:first'),0);
    }
});

test('导出等待公式实际渲染：延迟输出、错误、超时和无公式', async () => {
    const root=html('<span class="math math-inline">x+y</span><div class="math math-block">E=mc^2</div>');
    let resolved=false;const ready=M.waitForMath(root,500,5).then(()=>{resolved=true});
    await new Promise(resolve=>setTimeout(resolve,15));assert.equal(resolved,false);
    root.querySelector('span').innerHTML='<mjx-container><svg><g></g></svg></mjx-container>';
    await new Promise(resolve=>setTimeout(resolve,15));assert.equal(resolved,false);
    root.querySelector('div').innerHTML='<span class="katex"><span class="katex-html">公式</span></span>';
    await ready;assert.equal(resolved,true);
    assert.equal(await M.waitForMath(html('<span class="math math-inline"><mjx-container><svg><g data-mml-node="merror"></g></svg></mjx-container></span>'),100,1),1);
    await assert.rejects(M.waitForMath(html('<div class="math math-block">等待公式</div>'),20,1),/1 个未完成/);
    await M.waitForMath(html('<p>无公式</p>'),20,1);
    await M.waitForMath(html('<span class="math math-inline"><mjx-container><mjx-math>CHTML</mjx-math></mjx-container></span>'),100,1);
});

test('远程 VLOOK 锚点检查协议：保留目标参数，替换旧检查集合并规范化去重', () => {
    const group={document:'https://example.org/guide.html?theme=blue&hash1=old&hash9=stale&checkcount=9&checkhash=0&ws=auto',links:[],anchors:[{hash:encodeURIComponent('API: A+B'),count:1},{hash:'api-ab',count:2},{hash:'章节—一',count:1}]};
    const result=new URL(M.remoteAnchorCheckUrl(group));
    assert.equal(result.searchParams.get('theme'),'blue');assert.equal(result.searchParams.get('checkhash'),'1');
    assert.equal(result.searchParams.get('checkcount'),'2');assert.equal(result.searchParams.get('ws'),'0');
    assert.equal(result.searchParams.get('hash1'),'api-ab');assert.equal(result.searchParams.get('hash2'),'章节---一');
    assert.equal(result.searchParams.has('hash9'),false);assert.equal(result.hash,'');
    for(const document of ['file:///tmp/a.html','javascript:alert(1)','obsidian://open','//example.org/guide.html','broken'])assert.equal(M.remoteAnchorCheckUrl({...group,document}),null);
    assert.equal(M.remoteAnchorCheckUrl({...group,anchors:[]}),null);
    assert.throws(()=>M.remoteAnchorCheckUrl({...group,anchors:[{hash:'中'.repeat(1000),count:1}]}),/8000/);
});

test('远程检查选择：用户选择才打开目标检查页，文档改变后拒绝旧选择', () => {
    let source='[查看](https://example.org/a.html#章节)';const opened=[],original=window.open;
    window.open=(...args)=>{opened.push(args);return null};
    const group={document:'https://example.org/a.html',links:[],anchors:[{hash:'章节',count:1}]};
    const view={app:{},file:{path:'a.md'},editor:{getValue:()=>source}};
    try{
        const modal=new M.RemoteAnchorModal(view,source,[group]);assert.equal(opened.length,0);
        modal.onChooseItem(group);assert.equal(opened.length,1);assert.equal(new URL(opened[0][0]).searchParams.get('hash1'),'章节');
        assert.equal(opened[0][2],'noopener,noreferrer');
        source+='\n修改';modal.onChooseItem(group);assert.equal(opened.length,1);
    }finally{window.open=original;}
});

test('内嵌视频识别：原版五个平台及协议相对地址，排除伪域名与查询伪装', () => {
    for(const src of ['https://player.bilibili.com/player.html','https://open.douyin.com/player/video#pt','https://www.ixigua.com/iframe/123','https://v.qq.com/txp/iframe/player.html','//www.youtube.com/embed/example'])assert.equal(M.isVideoEmbed(src),true,src);
    for(const src of ['https://bilibili.com.evil.test/player','https://example.org/?url=bilibili.com/player','https://youtube.com/manual','manual.html','javascript:bilibili.com/player'])assert.equal(M.isVideoEmbed(src),false,src);
});

test('媒体题注按原版分开计数：音频、视频、迷你音频及原生标签不串号', () => {
    const source='![配乐一](a.mp3)\n\n![视频一](a.mp4)\n\n![](mini.wav?controls=mini)\n\n![配乐二](b.ogg)\n\n<video src="b.mp4"></video>\n\n<audio src="c.wav"></audio>\n\n![插图](pic.png)';
    const blocks=M.getSourceIndex(source,opts).blocks;
    assert.deepEqual(blocks.map(block=>block.caption&&[block.caption.kind,block.caption.mediaType,block.caption.num]),[
        ['media','audio','2'],['media','video','2'],undefined,['media','audio','3'],['media','video','1'],['media','audio','1'],['figure',undefined,'1']]);
});

test('按章分组的媒体计数独立，关闭编号不丢媒体类型与计数', () => {
    const source='# 正文\n\n![音频](a.wav)\n\n![视频](a.webm)\n\n# 第二章\n\n![视频二](b.mp4)\n\n![音频二](b.mp3)';
    const grouped=M.getSourceIndex(source,{...opts,captionGroup:true,headerEnabled:true,headerTemplate:'h1{{###. }}'}).blocks.filter(block=>block.caption);
    assert.equal(grouped[0].caption.counter,1);assert.equal(grouped[1].caption.counter,1);
    assert.equal(grouped[2].caption.counter,2);assert.equal(grouped[3].caption.counter,2);
    assert.deepEqual(grouped.map(block=>block.caption.num),['1-1','1-1','2-1','2-1']);
    const off=M.getSourceIndex(source,{...opts,captionNumber:false}).blocks.filter(block=>block.caption);
    assert.ok(off.every(block=>block.caption.num===''));assert.deepEqual(off.map(block=>block.caption.mediaType),['audio','video','video','audio']);
});

test('同块多个媒体各自计数：后续段落接续，迷你音频不占位', () => {
    const index=M.getSourceIndex('![一](a.mp3) ![二](b.mp3) ![](mini.wav?controls=mini) ![视频](v.mp4)\n\n![三](c.wav)',opts);
    assert.deepEqual(index.blocks[0].mediaCaptions.map(info=>[info.mediaType,info.num]),[['audio','1'],['audio','2'],['video','1']]);
    assert.equal(index.blocks[1].caption.num,'3');
    const htmlIndex=M.getSourceIndex('<audio src="a.wav"></audio><video src="v.mp4"></video><audio src="b.wav"></audio>',opts);
    assert.deepEqual(htmlIndex.blocks[0].mediaCaptions.map(info=>[info.mediaType,info.num]),[['audio','1'],['video','1'],['audio','2']]);
});

test('HTML 媒体数量排除注释、脚本文本及属性中的示例标签', () => {
    const source='<div data-example="<audio src=\'fake.mp3\'>">\n<!-- <video src="fake.mp4"></video> -->\n<script>"<audio src=\'fake.wav\'>"</script>\n<audio src="real.mp3"></audio>\n<video src="real.mp4"></video>\n</div>';
    const index=M.getSourceIndex(source,opts);
    assert.deepEqual(index.blocks[0].mediaCaptions.map(info=>[info.mediaType,info.num]),[['audio','1'],['video','1']]);
});

test('同块所有媒体题注成为独立锚点：保留各自编号和源行，迷你题注排除', () => {
    const source='![一](a.mp3) ![二](b.mp3)\n![视频](a.mp4) ![迷你](mini.wav?controls=mini)';
    const index=M.getSourceIndex(source,opts);
    assert.deepEqual(M.captionTargets(index.blocks[0],source),[{title:'一',num:'1',line:0},{title:'二',num:'2',line:0},{title:'视频',num:'1',line:1}]);
    assert.equal(M.hasSourceAnchor(index,'二'),true);assert.equal(M.hasSourceAnchor(index,'视频'),true);assert.equal(M.hasSourceAnchor(index,'迷你'),false);
    const duplicate=M.getSourceIndex('![同名](a.mp3) ![同名](b.mp3)',opts);
    assert.equal(M.duplicateAnchorWarnings(duplicate).length,1);
});

test('原生 HTML 多媒体锚点：独立 alt、实体字符及源行，第二题注不是额外锚点', () => {
    const source='<div data-example="<audio alt=\'伪造\'>">\n<!-- <video alt="注释"></video> -->\n<audio src="a.wav" alt="音频 &amp; 一" title="下题注"></audio>\n<video src="v.mp4" alt="视频二"></video>\n<audio src="b.wav" title="只有 title"></audio>\n</div>';
    const index=M.getSourceIndex(source,opts),targets=M.captionTargets(index.blocks[0],source);
    assert.deepEqual(targets,[{title:'音频 & 一',num:'1',line:2},{title:'视频二',num:'1',line:3}]);
    for(const title of ['音频 & 一','视频二'])assert.equal(M.hasSourceAnchor(index,title),true);
    for(const title of ['伪造','注释','下题注','只有 title'])assert.equal(M.hasSourceAnchor(index,title),false);
    const duplicate=M.getSourceIndex('<audio alt="重复"></audio>\n<video alt="重复"></video>',opts);
    assert.equal(M.duplicateAnchorWarnings(duplicate).length,1);
});

test('导出原生媒体包装：每个播放器有独立题注父容器，保留节点和属性', () => {
    const root=html('<audio src="a.wav" alt="音一"></audio><div><video src="v.mp4" alt="视二" loop></video><audio src="b.wav" alt="音三"></audio></div><figure><audio src="c.wav"></audio></figure><video src="bare.mp4"></video>');
    const bare=root.querySelector('video[src="bare.mp4"]');
    const media=Array.from(root.querySelectorAll('audio,video')).filter(n=>n!==bare);M.toTyporaDom(root,true);
    assert.equal(bare.parentElement,root);
    assert.equal(root.querySelectorAll('figure').length,4);
    media.forEach(node=>{assert.equal(node.parentElement.tagName,'FIGURE');assert.equal(root.contains(node),true)});
    assert.equal(media[0].getAttribute('alt'),'音一');assert.equal(media[1].hasAttribute('loop'),true);
    M.toTyporaDom(root,true);assert.equal(root.querySelectorAll('figure').length,4);
});

test('原版运行时多遍编号顺序：原生标签先编号，图片式媒体随后按源序编号', () => {
    const source='![Markdown 音频一](one.mp3)\n\n<audio alt="HTML 音频二" src="two.mp3"></audio>\n\n![Markdown 音频三](three.mp3)\n\n![Markdown 视频一](one.mp4)\n\n<video alt="HTML 视频二" src="two.mp4"></video>\n\n![Markdown 视频三](three.mp4)';
    const blocks=M.getSourceIndex(source,opts).blocks.filter(block=>block.caption);
    assert.deepEqual(blocks.map(block=>block.caption.num),['2','1','3','2','1','3']);
});


test('原版浏览器十二例：混合语法跨章分组编号与原生标签不分组相符', () => {
    const source=readFileSync(new URL('./fixtures/media-grouping.md',import.meta.url),'utf8');
    const index=M.getSourceIndex(source,{...opts,captionGroup:true,headerTemplate:'h1{{###. }}'});
    const blocks=index.blocks.filter(block=>block.caption);
    assert.deepEqual(blocks.map(block=>block.caption.num),['1-1','1','1-2','1-1','1','1-2','2-1','2','2-2','2-1','2','2-2']);
    const targets=blocks.flatMap(block=>M.captionTargets(block,source));
    assert.equal(targets.length,12);
    assert.deepEqual(targets.map(target=>target.num),blocks.map(block=>block.caption.num));
    assert.equal(targets.find(target=>target.title==='HTML 音频五').num,'2');
    assert.equal(targets.find(target=>target.title==='Markdown 视频六').num,'2-2');
});

test('普通 HTML iframe 不消耗视频编号或产生题注锚点', () => {
    const source='<div>\n<iframe src="https://example.com/document" alt="普通网页"></iframe>\n<iframe data-example="src=\'https://www.youtube.com/embed/fake\'" src="https://example.com/" alt="伪视频"></iframe>\n<iframe src="https://www.youtube.com/embed/real" alt="平台视频"></iframe>\n<video src="native.mp4" alt="原生视频"></video>\n</div>\n\n![后续视频](next.mp4)';
    const index=M.getSourceIndex(source,opts);
    assert.deepEqual(index.blocks.filter(block=>block.caption).flatMap(block=>M.captionTargets(block,source)).map(target=>[target.title,target.num]),[['平台视频','2'],['原生视频','1'],['后续视频','3']]);
    assert.equal(M.hasSourceAnchor(index,'普通网页'),false);
    assert.equal(M.hasSourceAnchor(index,'伪视频'),false);
});

test('表格子媒体：独立题注、原生预计数、正文接续和全部锚点', () => {
    const source='*==媒体表==*\n\n|类型|内容|\n|---|---|\n|音频|![表内音频](cell.mp3)|\n|视频|<video alt="表内原生视频" src="cell.mp4"></video>|\n\n![正文音频](after.mp3)\n\n![正文视频](after.mp4)';
    const index=M.getSourceIndex(source,opts),table=index.blocks.find(block=>block.type==='table');
    assert.equal(table.caption.kind,'table');assert.equal(table.caption.num,'1');
    assert.deepEqual(table.mediaCaptions.map(info=>[info.mediaType,info.num]),[['audio','1'],['video','1']]);
    assert.deepEqual(index.blocks.flatMap(block=>M.captionTargets(block,source)).map(target=>[target.title,target.num]),[['媒体表','1'],['表内音频','1'],['表内原生视频','1'],['正文音频','2'],['正文视频','2']]);
    assert.equal(M.hasSourceAnchor(index,'表内原生视频'),true);
    const unnamed=M.getSourceIndex('|a|\n|---|\n|![播放器](a.mp3)|',opts);
    assert.deepEqual(M.captionTargets(unnamed.blocks[0],unnamed.text).map(target=>target.title),['播放器']);
});

test('表格里的 HTML 播放器代码示例不占媒体编号', () => {
    const source='|a|\n|---|\n|`<video alt="代码示例" src="fake.mp4"></video>`|\n|![音频](real.mp3)|\n\n![正文](after.mp4)';
    const index=M.getSourceIndex(source,opts);
    assert.deepEqual(index.blocks.flatMap(block=>M.captionTargets(block,source)).map(target=>[target.title,target.num]),[['音频','1'],['正文','1']]);
});

test('引用与列表子媒体计数、嵌套原生预计数及正文锚点接续', () => {
    const source='> ![引用音频](quote.mp3)\n>\n> > <video alt="嵌套原生视频" src="nested.mp4"></video>\n\n- ![列表音频](list.mp3)\n  - ![嵌套列表视频](list.mp4)\n\n![正文音频](after.mp3)\n\n![正文视频](after.mp4)';
    const index=M.getSourceIndex(source,opts);
    assert.deepEqual(index.blocks.flatMap(block=>M.captionTargets(block,source)).map(target=>[target.title,target.num,target.line]),[['引用音频','1',0],['嵌套原生视频','1',2],['列表音频','2',4],['嵌套列表视频','2',5],['正文音频','3',7],['正文视频','3',9]]);
    assert.equal(M.hasSourceAnchor(index,'嵌套列表视频'),true);
    assert.equal(index.blocks.find(block=>block.type==='blockquote').caption,undefined);
});

test('引用和列表内的围栏、缩进及行内代码中的媒体示例不参与编号', () => {
    const source='> ```html\n> <video alt="伪视频" src="fake.mp4"></video>\n> ![伪音频](fake.mp3)\n> ```\n>\n> ![真实引用](real.mp3)\n\n- 示例\n\n      <audio alt="缩进示例" src="fake.wav"></audio>\n\n- `<video src="fake.mp4"></video>`\n- ![真实列表](real.mp4)\n\n![后续](after.mp4)';
    const index=M.getSourceIndex(source,opts);
    assert.deepEqual(index.blocks.flatMap(block=>M.captionTargets(block,source)).map(target=>[target.title,target.num]),[['真实引用','1'],['真实列表','1'],['后续','2']]);
});

test('HTML img 媒体与原生播放器混排：独立计数、mini 排除及题注锚点', () => {
    const source='<div>\n<img src="a.mp3" alt="HTML 图片式音频">\n<audio src="native.wav" alt="原生音频"></audio>\n<img src="mini.wav?controls=mini" alt="迷你">\n<img src="v.mp4" alt="HTML 图片式视频">\n<img src="plain.png" alt="插图">\n</div>\n\n![正文](after.mp3)';
    const index=M.getSourceIndex(source,opts);
    assert.deepEqual(index.blocks.flatMap(block=>M.captionTargets(block,source)).map(target=>[target.title,target.num]),[['插图','1'],['HTML 图片式音频','2'],['原生音频','1'],['HTML 图片式视频','1'],['正文','3']]);
    assert.equal(M.hasSourceAnchor(index,'迷你'),false);
});

test('段落内 HTML 与 Markdown 媒体统一编号，转义标签和属性示例不计数', () => {
    const source='文字 <img src="one.mp3" alt="行内图片式音频"> 接着 <audio src="two.wav" alt="行内原生音频"></audio> 末尾 ![Markdown 音频](three.mp3)\n\n文字 \\<video alt="转义标签" src="fake.mp4"> 与 <span title="![属性示例](fake.mp3)">正文</span>\n\n![正文视频](after.mp4)';
    const index=M.getSourceIndex(source,opts);
    assert.deepEqual(index.blocks.flatMap(block=>M.captionTargets(block,source)).map(target=>[target.title,target.num]),[['行内图片式音频','2'],['行内原生音频','1'],['Markdown 音频','3'],['正文视频','1']]);
    assert.equal(M.hasSourceAnchor(index,'转义标签'),false);
    assert.equal(M.hasSourceAnchor(index,'属性示例'),false);
});

test('图标、Logo、明信片不消耗正文插图编号或生成普通题注锚点', () => {
    const source='![图标](icon.svg#icon2x)\n\n![Logo](logo.png#logo)\n\n![明信片](card.png#card)\n\n![正文插图](figure.png)\n\n![下一图](next.png)';
    const index=M.getSourceIndex(source,opts);
    assert.deepEqual(index.blocks.filter(block=>block.caption).map(block=>block.caption.num),['1','2']);
    assert.deepEqual(index.blocks.flatMap(block=>M.captionTargets(block,source)).map(target=>target.title),['正文插图','下一图']);
});

test('同块多图及媒体混排：每张普通图片独立图号与源行，后续接续', () => {
    const source='![一](one.png) ![音频](a.mp3) ![图标](icon.svg#icon)\n![二](two.png)\n\n![三](three.png)';
    const index=M.getSourceIndex(source,opts);
    assert.deepEqual(index.blocks.flatMap(block=>M.captionTargets(block,source)).map(target=>[target.title,target.num,target.line]),[['一','1',0],['二','2',1],['音频','1',0],['三','3',3]]);
    assert.equal(M.hasSourceAnchor(index,'二'),true);
});

test('kbd 按钮内图片不占图号，大小写和嵌套按钮均排除', () => {
    const source='按钮 <kbd>![按钮图](button.png)</kbd> 正文 ![正文一](one.png)\n\n<KBD><kbd>![嵌套按钮](nested.svg)</kbd></KBD> ![正文二](two.png)\n\n![正文三](three.png)';
    const index=M.getSourceIndex(source,opts);
    assert.deepEqual(index.blocks.flatMap(block=>M.captionTargets(block,source)).map(target=>[target.title,target.num]),[['正文一','1'],['正文二','2'],['正文三','3']]);
    assert.equal(M.hasSourceAnchor(index,'按钮图'),false);assert.equal(M.hasSourceAnchor(index,'嵌套按钮'),false);
});

test('HTML 普通图片与 Markdown 图共用编号、实体锚点和源行', () => {
    const source='![前图](first.png) <img src="second.png" alt="HTML &amp; 二">\n\n<p><img src="third.png" alt="HTML 三"><kbd><img src="button.png" alt="按钮"></kbd></p>\n\n![后图](after.png)';
    const index=M.getSourceIndex(source,opts);
    assert.deepEqual(index.blocks.flatMap(block=>M.captionTargets(block,source)).map(target=>[target.title,target.num,target.line]),[['前图','1',0],['HTML & 二','2',0],['HTML 三','3',2],['后图','4',4]]);
    assert.equal(M.hasSourceAnchor(index,'HTML & 二'),true);assert.equal(M.hasSourceAnchor(index,'按钮'),false);
});

test('HTML 图片排除注释、原始文本、属性伪标签与专用版式', () => {
    const source='<div data-example="<img src=\'fake.png\' alt=\'属性示例\'>">\n<!-- <img src="comment.png" alt="注释"> -->\n<script>const example="<img src=\'fake.png\'>";</script>\n<img src="icon.svg#icon" alt="图标">\n<img src="real.png" alt="真实图片">\n</div>\n\n![后图](next.png)';
    const index=M.getSourceIndex(source,opts);
    assert.deepEqual(index.blocks.flatMap(block=>M.captionTargets(block,source)).map(target=>[target.title,target.num]),[['真实图片','1'],['后图','2']]);
});

test('原版浏览器六图对照：HTML / Markdown 混排按章编号且图标排除', () => {
    const source=readFileSync(new URL('./fixtures/figure-grouping.md',import.meta.url),'utf8');
    const index=M.getSourceIndex(source,{...opts,captionGroup:true,headerTemplate:'h1{{###. }}'});
    assert.deepEqual(index.blocks.flatMap(block=>M.captionTargets(block,source)).map(target=>[target.title,target.num]),[['Markdown 一','1-1'],['HTML 二','1-2'],['Markdown 三','1-3'],['HTML 四','2-1'],['Markdown 五','2-2'],['HTML 六','2-3']]);
});

test('前置题注可分配给图文混排段落的首张无 alt 图片', () => {
    const source='*==图文题注_补充说明_==*\n\n说明 ![](one.png) ![自带题注](two.png)\n\n![后图](after.png)';
    const index=M.getSourceIndex(source,opts),block=index.blocks[1];
    assert.equal(index.blocks[0].captionFor,1);
    assert.equal(block.figureCaptions[0].cap1,'图文题注');assert.equal(block.figureCaptions[0].cap2,'补充说明');
    assert.equal(block.figureCaptions[1].cap1,undefined);
    assert.deepEqual(index.blocks.flatMap(block=>M.captionTargets(block,source)).map(target=>[target.title,target.num]),[['图文题注','1'],['自带题注','2'],['后图','3']]);
});

test('图片自带 alt 时前置段落不被消费或隐藏', () => {
    const source='*==保留段落==*\n\n![自带题注](one.png) ![](two.png)';
    const index=M.getSourceIndex(source,opts);
    assert.equal(index.blocks[0].captionFor,undefined);
    assert.equal(index.blocks[1].figureCaptions[0].cap1,undefined);
    assert.deepEqual(index.blocks.flatMap(block=>M.captionTargets(block,source)).map(target=>target.title),['自带题注']);
});

test('完整预览与导出预处理前置图片双题注，保留后图自带题注', () => {
    const root=html('<p><em><mark>主标题<em>补充说明</em></mark></em></p><p>文字<img src="a.png"><img src="b.png" alt="自带"></p>');
    M.toTyporaDom(root,true);
    const images=root.querySelectorAll('img');assert.equal(images[0].alt,'主标题');assert.equal(images[0].title,'补充说明');assert.equal(images[1].alt,'自带');
    assert.equal(root.querySelector('em mark'),null);
    M.toTyporaDom(root,true);assert.equal(images[0].alt,'主标题');
    const explicit=html('<p><em><mark>保留段落</mark></em></p><p><img src="a.png" alt="自带"></p>');M.toTyporaDom(explicit,true);
    assert.equal(explicit.querySelector('em mark').textContent,'保留段落');
});

test('前置题注按图像与媒体源序分配，不固定给媒体类型', () => {
    for(const [body,expected] of [['![](one.png) ![](a.mp3)','figure'],['![](a.mp3) ![](one.png)','media']]){
        const source='*==混排标题==*\n\n'+body,index=M.getSourceIndex(source,opts),block=index.blocks[1];
        assert.equal(index.blocks[0].captionFor,1);
        const captions=[...block.figureCaptions,...block.mediaCaptions].filter(info=>info.cap1);
        assert.equal(captions.length,1);assert.equal(captions[0].kind,expected);
        assert.equal(M.hasSourceAnchor(index,'混排标题'),true);
    }
    const explicit=M.getSourceIndex('*==保留文字==*\n\n文字 <audio src="a.mp3" alt="自带音频"></audio> ![](one.png)',opts);
    assert.equal(explicit.blocks[0].captionFor,undefined);
});

test('导出混排前置题注按首个标准内容分配，跳过迷你与普通 iframe', () => {
    for(const [body,tag] of [['<img src="one.png"><img src="a.mp3">','IMG'],['<audio src="a.mp3"></audio><img src="one.png">','IMG']]){
        const root=html('<p><em><mark>混排标题</mark></em></p><p>'+body+'</p>');M.toTyporaDom(root,true);
        const assigned=root.querySelectorAll('[alt="混排标题"]');assert.equal(assigned.length,1);assert.equal(assigned[0].tagName,tag);
        assert.equal(root.querySelector('em mark'),null);
    }
    const skip=html('<p><em><mark>标准标题</mark></em></p><p><img src="mini.mp3?controls=mini"><iframe src="manual.html"></iframe><img src="standard.png"></p>');M.toTyporaDom(skip,true);
    assert.equal(skip.querySelector('img[src="standard.png"]').alt,'标准标题');assert.equal(skip.querySelector('img[src^="mini"]').alt,'');
});

test('原生音视频前置题注与 Typora 一致保留为段落', () => {
    for(const body of ['<audio src="a.wav"></audio>','<video src="v.mp4"></video>']){
        const root=html('<p><em><mark>原生标题</mark></em></p>'+body);M.toTyporaDom(root,true);
        assert.equal(root.querySelector('audio,video').hasAttribute('alt'),false);assert.notEqual(root.querySelector('em mark'),null);
    }
});

test('独立 HTML 图片容器和 iframe 前置题注可进入完整预览导出', () => {
    for(const body of ['<div><img src="a.png"></div>','<iframe src="https://www.youtube.com/embed/example"></iframe>']){
        const root=html('<p><em><mark>原生标题<em>副题注</em></mark></em></p>'+body);M.toTyporaDom(root,true);
        const target=root.querySelector('img,audio,video,iframe');assert.equal(target.getAttribute('alt'),'原生标题');assert.equal(target.title,'副题注');
        assert.equal(root.querySelector('em mark'),null);
    }
});

test('前置题注不跨进 HTML 表格、列表与引用的子图片', () => {
    for(const body of ['<div><table><tr><td><img src="a.png"></td></tr></table></div>','<div><ul><li><img src="a.png"></li></ul></div>','<div><blockquote><img src="a.png"></blockquote></div>']){
        const root=html('<p><em><mark>保留结构题注</mark></em></p>'+body);M.toTyporaDom(root,true);
        assert.equal(root.querySelector('img').getAttribute('alt'),null);
        assert.ok(root.querySelector('em mark'));
    }
});

test('引用与列表内部前置题注定位同容器下一段，不跨列表项', () => {
    const source='> *==引用题注_引用说明_==*\n>\n> ![](a.png)\n\n- *==列表题注==*\n\n  ![](b.mp3)\n\n- *==不能跨项==*\n- ![](c.png)';
    const index=M.getSourceIndex(source,opts);
    assert.deepEqual(index.blocks.flatMap(block=>M.captionTargets(block,source)).map(target=>[target.title,target.num]),[['引用题注','1'],['列表题注','1']]);
    assert.equal(M.hasSourceAnchor(index,'不能跨项'),false);
    assert.equal(index.blocks[0].figureCaptions[0].cap2,'引用说明');
});

test('全文内容索引逐项收录同块图片、音视频和表内媒体，保留具体行', () => {
    const source='![图一](a.png) ![音频](a.mp3)\n![图二](b.png)\n\n|内容|\n|---|\n|![表内视频](v.mp4)|\n\n> ![引用图片](c.png)';
    const items=M.sourceContentItems(M.getSourceIndex(source,opts));
    assert.deepEqual(items.map(item=>[item.kind,item.title,item.line??item.block.start]),[['插图','图一',0],['多媒体','音频',0],['插图','图二',1],['表格','表格 · 第 4 行',3],['多媒体','表内视频',5],['插图','引用图片',7]]);
    assert.deepEqual(items.slice(0,3).map(item=>item.target),[{kind:'figure',index:0},{kind:'media',index:0},{kind:'figure',index:1}]);
});

test('笔记、画布和数据库嵌入不消耗插图号', () => {
    const source='![[note.md]]\n\n![[board.canvas]]\n\n![[data.base]]\n\n![插图](a.png)';
    const index=M.getSourceIndex(source,opts);
    assert.deepEqual(index.blocks.filter(block=>block.caption).map(block=>block.caption.num),['1']);
    assert.deepEqual(M.sourceContentItems(index).map(item=>item.title),['插图']);
});

test('实时预览覆盖图文混排、原生 HTML 与列表内的逐对象媒体', () => {
    const source='文字 ![一](one.png) ![二](two.png)\n\n<div><audio src="a.wav" alt="音频"></audio><img src="three.png" alt="三"></div>\n\n- ![列表视频](v.mp4)';
    const index=M.getSourceIndex(source,opts),plans=M.blockPreviewPlans(index,M.DEFAULT_SETTINGS);
    assert.deepEqual(plans.map(plan=>plan.blocks[0].type),['paragraph','html','list']);
    assert.deepEqual(plans.map(plan=>[plan.start,plan.end]),[[0,0],[2,2],[4,4]]);
    const disabled=M.blockPreviewPlans(index,{...M.DEFAULT_SETTINGS,captions:false});
    assert.equal(disabled.length,3,'关闭题注后仍能预览图片和播放器');
});

test('前置题注与混排内容在实时预览中组成同一个可编辑区块', () => {
    const source='*==混排题注==*\n\n说明 ![](a.png) ![声音](a.mp3)\n\n普通段落';
    const index=M.getSourceIndex(source,opts),plans=M.blockPreviewPlans(index,M.DEFAULT_SETTINGS);
    assert.equal(plans.length,1);assert.deepEqual([plans[0].start,plans[0].end],[0,2]);
    assert.deepEqual(plans[0].blocks.map(block=>block.start),[0,2]);
});

test('混排媒体实时预览进入选区恢复源码，离开后重新生成预览', () => {
    const doc='前言\n\n文字 ![](one.png) ![](sound.mp3)\n\n<div><img src="two.png"></div>\n\n- ![](clip.mp4)';
    const field=M.blockPreviewExtension({settings:{...M.DEFAULT_SETTINGS}});
    let state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
    assert.equal(state.field(field).size,3);
    for(const needle of ['文字','<div>','- !']){
        state=state.update({selection:{anchor:doc.indexOf(needle)}}).state;assert.equal(state.field(field).size,2);
        state=state.update({selection:{anchor:0}}).state;assert.equal(state.field(field).size,3);
    }
});

test('行内迷你音频进入实时预览，但不生成标准媒体题注编号', () => {
    const source='文字 ![迷你](a.mp3?controls=mini)\n\n<div><img src="b.wav?controls=mini" alt="HTML迷你"></div>\n\n- ![列表迷你](c.ogg?controls=mini)\n\n`![代码示例](fake.mp3?controls=mini)`';
    const index=M.getSourceIndex(source,opts),plans=M.blockPreviewPlans(index,M.DEFAULT_SETTINGS);
    assert.deepEqual(plans.map(plan=>plan.blocks[0].type),['paragraph','html','list']);
    assert.ok(index.blocks.every(block=>!block.mediaCaptions?.length&&!block.caption));
    assert.equal(M.blockPreviewPlans(index,{...M.DEFAULT_SETTINGS,captions:false}).length,3);
});

test('真实编辑 Widget 生成迷你音频，销毁后暂停并解除控件事件', async () => {
    const oldRender=M.MarkdownRenderer.render;let widget,dom,plays=0,pauses=0;
    try{
        M.MarkdownRenderer.render=async(_app,_source,el)=>{el.innerHTML='<p>文字 <img src="a.mp3?controls=mini"></p>';};
        const field=M.blockPreviewExtension({settings:{...M.DEFAULT_SETTINGS},app:{}}),doc='前言\n\n文字 ![](a.mp3?controls=mini)';
        const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
        state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)widget=deco.spec.widget});
        assert.ok(widget);dom=widget.toDOM({requestMeasure(){},dispatch(){},focus(){}});
        await new Promise(resolve=>setTimeout(resolve,0));
        const audio=dom.querySelector('audio'),control=dom.querySelector('.v-audio-mini-control');assert.ok(audio&&control);
        audio.play=async()=>{plays++};audio.pause=()=>{pauses++};
        audio.dispatchEvent(new window.Event('canplay'));control.click();assert.equal(plays,1);
        widget.destroy(dom);assert.equal(pauses,1);assert.equal(control.dataset.vlookAudioState,'unloaded');
        audio.dispatchEvent(new window.Event('canplay'));control.click();assert.equal(plays,1);assert.equal(control.dataset.vlookAudioState,'unloaded');
    }finally{if(dom)widget?.destroy(dom);M.MarkdownRenderer.render=oldRender;}
});

test('编辑 Widget 销毁后迟到的原生媒体被暂停并移除', async () => {
    const original=M.MarkdownRenderer.render;let widget,dom,finish,pauses=0;
    const gate=new Promise(resolve=>{finish=resolve});
    try{
        M.MarkdownRenderer.render=async(_app,_source,el)=>{await gate;el.innerHTML='<audio src="late.wav" autoplay></audio>';el.querySelector('audio').pause=()=>{pauses++};};
        const field=M.blockPreviewExtension({settings:{...M.DEFAULT_SETTINGS},app:{}}),doc='前言\n\n文字 ![](late.wav)';
        const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
        state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)widget=deco.spec.widget});
        dom=widget.toDOM({requestMeasure(){},dispatch(){},focus(){}});widget.destroy(dom);finish();
        await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(pauses,1);assert.equal(dom.querySelector('audio'),null);
    }finally{finish();if(dom)widget?.destroy(dom);M.MarkdownRenderer.render=original;}
});

test('导出等待不能把消失的图表或公式误判为渲染完成', async () => {
    const diagram=html('<div class="mermaid">flowchart LR</div>');
    const diagramReady=M.waitForDiagrams(diagram,30,1);diagram.replaceChildren();
    await assert.rejects(diagramReady,/1 个未完成/);
    const math=html('<span class="math math-inline">x</span>');
    const mathReady=M.waitForMath(math,30,1);math.replaceChildren();
    await assert.rejects(mathReady,/1 个未完成/);
});

test('异步替换图表或公式容器后，数量完整且真实输出就绪才通过', async () => {
    const diagrams=html('<div class="mermaid">一</div><div class="mermaid">二</div>');
    const ready=M.waitForDiagrams(diagrams,500,1);
    diagrams.innerHTML='<pre class="mermaid"><svg></svg></pre><div class="mermaid"><svg></svg></div>';
    await ready;
    const formulas=html('<span class="math math-inline">x</span>');
    const mathReady=M.waitForMath(formulas,500,1);
    formulas.innerHTML='<span class="math math-inline"><mjx-container><svg></svg></mjx-container></span>';
    await mathReady;
    const partial=html('<div class="mermaid">一</div><div class="mermaid">二</div>');
    const incomplete=M.waitForDiagrams(partial,30,1);partial.innerHTML='<div class="mermaid"><svg></svg></div>';
    await assert.rejects(incomplete,/1 个未完成/);
});

test('源码图表数量覆盖引用和列表围栏，不把代码中的围栏示例重复计入', () => {
    const source='```mermaid\nflowchart LR\n```\n\n> ```mermaid\n> sequenceDiagram\n> ```\n\n- 图表\n\n  ```mermaid\n  pie\n  ```\n\n````markdown\n```mermaid\n示例\n```\n````';
    assert.equal(M.sourceDiagramCount(source),3);
});

test('宿主未生成图表容器时也必须按源码数量拒绝缺图导出', async () => {
    await assert.rejects(M.waitForDiagrams(html('<p>没有任何容器</p>'),25,1,1),/1 个未完成/);
    await assert.rejects(M.waitForDiagrams(html('<div class="mermaid"><svg></svg></div>'),25,1,2),/1 个未完成/);
    const root=html('<p>等待宿主容器</p>'),ready=M.waitForDiagrams(root,500,1,1);
    root.innerHTML='<div class="mermaid"><svg></svg></div>';await ready;
});

test('图表与公式等待可随组件生命周期取消', async () => {
    const controller=new window.AbortController();
    const diagram=M.waitForDiagrams(html('<div class="mermaid"></div>'),10000,100,1,controller.signal);
    const math=M.waitForMath(html('<span class="math math-inline">x</span>'),10000,100,controller.signal);
    controller.abort();
    await assert.rejects(diagram,error=>error.name==='AbortError');await assert.rejects(math,error=>error.name==='AbortError');
});

test('编辑 Widget 等异步 SVG 后才生成图表题注和内容助手', {timeout:2000}, async () => {
    const original=M.MarkdownRenderer.render;let widget,dom,complete;
    const measured=new Promise(resolve=>{complete=resolve});
    try{
        M.MarkdownRenderer.render=async(_app,source,el)=>{
            if(source.includes('```mermaid')){el.innerHTML='<div class="mermaid"></div>';setTimeout(()=>{el.querySelector('.mermaid')?.insertAdjacentHTML('beforeend','<svg><text>真实输出</text></svg>');},5);}
            else el.innerHTML='<p><em><mark>异步图表</mark></em></p>';
        };
        const field=M.blockPreviewExtension({settings:{...M.DEFAULT_SETTINGS},app:{}}),doc='前言\n\n*==异步图表==*\n\n```mermaid\nflowchart LR\nA-->B\n```';
        const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
        state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)widget=deco.spec.widget});
        dom=widget.toDOM({requestMeasure(){complete()},dispatch(){},focus(){}});
        await measured;assert.ok(dom.querySelector('.mermaid svg'));assert.match(dom.querySelector('.v-cap-1').textContent,/异步图表/);assert.ok(dom.querySelector('.vlook-content-tools'));
    }finally{if(dom)widget?.destroy(dom);M.MarkdownRenderer.render=original;}
});

test('原生幻灯片等待迟到 SVG 后生成图表题注，切页取消未完成等待', {timeout:3000}, async () => {
    const proto=window.HTMLDialogElement.prototype,show=proto.showModal,close=proto.close,oldRender=M.MarkdownRenderer.render;
    proto.showModal=function(){this.open=true};proto.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'))};
    const content=html('<div class="markdown-preview-view"></div>');document.body.append(content);
    const source='# 图表页\n\n*==幻灯片图表==*\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n# 末页\n\n结束';
    const view={file:{path:'slides.md'},contentEl:content,getMode:()=> 'preview',editor:{getValue:()=>source}},bus={on:()=>({}),offref(){}};
    const slides=new M.NativeSlides({app:{workspace:{...bus,getActiveViewOfType:()=>view},vault:bus},settings:{...M.DEFAULT_SETTINGS}});
    try{
        M.MarkdownRenderer.render=async(_app,raw,el)=>{if(raw.includes('```mermaid')){el.innerHTML='<div class="mermaid"></div>';setTimeout(()=>el.querySelector('.mermaid')?.insertAdjacentHTML('beforeend','<svg><text>完成</text></svg>'),5);}else if(raw.includes('*=='))el.innerHTML='<p><em><mark>幻灯片图表</mark></em></p>';else el.textContent=raw;};
        slides.toggle();await new Promise(resolve=>setTimeout(resolve,180));
        let dialog=document.querySelector('.vlook-native-slides');assert.match(dialog.querySelector('.v-cap-1').textContent,/幻灯片图表/);
        slides.close();
        M.MarkdownRenderer.render=async(_app,raw,el)=>{el.innerHTML=raw.includes('```mermaid')?'<div class="mermaid"></div>':'<p>正文</p>';};
        slides.toggle();await new Promise(resolve=>setTimeout(resolve,0));dialog=document.querySelector('.vlook-native-slides');
        dialog.querySelectorAll('button')[1].click();await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(dropdown(dialog,0).value,'1');assert.doesNotMatch(dialog.querySelector('[role=status]').textContent,/失败/);
    }finally{slides.close();content.remove();proto.showModal=show;proto.close=close;M.MarkdownRenderer.render=oldRender;}
});

test('远程锚点检查使用文档所在窗口打开，主窗口不接管弹出窗口请求', async () => {
    const {JSDOM}=await import('jsdom');
    const other=new JSDOM('<main></main>');
    const calls=[],mainCalls=[],original=window.open;
    window.open=(...args)=>{mainCalls.push(args);return null};
    other.window.open=(...args)=>{calls.push(args);return null};
    const source='[查看](https://example.org/a.html#章节)';
    const group={document:'https://example.org/a.html',links:[],anchors:[{hash:'章节',count:1}]};
    const view={app:{},file:{path:'a.md'},contentEl:other.window.document.querySelector('main'),editor:{getValue:()=>source}};
    try {
        new M.RemoteAnchorModal(view,source,[group]).onChooseItem(group);
        assert.equal(mainCalls.length,0);assert.equal(calls.length,1);
        assert.equal(new URL(calls[0][0]).searchParams.get('hash1'),'章节');
        assert.deepEqual(calls[0].slice(1),['_blank','noopener,noreferrer']);
    } finally {window.open=original;other.window.close();}
});

test('文库导航外链归属来源窗口，配置删除或替换后不打开旧目标', async () => {
    const {JSDOM}=await import('jsdom');const other=new JSDOM('<main></main>');
    const calls=[],internal=[];
    other.window.open=(...args)=>{calls.push(args);return null};
    const external={title:'文库',href:'https://example.org/manual.html',description:'说明'};
    const local={title:'本地',href:'next.html#章节',description:''};
    let items=[external,local];
    const app={workspace:{openLinkText:(...args)=>internal.push(args)},metadataCache:{getFirstLinkpathDest:(path,source)=>path==='next.md'&&source==='docs/current.md'?{path:'docs/next.md',extension:'md'}:null}};
    try {
        const modal=new M.DocumentLibraryModal({app},'docs/current.md',items,()=>items,other.window.document);
        modal.onChooseItem(external);assert.equal(calls.length,1);assert.deepEqual(calls[0],[external.href,'_blank','noopener,noreferrer']);
        modal.onChooseItem(local);assert.deepEqual(internal,[['docs/next.md#章节','',false]]);
        items=[{...external,href:'https://example.org/new.html'}];
        modal.onChooseItem(external);modal.onChooseItem(local);
        assert.equal(calls.length,1);assert.equal(internal.length,1);
        items=[];modal.onChooseItem(external);assert.equal(calls.length,1);
    } finally {other.window.close();}
});

test('脚注内图表与公式围栏参与导出完整性检查，外层代码示例不递归',()=>{
    const source='正文[^n]\n\n[^n]: 注释\n\n    ```mermaid\n    flowchart LR\n    A --> B\n    ```\n\n    ```math\n    x^2\n    ```\n\n    ````markdown\n    ```mermaid\n    只是示例\n    ```\n    ````\n\n普通正文\n\n    ```mermaid\n    普通缩进代码\n    ```';
    assert.equal(M.sourceDiagramCount(source),1);
    assert.equal(M.sourceMathFenceCount(source),1);
});

test('多段脚注保留嵌套图表和列表，幻灯片不会把续段拆成正文卡片',()=>{
    const definition='[^nested]: 注释\n\n    第二段\n\n    ```mermaid\n    zenuml\n    Alice -> Bob: Footnote\n    ```\n\n\t- 项目';
    const source='# 正文\n\n引用[^nested]\n\n'+definition+'\n\n后续正文\n\n[^next]: 第二条';
    const index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true});
    const footnotes=index.blocks.filter(block=>/^\[\^/.test(block.text));
    assert.equal(footnotes.length,2);assert.equal(footnotes[0].text,definition);
    const groups=M.slideGroups(index),group=groups.find(item=>item.kind==='footnotes');
    assert.equal(group.blocks.length,2);assert.equal(group.blocks[0].text,definition);
    const body=groups.filter(item=>item.kind!=='footnotes').flatMap(item=>item.blocks).map(block=>block.text).join('\n');
    assert.match(body,/后续正文/);assert.doesNotMatch(body,/Footnote|第二段|项目/);
    const joined=group.blocks.map(block=>block.text).join('\n\n');
    assert.equal(M.sourceDiagramCount(joined),0);
    M.setZenUmlEnabled(true);
    try{assert.equal(M.sourceDiagramCount(joined),1);}finally{M.setZenUmlEnabled(false);}
});

test('链接地图和锚点审计包含脚注续段中的真实链接与锚点，排除围栏示例',()=>{
    const source='正文[^n]\n\n[^n]: 注释\n\n    [目标](target.md#标题)\n\n    [[other.md|另一文档]]\n\n    <a href="html.md">HTML链接</a>\n\n    <span id="footnote-anchor">真实锚点</span>\n\n    段落 ^footnote-block\n\n    ```markdown\n    [假链接](fake.md)\n    <span id="fake-anchor"></span>\n    假段落 ^fake-block\n    ```';
    const index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true});
    const links=M.sourceLinks(index);
    assert.deepEqual(links.map(link=>link.href),['target.md#标题','other.md','html.md']);
    assert.equal(links[0].line,source.split('\n').findIndex(line=>line.includes('[目标]')));
    assert.equal(M.hasSourceAnchor(index,'footnote-anchor'),true);
    assert.equal(M.hasSourceAnchor(index,'^footnote-block'),true);
    assert.equal(M.hasSourceAnchor(index,'fake-anchor'),false);
    assert.equal(M.hasSourceAnchor(index,'^fake-block'),false);
});

test('MathJax CSSOM 中迟到的字符规则必须导出，即使文本样式与引擎快照仍旧',async()=>{
    const style=document.createElement('style');style.id='MJX-CHTML-styles';style.textContent='mjx-container { display: block }';document.head.append(style);
    style.sheet.insertRule('mjx-c.mjx-c1D438 { padding: 0.68em 0.76em 0 0; }',style.sheet.cssRules.length);
    style.sheet.insertRule('mjx-c.mjx-c1D45A { padding: 0.44em 0.88em 0 0; }',style.sheet.cssRules.length);
    const previous=window.MathJax;window.MathJax={chtmlStylesheet:()=>{const old=document.createElement('style');old.textContent='mjx-container { display: block }';return old;}};
    try{
        assert.ok(!style.textContent.includes('mjx-c1D438'));
        const root=html('<mjx-container jax="CHTML"><mjx-math><mjx-c class="mjx-c1D438">E</mjx-c><mjx-c class="mjx-c1D45A">m</mjx-c></mjx-math></mjx-container>');
        const css=await M.collectMathStyles(root);assert.match(css,/mjx-c1D438/);assert.match(css,/mjx-c1D45A/);
    }finally{style.remove();window.MathJax=previous;}
});

test('公式包含尚未提供字符规则时拒绝输出缺字 HTML',async()=>{
    const style=document.createElement('style');style.id='MJX-CHTML-styles';style.textContent='mjx-container { display: block }';document.head.append(style);
    try{await assert.rejects(M.collectMathStyles(html('<mjx-container jax="CHTML"><mjx-c class="mjx-c1D438">E</mjx-c></mjx-container>')),/字形样式尚未就绪.*mjx-c1D438/);}
    finally{style.remove();}
});

test('顶部路径默认只保留最近目录，根目录不重复标题',()=>{
    assert.equal(M.compactPath('Users/name/project/docs/说明.md'),'… / docs /');
    assert.equal(M.compactPath('docs/说明.md'),'docs /');
    assert.equal(M.compactPath('说明.md'),'');
});
test('页面字体设置共用安全配色覆盖，不插入任意 CSS',()=>{
    assert.equal(M.typographyCss(undefined,undefined),'');
    assert.match(M.typographyCss('serif',18),/Georgia/);
    assert.match(M.typographyCss('sans',100),/font-size:32px/);
    assert.equal(M.typographyCss(undefined,undefined,0),'');
    assert.match(M.typographyCss(undefined,undefined,1000),/--file-line-width:1000px.*sizer.*max-width:1000px/);
    assert.match(M.typographyCss(undefined,undefined,100),/--file-line-width:480px/);
    assert.match(M.typographyCss(undefined,undefined,9999),/--file-line-width:2400px/);
    assert.equal(M.typographyCss('bad;}body{color:red',0),'');
    assert.doesNotMatch(M.typographyCss('theme',0),/font-size/);
    assert.doesNotMatch(M.typographyCss('sans',0),/font-size/);
});

test('每次导出都确认完整目标路径，取消不代表确认',async()=>{
    const plugin={app:{vault:{adapter:{getBasePath:()=>'/试用库'}}}};
    const first=M.confirmExportPath(plugin,'目录/示例.html');
    assert.ok(document.body.textContent.includes('/试用库/目录/示例.html'));
    Array.from(document.body.querySelectorAll('button')).find(b=>b.textContent==='取消').click();
    assert.equal(await first,null);
    const second=M.confirmExportPath(plugin,'目录/示例.html');
    Array.from(document.body.querySelectorAll('button')).find(b=>b.textContent==='确认导出').click();
    assert.equal(await second,'目录/示例.html');
});

test('导出可改选库内文件夹，路径实时更新并按新位置返回',async()=>{
    const folders=[{path:'/',isRoot:()=>true},{path:'发布/网页',isRoot:()=>false}];
    for(const folder of folders)Object.setPrototypeOf(folder,M.TFolder.prototype);
    const plugin={app:{vault:{adapter:{getBasePath:()=>'/库'},getAllLoadedFiles:()=>[...folders,{path:'a.md'}]}}};
    const pending=M.confirmExportPath(plugin,'目录/示例.html');
    Array.from(document.body.querySelectorAll('button')).find(b=>b.textContent==='更改位置').click();
    const picker=M.FuzzySuggestModal.last;assert.deepEqual(picker.getItems().map(f=>picker.getItemText(f)),['/','发布/网页']);
    picker.onChooseItem(folders[1]);assert.ok(document.body.textContent.includes('/库/发布/网页/示例.html'));
    picker.onChooseItem(folders[0]);assert.ok(document.body.textContent.includes('/库/示例.html'));
    Array.from(document.body.querySelectorAll('button')).find(b=>b.textContent==='确认导出').click();
    assert.equal(await pending,'示例.html');
});

test('区块不显示编辑按钮，双击进入源码，交互控件与卸载区块不触发编辑',async()=>{
    const original=M.MarkdownRenderer.render;let widget,dom;
    try{
        M.MarkdownRenderer.render=async(_app,_source,el)=>{el.innerHTML='<blockquote><p>正文</p><a href="#x">链接</a><button>操作</button><input type="checkbox"></blockquote>';};
        const field=M.blockPreviewExtension({settings:{...M.DEFAULT_SETTINGS},app:{}});
        const state=M.EditorState.create({doc:'前言\n\n> 正文',extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
        state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)widget=deco.spec.widget;});
        const calls=[];let focused=0;
        dom=widget.toDOM({state,requestMeasure(){},dispatch(tr){calls.push(tr)},focus(){focused++}});
        await new Promise(resolve=>setTimeout(resolve,0));
        const editor=document.createElement('div');editor.setAttribute('contenteditable','true');editor.append(dom);document.body.append(editor);
        for(const selector of ['a','button','input'])dom.querySelector(selector).dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true,cancelable:true}));
        assert.equal(calls.length,0);
        dom.querySelector('p').dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true,cancelable:true}));
        assert.equal(calls.length,1);assert.equal(calls[0].selection.anchor,state.doc.line(3).from);assert.equal(focused,1);
        dom.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(calls.length,2);
        widget.destroy(dom);dom.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true,cancelable:true}));assert.equal(calls.length,2);editor.remove();
    }finally{if(dom)widget?.destroy(dom);M.MarkdownRenderer.render=original;}
});

test('插件重载不能复用旧实例的区块事件和生命周期',()=>{
    const make=()=>{
        const field=M.blockPreviewExtension({settings:{...M.DEFAULT_SETTINGS},app:{}});
        const state=M.EditorState.create({doc:'前言\n\n> 引用',extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
        let widget;state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)widget=deco.spec.widget;});return widget;
    };
    const old=make(),fresh=make();assert.equal(old.eq(fresh),false);assert.equal(fresh.eq(fresh),true);
});

test('顶部五组自定义菜单不使用系统下拉，切换、关闭与卸载正确',async()=>{
    const actions=[];let selected='a';const menus=['编辑 / 阅读','明暗','主题','字体','导出'].map((label,i)=>({id:String(i),label,icon:'x',selected:()=>selected,choices:()=>[{label:'甲',value:'a'},{label:'乙',value:'b'}],choose:value=>{actions.push(value);selected=value;}}));
    const toolbar=M.createHeaderToolbar(document,menus);document.body.append(toolbar.element);
    try{
        assert.equal(toolbar.element.querySelectorAll('button').length,5);
        toolbar.element.querySelector('button').click();
        let panel=document.querySelector('.vlook-header-menu');assert.ok(panel);assert.equal(panel.querySelector('select'),null);assert.equal(panel.querySelector('[aria-checked=true]').textContent,'甲');
        panel.querySelectorAll('button')[1].click();assert.deepEqual(actions,['b']);assert.equal(document.querySelector('.vlook-header-menu'),null);
        toolbar.element.querySelectorAll('button')[2].click();panel=document.querySelector('.vlook-header-menu');assert.equal(panel.querySelector('[aria-checked=true]').textContent,'乙');
        panel.querySelector('button').focus();panel.querySelector('button').dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert.equal(document.activeElement,panel.querySelectorAll('button')[1]);
        document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(document.querySelector('.vlook-header-menu'),null);
        toolbar.element.querySelectorAll('button')[3].click();document.body.dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true}));assert.equal(document.querySelector('.vlook-header-menu'),null);
        toolbar.element.querySelectorAll('button')[4].click();toolbar.dispose();assert.equal(document.querySelector('.vlook-header-menu'),null);assert.equal(toolbar.element.isConnected,false);
    }finally{toolbar.dispose();}
});

test('PDF路径提示直接写入位置，取消不启动打印',async()=>{
    const promise=M.confirmExportPath({app:{vault:{adapter:{getBasePath:()=>'/演示库'}}}},'示例.pdf','PDF');
    assert.ok(document.body.textContent.includes('/演示库/示例.pdf'));assert.ok(document.body.textContent.includes('已有同名 PDF 将被替换'));
    Array.from(document.body.querySelectorAll('button')).find(b=>b.textContent==='取消').click();assert.equal(await promise,null);
});

test('字体菜单按字体和字号分别勾选，重开后保留两组选中状态',()=>{
    let font='sans',size=18;
    const toolbar=M.createHeaderToolbar(document,[{id:'font',label:'字体',icon:'type',selected:()=>[`font:${font}`,`size:${size}`],choices:()=>[{label:'无衬线',value:'font:sans',group:'正文字体'},{label:'衬线',value:'font:serif',group:'正文字体'},{label:'18 px',value:'size:18',group:'正文字号'},{label:'20 px',value:'size:20',group:'正文字号'}],choose:value=>{const [kind,data]=value.split(':');if(kind==='font')font=data;else size=Number(data);}}]);
    document.body.append(toolbar.element);
    try{
        toolbar.element.querySelector('button').click();let panel=document.querySelector('.vlook-header-menu');
        assert.equal(panel.querySelectorAll('[role=group]').length,2);
        assert.equal(panel.querySelectorAll('[aria-checked=true]').length,2);
        assert.equal(panel.querySelectorAll('[role=group]')[0].querySelector('[aria-checked=true]').textContent,'无衬线');
        assert.equal(panel.querySelectorAll('[role=group]')[1].querySelector('[aria-checked=true]').textContent,'18 px');
        panel.querySelectorAll('button')[3].click();assert.equal(size,20);assert.equal(font,'sans');
        toolbar.element.querySelector('button').click();panel=document.querySelector('.vlook-header-menu');
        assert.equal(panel.querySelectorAll('[aria-checked=true]').length,2);
        assert.equal(panel.querySelectorAll('[role=group]')[1].querySelector('[aria-checked=true]').textContent,'20 px');
    }finally{toolbar.dispose();}
});

test('页面设置损坏或旧数据不输出无效字体及空字号覆盖',()=>{
    for(const font of ['constructor','toString','__proto__','bad'])assert.equal(M.typographyCss(font,0),'');
    for(const size of [NaN,Infinity,-2,'18px',{}])assert.equal(M.typographyCss('theme',size),'');
    assert.match(M.typographyCss('sans',18),/font-size:18px/);
});
test('顶部五组菜单支持左右循环与Home/End定位',()=>{
    const toolbar=M.createHeaderToolbar(document,['模式','明暗','主题','字体','导出'].map(label=>({id:label,label,icon:'x',selected:()=>'',choices:()=>[],choose:()=>{}})));
    document.body.append(toolbar.element);const buttons=toolbar.element.querySelectorAll('button');
    try{
        buttons[0].focus();buttons[0].dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));assert.equal(document.activeElement,buttons[4]);
        buttons[4].dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(document.activeElement,buttons[0]);
        buttons[0].dispatchEvent(new window.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));assert.equal(document.activeElement,buttons[4]);
        buttons[4].dispatchEvent(new window.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));assert.equal(document.activeElement,buttons[0]);
    }finally{toolbar.dispose();}
});

test('PDF快照去掉脚本，写回CSSOM规则并保留勾选状态',()=>{
    const frame=document.createElement('iframe');document.body.append(frame);
    try{
        const doc=frame.contentDocument;
        doc.open();doc.write('<html><head><style id="m"></style><script>x()</script></head><body><input type="checkbox"><p>中文</p></body></html>');doc.close();
        doc.getElementById('m').sheet.insertRule('.mjx{color:red}');
        doc.querySelector('input').checked=true;
        const out=M.snapshotPrintDocument(doc);
        assert.ok(!out.includes('<script'));assert.match(out,/\.mjx \{ ?color: red;/);
        assert.match(out,/<input type="checkbox" checked="">/);assert.match(out,/<base href=/);
    }finally{frame.remove();}
});

test('顶层块之间 2 个以上空行补 Typora 空段落，列表、引用和代码内部空行不处理',()=>{
    const src='> a\n\n> b\n\n\n\n> [!NOTE]\n> c\n\n- x\n\n\n  y\n\n```\n1\n\n\n2\n```\n\n\ntail\n';
    const out=M.insertTyporaBlankParagraphs(src);
    assert.equal(out.split('<p>&nbsp;</p>').length-1,2);
    assert.match(out,/> b\n\n\n\n<p>&nbsp;<\/p>\n\n> \[!NOTE\]/);
    assert.match(out,/1\n\n\n2/);assert.match(out,/- x\n\n\n  y/);
    assert.equal(M.insertTyporaBlankParagraphs('a\n\nb'),'a\n\nb');
});

test('段落内行内纯空格包成 span，块间换行空白不包',()=>{
    const root=document.createElement('div');
    root.innerHTML='<blockquote>\n<p><strong>举例</strong> </p>\n</blockquote>';
    M.wrapTextSpans(root);
    assert.equal(root.querySelector('p').innerHTML,'<strong><span>举例</span></strong><span> </span>');
    assert.equal(root.querySelector('blockquote').firstChild.nodeType,3);
});

test('引用块内部连续空行补 Typora 空段落',()=>{
    const out=M.insertTyporaBlankParagraphs('> a\n>\n> ---\n>\n>    \n>\n> - x\n> - y\n\n> b\n>\n> c\n');
    assert.match(out,/> ---\n>\n>    \n>\n> <p>&nbsp;<\/p>\n>\n> - x/);
    assert.equal(out.split('&nbsp;').length-1,1);
});

test('导出时找不到的本地图片还原为原地址 img，阅读视图保持宿主提示',()=>{
    const make=()=>{const root=document.createElement('div');root.innerHTML='<p><span src="lost.jpg?darksrc=invert" alt="lost.jpg?darksrc=invert" class="internal-embed file-embed mod-empty-attachment">找不到</span></p>';return root;};
    const app={metadataCache:{getFirstLinkpathDest:()=>null},vault:{getResourcePath:()=>''}};
    const reading=make();M.resolveBrokenEmbeds(reading,app,'a.md');assert.equal(reading.querySelector('img'),null);
    const exported=make();M.resolveBrokenEmbeds(exported,app,'a.md',true);
    const img=exported.querySelector('img');assert.equal(img.getAttribute('src'),'lost.jpg?darksrc=invert');assert.equal(img.hasAttribute('alt'),false);
});

test('独占段落的无 alt 原生播放器拆掉段落包装',()=>{
    const root=html('<p><video src="v.mp4"></video></p><p>文字<audio src="a.mp3"></audio></p>');M.toTyporaDom(root,true);
    assert.equal(root.querySelector('video').parentElement,root);assert.equal(root.querySelector('audio').parentElement.tagName,'P');
});

test('```math 导出为 Typora 高级代码块，$$ 仍为公式块',()=>{
    const root=html('<p><em><mark>题注</mark></em></p><div class="block-language-math" data-vlook-math-fence="1"><div class="math math-block"><mjx-container></mjx-container></div></div><div class="math math-block"><mjx-container></mjx-container></div>');
    M.toTyporaDom(root,true);
    const fence=root.querySelector('.md-fences-math');
    assert.equal(fence.getAttribute('lang'),'math');assert.equal(fence.classList.contains('md-fences-advanced'),true);
    assert.equal(fence.firstElementChild.className,'md-math-container');assert.equal(fence.querySelector('mjx-container')!==null,true);
    assert.equal(root.querySelector('[data-vlook-math-fence]'),null);assert.equal(root.querySelectorAll('.md-math-block').length,1);
});

test('frontmatter 中 Markdown 链接值按 Typora 宽松解析，其余键保留',()=>{
    const yaml='title: 攻略 • 基础\nvlook-doc-lib:\n- [如何开始？](index.html?target=_self "简介、安装")\n- [Bob\'s](b.html)\nlink: [首页](index.html)';
    const fm=M.parseFrontmatterYaml(yaml);
    assert.equal(fm.title,'攻略 • 基础');
    assert.deepEqual(fm['vlook-doc-lib'],['[如何开始？](index.html?target=_self "简介、安装")',"[Bob's](b.html)"]);
    assert.equal(fm.link,'[首页](index.html)');
    assert.deepEqual(M.parseFrontmatterYaml('a: [1, 2]'),{a:[1,2]});
    assert.deepEqual(M.parseFrontmatterYaml('a: [unclosed\nb: :'),{});
    const src='---\ntitle: T\nvlook-doc-lib:\n- [甲](a.html)\nvlook-query: unpub=off\n---\n\n正文';
    assert.equal(M.getSourceIndex(src,opts).frontmatter['vlook-query'],'unpub=off');
});

test('重复 \\label 报错的公式只清除自身标签并重新渲染',()=>{
    const root=html('<div class="math"><mjx-container display="true"><mjx-merror data-mjx-error="Label \'a\' multiply defined">\\begin{align}x \\label{a}\\end{align}</mjx-merror></mjx-container></div><mjx-container><mjx-merror data-mjx-error="Missing close brace">x</mjx-merror></mjx-container>');
    const tags={allLabels:{a:1,b:2},labels:{a:1}};
    assert.equal(M.repairDuplicateMathLabels(root,{MathJax:{startup:{input:[{parseOptions:{tags}}]}}}),1);
    assert.deepEqual(tags.allLabels,{b:2});assert.deepEqual(tags.labels,{});
    const fresh=root.querySelector('.math mjx-container');assert.equal(fresh.getAttribute('display'),'true');assert.match(fresh.dataset.tex,/\\label\{a\}/);
    assert.equal(root.querySelectorAll('mjx-merror').length,1);
    assert.equal(M.repairDuplicateMathLabels(root,{}),0);
});

test('实时预览 div 嵌入只替换内容并标记，避免重复处理',()=>{
    const root=document.createElement('div');
    root.innerHTML='<div class="internal-embed file-embed mod-empty-attachment" src="pic/a.svg?darksrc=invert#icon">找不到</div>';
    const app={metadataCache:{getFirstLinkpathDest:p=>p==='pic/a.svg'?{path:'samples/pic/a.svg'}:null},vault:{getResourcePath:()=>'app://x/a.svg?1'}};
    M.resolveBrokenEmbeds(root,app,'samples/guide3.md');M.resolveBrokenEmbeds(root,app,'samples/guide3.md');
    const box=root.firstElementChild;
    assert.equal(box.tagName,'DIV');assert.equal(box.dataset.vlookResolved,'1');assert.equal(box.classList.contains('mod-empty-attachment'),false);
    assert.equal(box.querySelectorAll('img').length,1);assert.equal(box.querySelector('img').getAttribute('src'),'app://x/a.svg?1&darksrc=invert#icon');
});

test("header toggle menus switch directly without a panel", async () => {
    const M = await setup();let mode='source';
    const toolbar=M.createHeaderToolbar(document,[{id:'mode',label:'编辑 / 阅读',icon:'x',toggle:true,selected:()=>mode,choices:()=>[{label:'编辑',value:'source'},{label:'阅读',value:'preview'}],choose:value=>{mode=value;}}]);
    document.body.append(toolbar.element);const button=toolbar.element.querySelector('button');
    button.click();assert.equal(mode,'preview');assert.equal(document.querySelector('.vlook-header-menu'),null);
    button.click();assert.equal(mode,'source');assert.equal(button.hasAttribute('aria-haspopup'),false);
    toolbar.dispose();
});

test("切换模式或主题后按原源码行恢复阅读位置，用户滚动后停止", async () => {
    const M = await setup();let line=42;const applied=[];
    const el=document.createElement('div');document.body.append(el);
    const view={containerEl:el,currentMode:{getScroll:()=>line,applyScroll:n=>applied.push(n)}};
    await M.keepReadingPosition([view],()=>{line=0;});
    await new Promise(r=>setTimeout(r,80));
    assert.ok(applied.length>=2);assert.ok(applied.every(n=>n===42));
    el.dispatchEvent(new window.Event('wheel'));const count=applied.length;
    await new Promise(r=>setTimeout(r,250));assert.equal(applied.length,count);
    el.remove();
});

test("编辑视图按区块与区块内比例恢复位置，预览区块变高后仍对准原处", async () => {
    const M = await setup();
    const el=document.createElement('div');document.body.append(el);const scroll=document.createElement('div');
    let height=400;scroll.scrollTop=0;Object.defineProperty(scroll,'scrollTop',{value:300,writable:true});
    scroll.getBoundingClientRect=()=>({top:0});
    const block=()=>({from:50,top:100,height});
    const cm={documentTop:-300,scrollDOM:scroll,state:{doc:{length:1000}},lineBlockAtHeight:()=>block(),lineBlockAt:()=>block()};
    const view={containerEl:el,getMode:()=>'source',editor:{cm},currentMode:{getScroll:()=>3,applyScroll(){throw new Error('line fallback')}}};
    await M.keepReadingPosition([view],()=>{height=800;});
    await new Promise(r=>setTimeout(r,20));
    // 原先位于区块 50% 处（300-0-100)/400；区块变为 800 高后应滚到 100+400
    assert.equal(scroll.scrollTop,500);
    el.remove();
});

test("激光笔在独立窗口：指针坐标取自所在窗口，其他窗口的移动不影响", async () => {
    const { JSDOM } = await import("jsdom");
    const other = new JSDOM('<!doctype html><body><div class="markdown-preview-view">正文</div></body>', { pretendToBeVisual: true });
    const win = other.window, doc = win.document, content = doc.querySelector('.markdown-preview-view');
    content.getBoundingClientRect = () => ({ left: 10, top: 20, width: 500, height: 400 });
    const commands = new Map(), cleanups = [], handlers = new Map();
    const plugin = { app: { workspace: { getActiveViewOfType: () => ({ contentEl: content }), on: (name, fn) => { (handlers.get(name) || handlers.set(name, []).get(name)).push(fn); return {}; } } }, addCommand(cmd) { commands.set(cmd.id, cmd.callback); }, registerEvent() {}, register(fn) { cleanups.push(fn); }, registerDomEvent() {} };
    const tools = new M.ReadingTools(plugin); tools.register();
    try {
        handlers.get('window-open').forEach(fn => fn({}, win));
        commands.get('spotlight')();
        const overlay = doc.querySelector('.vlook-effect-spotlight');
        assert.ok(overlay);
        doc.dispatchEvent(new win.MouseEvent('pointermove', { clientX: 75, clientY: 90 }));
        assert.equal(overlay.style.getPropertyValue('--vlook-pointer-x'), '65px');
        document.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 300, clientY: 300 }));
        assert.equal(overlay.style.getPropertyValue('--vlook-pointer-x'), '65px');
        doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
        assert.equal(doc.querySelector('.vlook-reading-effect'), null);
    } finally { cleanups.forEach(fn => fn()); win.close(); }
});

test("PDF 快照：app:// 资源地址换成 file:// 本地路径，查询与片段保留", () => {
    const mac = '<img src="app://10169568d74cf0899fc8c1fda7287f72b45c/Users/me/vault/pic/a.png?1792&darksrc=~&srcset=@2x#logo"><img srcset="app://10169568d74cf0899fc8c1fda7287f72b45c/Users/me/vault/pic/a@2x.png 2x">';
    assert.equal(M.appUrlsToFileUrls(mac), '<img src="file:///Users/me/vault/pic/a.png?1792&darksrc=~&srcset=@2x#logo"><img srcset="file:///Users/me/vault/pic/a@2x.png 2x">');
    const win = '<img src="app://10169568d74cf0899fc8c1fda7287f72b45c/C:/Users/me/vault/pic/a.png?1">';
    assert.equal(M.appUrlsToFileUrls(win), '<img src="file:///C:/Users/me/vault/pic/a.png?1">');
    const other = '<img src="app://obsidian.md/vlook-lost-image.jpg"><img src="https://example.org/a.png">';
    assert.equal(M.appUrlsToFileUrls(other), other);
});

test("渲染：tabico 与 tabcap 调校参数控制页签的图标样式和题注编号", () => {
    const md = "_^tab^_\n\n*==销售数据==*\n\n| a |\n| - |\n| 1 |\n\n```js\nx\n```";
    const index = M.getSourceIndex(md, opts);
    const build = query => {
        const base = { app: null, settings: { ...M.DEFAULT_SETTINGS }, query: new M.Query(query), sourcePath: "t.md", cssVar: () => "", index };
        const parent = html("");
        const bar = document.createElement("div"); bar.innerHTML = `<p><em><sup>tab</sup></em></p>`;
        parent.append(bar);
        M.renderSection(bar, { ...base, block: index.blockAt(0) });
        return bar.querySelector(".tab-group-wrap > span");
    };
    const normal = build("");
    assert.ok(normal.innerHTML.includes("tablelineline") === false);
    assert.ok(normal.innerHTML.includes("icoIndexTab-tableline"));
    assert.ok(!/表 1|Table 1/.test(normal.textContent));
    assert.ok(build("tabico=solid").innerHTML.includes("icoIndexTab-tablesolid"));
    assert.ok(build("tabico=flat").innerHTML.includes("icoIndexTab-tableflat"));
    assert.equal(build("tabico=off").querySelector("svg"), null);
    assert.match(build("tabcap=on").textContent, /(表|Table) 1 销售数据/);
    assert.match(build("tabcap=on&capnum=off").textContent, /^销售数据$/);
});

test("表格内容助手：tr=on 时十字阅读默认开启且不抢焦点", () => {
    const root = html('<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>');
    document.body.append(root);
    M.processTableTools(root, true);
    const table = root.querySelector('table');
    assert.ok(table.classList.contains('vlook-table-reading'));
    assert.notEqual(document.activeElement, table);
    const off = html('<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>');
    M.processTableTools(off);
    assert.equal(off.querySelector('table').classList.contains('vlook-table-reading'), false);
    root.remove();
});

test("Gray Mode：解析日期、语言匹配、force 与 off", () => {
    const days = M.parseGrayDays("12-13:国家公祭日@zh;04-05:清明节@zh,ko; 05-12 ;bad;13-40:x");
    assert.deepEqual(days.map(d => [d.month, d.day, d.title, d.langs]), [[12, 13, "国家公祭日", ["zh"]], [4, 5, "清明节", ["zh", "ko"]], [5, 12, "", []]]);
    const at = (m, d) => new Date(2026, m - 1, d);
    assert.equal(M.grayModeActive(null, undefined, at(12, 13), "zh-CN"), true);
    assert.equal(M.grayModeActive("on", undefined, at(12, 13), "en-US"), false);
    assert.equal(M.grayModeActive("on", "05-12", at(5, 12), "en-US"), true);
    assert.equal(M.grayModeActive("on", "05-12:x@en", at(5, 12), "zh-CN"), false);
    assert.equal(M.grayModeActive("off", undefined, at(12, 13), "zh"), false);
    assert.equal(M.grayModeActive("force", undefined, at(1, 1), "en"), true);
    assert.equal(M.grayModeActive(null, undefined, at(6, 1), "zh"), false);
});

test("欢迎页：ws 模式解析，自定义 HTML 去除脚本与事件属性", () => {
    assert.deepEqual(M.welcomeMode("off"), { kind: "off" });
    assert.deepEqual(M.welcomeMode("wait"), { kind: "wait" });
    assert.deepEqual(M.welcomeMode("30"), { kind: "delay", seconds: 30 });
    assert.deepEqual(M.welcomeMode("61"), { kind: "auto" });
    assert.deepEqual(M.welcomeMode(null), { kind: "auto" });
    const box = document.createElement("div");
    box.append(M.sanitizeWelcome('<strong onclick="x()">欢迎</strong><script>bad()</script><a href="javascript:bad()">链接</a><iframe src="x"></iframe>', document));
    assert.equal(box.querySelector("script,iframe"), null);
    assert.equal(box.querySelector("strong").getAttribute("onclick"), null);
    assert.equal(box.querySelector("a").getAttribute("href"), null);
    assert.equal(box.querySelector("strong").textContent, "欢迎");
    const tricky = document.createElement("div");
    tricky.append(M.sanitizeWelcome('<a href="java&#9;script:bad()">甲</a><a href=" \njavascript:bad()">乙</a><a href="vbscript:bad()">丙</a>', document));
    tricky.querySelectorAll("a").forEach(a => assert.equal(a.getAttribute("href"), null));
});

test("自绘下拉选择器：选项、键盘操作、Esc 只收起列表", () => {
    const wrap = html("");
    const dd = new M.Dropdown(document, "内容分类");
    wrap.append(dd.el);
    const seen = [];
    dd.setOptions([{ value: "a", label: "甲" }, { value: "b", label: "乙" }, { value: "c", label: "丙" }], "b");
    dd.onChange(v => seen.push(v));
    assert.equal(dd.value, "b");
    assert.equal(dd.el.querySelector(".vlook-dropdown-text").textContent, "乙");
    const key = (target, k) => { const e = new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }); target.dispatchEvent(e); return e; };
    const trigger = dd.el.querySelector(".vlook-dropdown-trigger"), list = dd.el.querySelector('[role="listbox"]');
    trigger.click();
    assert.ok(dd.el.classList.contains("is-open"));
    key(list, "ArrowDown"); key(list, "Enter");
    assert.deepEqual(seen, ["c"]);
    assert.equal(dd.el.classList.contains("is-open"), false);
    trigger.click();
    const esc = key(list, "Escape");
    assert.equal(esc.defaultPrevented, true);
    assert.equal(dd.el.classList.contains("is-open"), false);
    dd.value = "a";
    assert.deepEqual(seen, ["c"]);
    dd.setOptions([{ value: "x", label: "新" }], "missing");
    assert.equal(dd.value, "x");
    assert.equal(dd.el.querySelectorAll('[role="option"]').length, 1);
});

test('阅读时间展开嵌入笔记，循环与深度受限',()=>{
    const notes={a:{id:'a',source:'alpha beta ![[b]]'},b:{id:'b',source:'gamma ![[a]]'}};
    const text=M.readingText('root ![[a|别名]] ![[img.png]]',t=>notes[t]||null);
    assert.equal(M.vlookWordCount(text).latin,4);
    assert.equal(M.vlookWordCount(M.readingText('root ![[a]]')).latin,1);
});

test('全文资源检查枚举未渲染的本地图片与嵌入，跳过远程与代码块',()=>{
    const app={metadataCache:{getFirstLinkpathDest:p=>p==='ok.png'?{path:p}:null}};
    const src=['![a](ok.png)','![b](gone.png)','![c](https://x.com/a.png)','![[nope.mp4]]','![[ok.png|200]]','```','![[inside.png]]','```'].join('\n');
    const r=M.auditLocalResources(app,{path:'n.md'},src);
    assert.deepEqual(r.map(x=>[x.link.href,x.link.line]),[['gone.png',1],['nope.mp4',3]]);
});

test('表格行列移动：保持外框与分隔行，表头不可移动，越界不动，转义竖线与代码内竖线不分列',()=>{
    const t=['| a | b | c |','| - | - | - |','| 1 | `x|y` | 3 |','| 4 | 5\\|6 | 7 |'];
    const down=M.moveTable(t,2,2,'down');
    assert.deepEqual(down.lines,['| a | b | c |','| - | - | - |','| 4 | 5\\|6 | 7 |','| 1 | `x|y` | 3 |']);
    assert.equal(down.line,3);
    assert.equal(M.moveTable(t,0,2,'down'),null);
    assert.equal(M.moveTable(t,2,2,'up'),null);
    const right=M.moveTable(t,2,2,'right');
    assert.deepEqual(right.lines[2],'|  `x|y` | 1 | 3 |'.replace('|  `','| `'));
    assert.equal(right.col,1);
    assert.equal(M.moveTable(t,2,t[2].length,'right'),null);
    const bare=M.moveTable(['a|b','-|-','1|2'],2,0,'right');
    assert.deepEqual(bare.lines,['b|a','-|-','2|1']);
    assert.equal(M.moveTable(['no table'],0,0,'up'),null);
});

test('表格拖动重排：整行整列移动到目标位置，表头与分隔行不参与行移动',()=>{
    const t=['| a | b | c |','| - | - | - |','| 1 | 2 | 3 |','| 4 | 5 | 6 |','| 7 | 8 | 9 |'];
    assert.deepEqual(M.reorderTable(t,3,'row',2,4).lines.slice(2),['| 4 | 5 | 6 |','| 7 | 8 | 9 |','| 1 | 2 | 3 |']);
    assert.equal(M.reorderTable(t,3,'row',1,3),null);
    assert.equal(M.reorderTable(t,3,'row',2,1),null);
    assert.deepEqual(M.reorderTable(t,0,'col',0,2).lines.slice(0,3),['| b | c | a |','| - | - | - |','| 2 | 3 | 1 |']);
    assert.equal(M.reorderTable(t,0,'col',0,3),null);
});

test('字号滑块：最小值显示默认，拖动即时预览，松开后提交，触发按钮显示当前字体',async()=>{
    let font='theme',size=0;
    const toolbar=M.createHeaderToolbar(document,[{id:'font',label:'字体',icon:'type',selected:()=>`font:${font}`,choices:()=>[{label:'跟随主题',value:'font:theme'},{label:'衬线',value:'font:serif'}],slider:{title:'字号',min:11,max:32,preview:'预览',value:()=>size,choose:n=>{size=n;}},choose:v=>{font=v.slice(5);}}]);
    document.body.append(toolbar.element);
    const trigger=toolbar.element.querySelector('.vlook-header-trigger');
    assert.equal(trigger.querySelector('.vlook-header-label').textContent,'跟随主题');
    trigger.click();
    const input=document.querySelector('.vlook-header-slider input[type=range]'),badge=document.querySelector('.vlook-header-slider-value'),sample=document.querySelector('.vlook-header-slider-preview');
    assert.equal(badge.textContent,'默认');
    input.value='20';input.dispatchEvent(new input.ownerDocument.defaultView.Event('input'));
    assert.equal(badge.textContent,'20');assert.equal(sample.style.fontSize,'20px');assert.equal(size,0);
    input.dispatchEvent(new input.ownerDocument.defaultView.Event('change'));assert.equal(size,20);
    input.value='11';input.dispatchEvent(new input.ownerDocument.defaultView.Event('input'));input.dispatchEvent(new input.ownerDocument.defaultView.Event('change'));assert.equal(size,0);
    toolbar.dispose();
});

test('顶栏按钮图标跟随当前状态，主题图标取当前配色',()=>{
    let mode='preview',theme='a';const names=[];
    const toolbar=M.createHeaderToolbar(document,[
        {id:'mode',label:'模式',icon:'book-open',icons:{source:'pencil',preview:'book-open'},selected:()=>mode,choices:()=>[{label:'编辑',value:'source'},{label:'阅读',value:'preview'}],toggle:true,choose:v=>{mode=v;}},
        {id:'theme',label:'主题',icon:'palette',selected:()=>theme,choices:()=>[{label:'A',value:'a',color:'#123456'},{label:'B',value:'b',color:'#654321'}],choose:v=>{theme=v;}},
    ],(el,name)=>names.push(name));
    const glyph=i=>toolbar.element.querySelectorAll('.vlook-header-icon')[i];
    assert.equal(glyph(0).dataset.icon,'book-open');
    mode='source';toolbar.update();assert.equal(glyph(0).dataset.icon,'pencil');assert.equal(names.at(-1),'pencil');
    assert.equal(glyph(1).style.color,'rgb(18, 52, 86)');
    theme='b';toolbar.update();assert.equal(glyph(1).style.color,'rgb(101, 67, 33)');
    toolbar.dispose();
});

test("默认剥离在线字体：只去掉引用 http(s) 的 @font-face，保留本地字体与其余样式", () => {
    const css='a{color:red}@font-face{font-family:X;src:url(https://openfonts.pages.dev/x.woff2)format("woff2");unicode-range:U+4E00}@font-face{font-family:L;src:url(data:font/woff2;base64,AAAA)}b{margin:0}';
    const out=M.stripRemoteFonts(css);
    assert.equal(out,'a{color:red}@font-face{font-family:L;src:url(data:font/woff2;base64,AAAA)}b{margin:0}');
});

test("提示分类：失败为错误，已导出为成功，请…为警告，其余为信息", () => {
    assert.equal(M.noticeKind("导出失败：x"), "error");
    assert.equal(M.noticeKind("VLOOK：未找到样式 css/blue.css"), "error");
    assert.equal(M.noticeKind("已导出到 a.html"), "success");
    assert.equal(M.noticeKind("请先打开 Markdown 文档"), "warning");
    assert.equal(M.noticeKind("文档已变更，请重新打开导航"), "warning");
    assert.equal(M.noticeKind("VLOOK：正在导出…"), "info");
});
