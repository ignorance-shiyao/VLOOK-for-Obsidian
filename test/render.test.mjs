import { test, before } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setup, html, dropdown, zenumlChunkCode } from "./harness.mjs";

let M;
before(async () => { M = await setup(); });

test('跨文档交叉引用读取本地源码添加前缀，同文档读取去重，远程及公式不误处理',async()=>{
    let reads=0;const target={path:'target.md',extension:'md'};
    const app={metadataCache:{getFirstLinkpathDest:path=>path==='target.md'?target:null},vault:{cachedRead:async()=>{reads++;return '# 章节\n\n*==表格示例==*\n\n| A |\n| - |\n| B |';}}};
    const root=html('<a href="target.md#章节">章节</a><a href="target.md#表格示例">表格</a><a href="https://example.org/#章节">远程</a><a href="target.md#mjx-eqn%3Aenergy">公式</a>');
    await M.processExternalReferences(root,ctx({app,cssVar:()=> 'h1{{###. }}'}));
    const links=root.querySelectorAll('a');assert.equal(reads,1);
    assert.ok(links[0].dataset.vlookRef);assert.ok(links[1].dataset.vlookRef);
    assert.equal(links[2].dataset.vlookExternalRef,undefined);assert.equal(links[3].dataset.vlookExternalRef,undefined);
    assert.equal(links[0].getAttribute('href'),'target.md#章节');
});

test('跨文档引用卸载后不更新 DOM，读取失败不标链接失效或伪造编号',async()=>{
    let finish;const pending=new Promise(resolve=>{finish=resolve;}),cleanups=[];
    const app={metadataCache:{getFirstLinkpathDest:()=>({path:'target.md',extension:'md'})},vault:{cachedRead:()=>pending}};
    const root=html('<a href="target.md#章节">章节</a>');
    const task=M.processExternalReferences(root,ctx({app,registerCleanup:fn=>cleanups.push(fn)}));cleanups.forEach(fn=>fn());finish('# 章节');await task;
    assert.equal(root.querySelector('a').dataset.vlookRef,undefined);
    app.vault.cachedRead=async()=>{throw Error('read denied');};
    const failed=html('<a href="target.md#章节">章节</a>');await M.processExternalReferences(failed,ctx({app}));
    assert.equal(failed.querySelector('a').dataset.vlookExternalRef,'unavailable');assert.equal(failed.querySelector('a').classList.contains('vlook-link-missing'),false);
});

test('跨文档编号以目标 YAML 和主题默认值为准，不继承来源笔记的编号开关',async()=>{
    const table='*==目标表格==*\n\n| A |\n| - |\n| B |';
    let source=table;
    const app={metadataCache:{getFirstLinkpathDest:()=>({path:'target.md',extension:'md'})},vault:{cachedRead:async()=>source}};
    const context=ctx({app,query:new M.Query('capnum=off&capgroup=on'),cssVar:name=>name==='--vlook-query'?'capnum=on&capgroup=off':''});
    const enabled=html('<a href="target.md#目标表格">目标</a>');await M.processExternalReferences(enabled,context);
    assert.equal(enabled.querySelector('a').dataset.vlookExternalRef,'numbered');
    assert.ok(enabled.querySelector('a').dataset.vlookRef);
    source='---\nvlook-query: capnum=off\n---\n\n'+table;
    const disabled=html('<a href="target.md#目标表格">目标</a>');await M.processExternalReferences(disabled,context);
    assert.equal(disabled.querySelector('a').dataset.vlookExternalRef,'no-prefix');assert.equal(disabled.querySelector('a').dataset.vlookRef,undefined);
});

test('跨文档引用被改写或移除后，旧读取不会覆盖新请求',async()=>{
    let first;const slow=new Promise(resolve=>{first=resolve;});
    const app={metadataCache:{getFirstLinkpathDest:path=>({path,extension:'md'})},vault:{cachedRead:file=>file.path==='old.md'?slow:Promise.resolve('# 新章节')}};
    const context=ctx({app,cssVar:()=> 'h1{{###. }}'}),root=html('<a href="old.md#旧章节">引用</a>'),anchor=root.querySelector('a');
    const old=M.processExternalReferences(root,context);
    anchor.setAttribute('href','new.md#新章节');
    await M.processExternalReferences(root,context);
    const prefix=anchor.dataset.vlookRef,aria=anchor.getAttribute('aria-label');assert.ok(prefix);
    first('# 第一章\n\n# 旧章节');await old;
    assert.equal(anchor.dataset.vlookRef,prefix);assert.equal(anchor.getAttribute('aria-label'),aria);
    let finish;app.vault.cachedRead=()=>new Promise(resolve=>{finish=resolve;});
    const removed=html('<a href="removed.md#章节">移除</a>'),node=removed.querySelector('a');
    const pending=M.processExternalReferences(removed,context);await Promise.resolve();node.remove();finish('# 章节');await pending;
    assert.equal(node.dataset.vlookRef,undefined);
});

test('已编号引用改为无编号目标后移除旧前缀，保留原有无障碍说明',async()=>{
    const app={metadataCache:{getFirstLinkpathDest:path=>({path,extension:'md'})},vault:{cachedRead:async file=>file.path==='on.md'?'# 章节':'---\nvlook-header-autonum: h1{{#none#}}\n---\n\n# 章节'}};
    const root=html('<a href="on.md#章节" aria-label="原有说明">引用</a>'),anchor=root.querySelector('a');
    const context=ctx({app,cssVar:()=> 'h1{{###. }}'});
    await M.processExternalReferences(root,context);assert.ok(anchor.dataset.vlookRef);
    anchor.setAttribute('href','off.md#章节');await M.processExternalReferences(root,context);
    assert.equal(anchor.dataset.vlookRef,undefined);assert.equal(anchor.getAttribute('aria-label'),'原有说明');assert.equal(anchor.dataset.vlookExternalRef,'no-prefix');
});

test('代码当前行按逻辑源码跨 token 定位，包裹行整体高亮，滚动和卸载清理',()=>{
    const root=html('<pre><code><span>const </span><b>answer</b><span> = 42;\nsecond();</span></code></pre>');
    const pre=root.querySelector('pre'),code=root.querySelector('code'),before=code.innerHTML;
    const caret=document.caretRangeFromPoint,rects=window.Range.prototype.getClientRects;
    pre.getBoundingClientRect=()=>({left:10,top:20,right:310,bottom:220});code.getBoundingClientRect=()=>({left:10,top:40,right:310,bottom:220});
    document.caretRangeFromPoint=()=>{const range=document.createRange();range.setStart(code.querySelector('b').firstChild,2);return range;};
    window.Range.prototype.getClientRects=function(){assert.equal(this.toString(),'const answer = 42;\n');return [{top:40,bottom:60,height:20},{top:60,bottom:80,height:20}];};
    const cleanup=M.bindCodeLine(pre,code);
    try{
        pre.dispatchEvent(new window.MouseEvent('pointermove',{bubbles:true,clientX:30,clientY:50}));
        const overlay=pre.querySelector('.vlook-code-active-line');assert.equal(overlay.hidden,false);assert.equal(overlay.style.height,'40px');assert.equal(pre.dataset.vlookActiveLine,'1');assert.equal(code.innerHTML,before);
        code.dispatchEvent(new window.Event('scroll'));assert.equal(overlay.hidden,true);
        pre.dispatchEvent(new window.MouseEvent('pointermove',{bubbles:true,clientX:30,clientY:50}));
        pre.dispatchEvent(new window.MouseEvent('pointerleave'));assert.equal(overlay.hidden,true);
        cleanup();assert.equal(pre.querySelector('.vlook-code-active-line'),null);
        pre.dispatchEvent(new window.MouseEvent('pointermove',{bubbles:true,clientX:30,clientY:50}));assert.equal(pre.dataset.vlookActiveLine,undefined);
    }finally{cleanup();document.caretRangeFromPoint=caret;window.Range.prototype.getClientRects=rects;}
});

test('代码复制在剪贴板缺失或拒绝时选中纯代码，成功时不包含工具栏',async()=>{
    const descriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
    const source='const answer = 42;\nconsole.log(answer);';let copied;
    try{
        for(const clipboard of [undefined,{writeText:async()=>{throw Error('denied');}},{writeText:async text=>{copied=text;}}]){
            Object.defineProperty(navigator,'clipboard',{configurable:true,value:clipboard});
            const root=html('<pre><code class="language-js"><span></span></code></pre>');root.querySelector('span').textContent=source;document.body.append(root);
            try{
                M.processCodeBlocks(root,{});
                const button=root.querySelector('.vlook-code-tools button');button.click();await new Promise(resolve=>setTimeout(resolve,0));
                if(clipboard?.writeText&&copied!==undefined){assert.equal(copied,source);assert.equal(button.textContent,'已复制');}
                else{assert.equal(button.textContent,'已选中');assert.equal(document.getSelection().toString(),source);}
                assert.equal(root.querySelector('code').textContent,source);
            }finally{document.getSelection().removeAllRanges();root.remove();}
        }
    }finally{if(descriptor)Object.defineProperty(navigator,'clipboard',descriptor);else delete navigator.clipboard;}
});

test('长代码手动复制回退展开全文，并同步换行与折叠按钮初始状态',async()=>{
    const descriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});
    const source=Array.from({length:30},(_,i)=>`line ${i}`).join('\n');
    const root=html('<pre><code></code></pre>');root.querySelector('code').textContent=source;document.body.append(root);
    try{
        M.processCodeBlocks(root,{});
        const pre=root.querySelector('pre'),buttons=Array.from(root.querySelectorAll('button'));
        const copy=buttons.find(b=>b.textContent==='复制代码'),wrap=buttons.find(b=>b.textContent==='自动换行'),expand=buttons.find(b=>b.textContent==='展开代码');
        assert.equal(wrap.getAttribute('aria-pressed'),'true');assert.equal(expand.getAttribute('aria-expanded'),'false');
        assert.ok(pre.classList.contains('vlook-code-collapsed'));
        copy.click();await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(document.getSelection().toString(),source);
        assert.equal(pre.classList.contains('vlook-code-collapsed'),false);
        assert.equal(expand.textContent,'折叠代码');assert.equal(expand.getAttribute('aria-expanded'),'true');
        expand.click();assert.ok(pre.classList.contains('vlook-code-collapsed'));assert.equal(expand.getAttribute('aria-expanded'),'false');
    }finally{document.getSelection().removeAllRanges();root.remove();if(descriptor)Object.defineProperty(navigator,'clipboard',descriptor);else delete navigator.clipboard;}
});

const ctx = (extra = {}) => ({
    app: null,
    settings: { ...M.DEFAULT_SETTINGS },
    query: new M.Query("ws=auto&capnum=on"),
    sourcePath: "test.md",
    cssVar: () => "",
    ...extra,
});

/** 用源码构建索引，并取包含指定行的块 */
function withSource(md, line, extra = {}) {
    const index = M.getSourceIndex(md, { captionGroup: false, captionNumber: true, headerTemplate: extra.tpl });
    return ctx({ index, block: index.blockAt(line), ...extra });
}

test("单级标签 + 色号", () => {
    const el = html(`<p>前<em><code>标签</code></em><em>~Rd!~</em>后</p>`);
    M.renderSection(el, ctx());
    const code = el.querySelector("code");
    assert.ok(code.classList.contains("v-tag"));
    assert.ok(code.classList.contains("rd"));
    assert.ok(code.classList.contains("em"));
    assert.equal(el.querySelector("em"), null, "色号与 em 都应被移除");
});

test("单级标签渐变色", () => {
    const el = html(`<p><em><code>渐变</code></em><em>~T1T2~</em></p>`);
    M.renderSection(el, ctx());
    const code = el.querySelector("code.v-tag");
    assert.ok(code.classList.contains("t1"));
    assert.match(code.getAttribute("style"), /linear-gradient\(135deg,var\(--ac-t1\),var\(--ac-t2\)\)/);
});

test("多级标签（三段）", () => {
    const el = html(`<p><em>版本<code>V2.3</code>beta</em><em>~BuOg~</em></p>`);
    M.renderSection(el, ctx());
    const name = el.querySelector("code.v-badge-name");
    assert.ok(name, "应生成 v-badge-name");
    assert.equal(name.querySelector("label").textContent, "版本");
    assert.equal(name.querySelector(".v-badge-value").textContent, "V2.3");
    assert.equal(name.querySelector(".v-badge-value2").textContent, "beta");
    assert.ok(name.classList.contains("hastwo"));
});

test('多级徽章键盘复制按整体和值范围区分，重复渲染不增加普通代码复制',async()=>{
    const descriptor=Object.getOwnPropertyDescriptor(window.navigator,'clipboard'),copied=[];
    Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:{writeText:async text=>copied.push(text)}});
    const root=html('<p><em>名称<code>值</code>后缀</em></p>');document.body.append(root);
    try{
        M.renderSection(root,ctx());M.renderSection(root,ctx());const outer=root.querySelector('.v-badge-name'),value=root.querySelector('.v-badge-value'),suffix=root.querySelector('.v-badge-value2');
        assert.equal(outer.getAttribute('role'),'group');assert.equal(value.getAttribute('role'),'button');assert.equal(suffix.getAttribute('role'),'button');
        for(const target of [outer,value,suffix])target.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
        assert.deepEqual(copied,['名称 值 后缀','值 后缀','后缀']);copied.length=0;outer.click();assert.deepEqual(copied,['名称 值 后缀']);
        assert.equal(root.querySelector('.v-std-code'),null);
    }finally{root.remove();if(descriptor)Object.defineProperty(window.navigator,'clipboard',descriptor);else delete window.navigator.clipboard;}
});

test('无名称徽章保留分段复制，整体不增加重复焦点',()=>{
    const root=html('<p><em><code>值</code>后缀</em></p>');M.renderSection(root,ctx());
    assert.equal(root.querySelector('.v-badge-name').hasAttribute('tabindex'),false);
    assert.equal(root.querySelector('.v-badge-value').tabIndex,0);assert.equal(root.querySelector('.v-badge-value2').tabIndex,0);
});

test("多级标签变量高亮", () => {
    const el = html(`<p><em>参数<code>{{name}}</code></em></p>`);
    M.renderSection(el, ctx());
    assert.equal(el.querySelector(".v-badge-value .var").textContent, "{{name}}");
});

test("旧语法多级标签 `#名|值#`", () => {
    const el = html(`<p><code>#状态|完成#</code></p>`);
    M.renderSection(el, ctx());
    assert.equal(el.querySelector(".v-badge-name label").textContent, "状态");
});

test("普通行内代码标记为 v-std-code", () => {
    const el = html(`<p>运行 <code>npm i</code></p>`);
    M.renderSection(el, ctx());
    assert.ok(el.querySelector("code").classList.contains("v-std-code"));
});

test('行内复制失败提供准确原文的手动复制入口，Esc 可关闭',async()=>{
    const descriptor=Object.getOwnPropertyDescriptor(window.navigator,'clipboard');Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:undefined});
    const root=html('<span>显示标签</span>');document.body.append(root);const source=root.firstElementChild,text='原始值 > 下一步\n第二行';
    try{
        await M.copyText(source,text);const input=root.querySelector('textarea');assert.equal(input.value,text);
        assert.equal(input.selectionStart,0);assert.equal(input.selectionEnd,text.length);assert.equal(input.readOnly,true);
        let outerClicks=0;root.addEventListener('click',()=>outerClicks++);input.click();assert.equal(outerClicks,0);
        assert.equal(source.classList.contains('vlook-copied'),false);
        input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(root.querySelector('.vlook-copy-fallback'),null);
    }finally{root.remove();if(descriptor)Object.defineProperty(window.navigator,'clipboard',descriptor);else delete window.navigator.clipboard;}
});

test('行内复制使用独立窗口剪贴板，成功反馈不写入主窗口',async()=>{
    const other=new JSDOM('<span>标签</span>');let copied='';
    Object.defineProperty(other.window.navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied=text}}});
    try{const source=other.window.document.querySelector('span');await M.copyText(source,'准确值');assert.equal(copied,'准确值');assert.ok(source.classList.contains('vlook-copied'));assert.equal(other.window.document.querySelector('textarea'),null);}
    finally{other.window.close();}
});

test('旧复制失败不会覆盖新复制的准确原文，后续成功会清理回退框',async()=>{
    const descriptor=Object.getOwnPropertyDescriptor(window.navigator,'clipboard');let rejectOld;
    Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:{writeText:text=>text==='旧值'?new Promise((_resolve,reject)=>{rejectOld=reject}):Promise.reject(Error('denied'))}});
    const root=html('<button>甲</button><button>乙</button>');document.body.append(root);const [first,second]=root.querySelectorAll('button');
    try{
        const pending=M.copyText(first,'旧值');await M.copyText(second,'新值');assert.equal(root.querySelector('textarea').value,'新值');
        rejectOld(Error('late rejection'));await pending;assert.equal(root.querySelector('textarea').value,'新值');
        Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:{writeText:async()=>{}}});await M.copyText(first,'成功值');
        assert.equal(root.querySelector('textarea'),null);assert.ok(first.classList.contains('vlook-copied'));
    }finally{root.remove();if(descriptor)Object.defineProperty(window.navigator,'clipboard',descriptor);else delete window.navigator.clipboard;}
});

test('旧复制反馈定时器不提前清除同一元素的新成功反馈',async()=>{
    const descriptor=Object.getOwnPropertyDescriptor(window.navigator,'clipboard'),setTimeout=window.setTimeout,timers=[];
    Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:{writeText:async()=>{}}});window.setTimeout=callback=>{timers.push(callback);return 1};
    const source=document.createElement('button');document.body.append(source);
    try{
        await M.copyText(source,'一');await M.copyText(source,'二');assert.equal(timers.length,2);
        timers[0]();assert.ok(source.classList.contains('vlook-copied'));timers[1]();assert.equal(source.classList.contains('vlook-copied'),false);
    }finally{window.setTimeout=setTimeout;source.remove();if(descriptor)Object.defineProperty(window.navigator,'clipboard',descriptor);else delete window.navigator.clipboard;}
});

test('代码标签及无链接面包屑支持键盘复制，重复键不重复请求',async()=>{
    const descriptor=Object.getOwnPropertyDescriptor(window.navigator,'clipboard'),copied=[];
    Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:{writeText:async text=>copied.push(text)}});
    const root=html('<p><em><code>标签</code></em> <code>普通代码</code> 路径 <em><mark>A &gt; B</mark></em> 后缀</p>');document.body.append(root);
    try{
        M.renderSection(root,ctx());const targets=[root.querySelector('.v-tag'),root.querySelector('.v-std-code'),root.querySelector('.v-stepwise')];
        for(const target of targets){assert.equal(target.getAttribute('role'),'button');assert.equal(target.tabIndex,0);target.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));target.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true,cancelable:true}));}
        await Promise.resolve();assert.deepEqual(copied,['标签','普通代码','A > B']);
    }finally{root.remove();if(descriptor)Object.defineProperty(window.navigator,'clipboard',descriptor);else delete window.navigator.clipboard;}
});

test('链接内标签及含链接面包屑保留原生键盘导航，不添加复制焦点',()=>{
    const root=html('<p><a href="https://example.org/"><em><code>链接标签</code></em></a> 路径 <em><mark>A &gt; <a href="https://example.org/b">B</a></mark></em> 后缀</p>');
    M.renderSection(root,ctx());const tag=root.querySelector('.v-tag'),breadcrumb=root.querySelector('.v-stepwise');
    assert.equal(tag.hasAttribute('tabindex'),false);assert.equal(breadcrumb.hasAttribute('tabindex'),false);
    const event=new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});breadcrumb.querySelector('a').dispatchEvent(event);assert.equal(event.defaultPrevented,false);
});

test("刮刮卡", () => {
    const el = html(`<p>答案：<em>提示<strong>42</strong></em></p>`);
    M.renderSection(el, ctx());
    const card = el.querySelector(".v-coating");
    assert.ok(card);
    assert.equal(card.textContent, "提示");
    assert.equal(card.dataset.coatingHidden, "42");
    card.click();
    assert.equal(card.textContent, "42");
    assert.ok(card.classList.contains("opened"));
});

test('刮刮卡支持键盘展开收起及状态通知，重复键和组合键不误触',()=>{
    const root=html('<p><em>提示<strong>答案</strong></em></p>');M.renderSection(root,ctx());const card=root.querySelector('.v-coating');
    assert.equal(card.getAttribute('role'),'button');assert.equal(card.tabIndex,0);assert.equal(card.getAttribute('aria-expanded'),'false');
    const press=(key,extra={})=>{const event=new window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra});card.dispatchEvent(event);return event};
    assert.equal(press('Enter').defaultPrevented,true);assert.equal(card.textContent,'答案');assert.equal(card.getAttribute('aria-expanded'),'true');
    press('Enter',{repeat:true});press(' ',{ctrlKey:true});assert.equal(card.dataset.coatingShow,'true');
    press(' ');assert.equal(card.textContent,'提示');assert.equal(card.getAttribute('aria-expanded'),'false');
});

test('独立窗口刮刮卡使用自身选区，不受主窗口文本选择影响',()=>{
    const selected=document.createElement('p');selected.textContent='主窗口选区';document.body.append(selected);
    const range=document.createRange();range.selectNodeContents(selected);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    const other=new JSDOM('<p><em>提示<strong>答案</strong></em></p>');
    try{
        M.renderSection(other.window.document.body,ctx({suppressContentViewers:true}));const card=other.window.document.querySelector('.v-coating');
        card.click();assert.equal(card.textContent,'答案');
    }finally{selection.removeAllRanges();selected.remove();other.window.close();}
});

test("刮刮卡：Obsidian 解析结构", () => {
    const el = html(`<p>答案是 *点击查看<strong>42*</strong>，再来一个 <strong><em>默认提示</em></strong><em>~Bu~</em>。</p>`);
    M.renderSection(el, ctx());
    const cards = el.querySelectorAll(".v-coating");
    assert.equal(cards.length, 2);
    assert.equal(cards[0].dataset.coatingTip, "点击查看");
    assert.equal(cards[0].dataset.coatingHidden, "42");
    assert.equal(cards[1].dataset.coatingHidden, "默认提示");
    assert.match(cards[1].style.borderColor, /--ac-bu/);
    assert.ok(!el.textContent.includes("*"), "不应残留星号");
});

test("上标式注音", () => {
    const el = html(`<p>道<em>^dào^</em>生一</p>`);
    M.renderSection(el, ctx());
    const ruby = el.querySelector("ruby");
    assert.ok(ruby);
    assert.equal(ruby.querySelector("rt").textContent, "dào");
    assert.equal(el.textContent.replace(/[()\s ]/g, ""), "道dào生一");
});

test("代码式注音 `{text}(symbol)`", () => {
    const el = html(`<p><code>{万物}(wàn wù)</code></p>`);
    M.renderSection(el, ctx());
    assert.equal(el.querySelector("ruby rt").textContent, "wàn wù");
});

test("文本颜色：加粗文本", () => {
    const el = html(`<p>这是<strong>重点</strong><em>~Rd~</em>内容</p>`);
    M.renderSection(el, ctx());
    const s = el.querySelector("strong");
    assert.equal(s.getAttribute("data-rb-text"), "Rd");
    assert.match(s.getAttribute("style"), /var\(--ac-rd\)/);
});

test("段落整体着色（色号在段首）", () => {
    const el = html(`<p><em>~Gd~</em>整个段落</p>`);
    M.renderSection(el, ctx());
    assert.equal(el.querySelector("p").getAttribute("data-rb-whole-text"), "Gd");
});

test("文本颜色：高亮渐变", () => {
    const el = html(`<p><mark>高亮</mark><em>~BuAq~</em></p>`);
    M.renderSection(el, ctx());
    assert.match(el.querySelector("mark").getAttribute("style"), /linear-gradient\(90deg,var\(--ac-bu-fd\),var\(--ac-aq-fd\)\)/);
});

test("通用下标/上标语法", () => {
    const el = html(`<p>H~2~O 与 x^2^</p>`);
    M.renderSection(el, ctx());
    assert.equal(el.querySelector("sub").textContent, "2");
    assert.equal(el.querySelector("sup").textContent, "2");
});

test("引用块着色（强调）", () => {
    const el = html(`<blockquote><p><strong>小标题</strong></p><p>内容</p><p><em>~Rd!~</em></p></blockquote>`);
    M.renderSection(el, ctx());
    const q = el.querySelector("blockquote");
    assert.ok(q.classList.contains("v-q") && q.classList.contains("rd") && q.classList.contains("em"));
    assert.ok(q.classList.contains("stt"), "首段加粗应识别为小标题");
    assert.ok(el.querySelector("strong").classList.contains("title-rd"));
    assert.equal(q.querySelectorAll("p").length, 2, "色号段落应被移除");
});

test("引用块折叠", () => {
    const el = html(`<blockquote><h6 data-heading="什么是三段论？">什么是三段论？</h6><p>内容</p></blockquote>`);
    M.renderSection(el, ctx());
    const d = el.querySelector("details");
    assert.ok(d);
    assert.equal(d.querySelector("summary").textContent.trim(), "什么是三段论？");
    assert.ok(d.querySelector("summary use"));
    assert.equal(el.querySelector("blockquote"), null);
});

test("默认引用块着色（设置）", () => {
    const c = ctx();
    c.settings.quoteDefault = "T1!";
    const el = html(`<blockquote><p>普通引用</p></blockquote>`);
    M.renderSection(el, c);
    assert.ok(el.querySelector("blockquote").classList.contains("t1"));
});

test("进度条", () => {
    const el = html(`<p>进度 <strong><mark>66</mark></strong></p>`);
    M.renderSection(el, ctx());
    const s = el.querySelector("strong");
    assert.ok(s.classList.contains("v-pgbar"));
    assert.match(s.querySelector("label").getAttribute("style"), /66%/);
});

test("进度条自动统计任务", () => {
    const el = html(`<ul><li><p>整体 <strong><mark>?</mark></strong></p><ul><li class="task-list-item is-checked">a</li><li class="task-list-item">b</li></ul></li></ul>`);
    M.renderSection(el, ctx());
    assert.ok(el.querySelector("strong").textContent.endsWith("50.0") || el.querySelector("strong").textContent.endsWith("50"));
});

test('阅读视图紧凑及宽松父任务各取自己的子列表，行内包装不影响定位',()=>{
    const root=html('<ul><li><input type="checkbox">甲 <strong><mark>?</mark></strong><ul><li><input type="checkbox" checked>一</li><li><input type="checkbox">二</li></ul></li><li><p>乙 <span><strong><mark>?</mark></strong></span></p><ol><li><input type="checkbox" checked>三</li><li><input type="checkbox" checked>四</li></ol></li><li>无子项 <strong><mark>?</mark></strong></li></ul>');
    M.renderSection(root,ctx());
    assert.deepEqual(Array.from(root.querySelectorAll('strong'),el=>el.textContent),['50','100','?']);
});

test('父任务进度后的普通段落不能跨过后续内容借用列表',()=>{
    const root=html('<ul><li><p>进度 <strong><mark>?</mark></strong></p><p>其他正文</p><ul><li class="is-checked">完成</li></ul></li></ul>');
    M.renderSection(root,ctx());assert.equal(root.querySelector('strong').textContent,'?');
});

test('无子列表父任务不回退到源码中另一个列表的进度',()=>{
    const context=withSource('父项 **==?==**\n\n- [x] 另一个列表',0);
    const root=html('<ul><li>父项 <strong><mark>?</mark></strong></li></ul>');
    M.renderSection(root,context);assert.equal(root.querySelector('strong').textContent,'?');
});

test('DOM 规整不重排代码、公式和 SVG 中的强调及色号结构',()=>{
    for(const wrapper of ['pre','code','kbd','textarea','svg','mjx-container']){
        const content='<strong><em>示例</em></strong><em><del>Rd</del></em> H~2~O';
        const root=html(wrapper==='svg'?`<svg><foreignObject><div>${content}</div></foreignObject></svg>`:`<${wrapper}>${content}</${wrapper}>`);
        const before=root.innerHTML;M.normalizeSubSup(root,true);assert.equal(root.innerHTML,before,wrapper);
    }
    const root=html('<p><strong><em>正常</em></strong><em><del>Rd</del></em> H~2~O</p>');M.normalizeSubSup(root,true);
    assert.ok(root.querySelector('em > strong'));assert.equal(root.querySelectorAll('sub').length,2);
});

test('自动链接的显示地址保留原样，自定义链接文字仍可使用上下标',()=>{
    const address='https://example.org/~user~?value=^key^';
    const root=html(`<a href="${address}">${address}</a><a href="https://example.org/">H~2~O 和 x^2^</a>`);
    M.normalizeSubSup(root,true);const links=root.querySelectorAll('a');
    assert.equal(links[0].textContent,address);assert.equal(links[0].getAttribute('href'),address);assert.equal(links[0].querySelector('sub,sup'),null);
    assert.equal(links[1].querySelector('sub').textContent,'2');assert.equal(links[1].querySelector('sup').textContent,'2');
});

test('完整阅读流水线不在代码、公式和 SVG 内执行行内增强，正文仍正常',()=>{
    const content='<em><code>标签</code></em> <em>提示<strong>隐藏</strong></em> 字<em><sup>zì</sup></em> <em><sub>Rd</sub></em> <strong><mark>50</mark></strong> <em><mark>A → B</mark></em> 后缀';
    for(const wrapper of [
        `<pre><code class="literal">${content}</code></pre>`,
        `<div class="math"><div class="literal">${content}</div></div>`,
        `<svg><foreignObject><div class="literal">${content}</div></foreignObject></svg>`,
    ]){
        const root=html(wrapper+'<p>正文 <strong><mark>75</mark></strong></p>'),literal=root.querySelector('.literal'),before=literal.innerHTML;
        M.renderSection(root,ctx());assert.equal(literal.innerHTML,before,wrapper.slice(0,40));
        assert.equal(root.querySelector('p .v-pgbar').textContent,'75');
    }
});

test("面包屑", () => {
    const el = html(`<p>点击 <em><mark>文件 &gt; 导出 &gt; HTML</mark></em></p>`);
    M.renderSection(el, ctx());
    const bc = el.querySelector(".v-stepwise");
    assert.ok(bc);
    assert.equal(bc.querySelectorAll("label").length, 2);
    assert.equal(bc.getAttribute("data-clipboard-text"), "文件 > 导出 > HTML");
});

test("表格：横向 / 纵向合并", () => {
    const el = html(`<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead><tbody>
        <tr><td>1</td><td>横向</td><td>==</td></tr>
        <tr><td>:</td><td>x</td><td>y</td></tr></tbody></table>`);
    M.renderSection(el, ctx());
    const tds = el.querySelectorAll("tbody td");
    assert.equal(el.querySelector("td[colspan]").getAttribute("colspan"), "2");
    assert.equal(el.querySelector("td[rowspan]").textContent, "1");
    assert.equal(el.querySelector("td[rowspan]").getAttribute("rowspan"), "2");
    assert.equal(tds.length, 4);
});

test("表格：列格式（粗体、删除线、复选框、数值）", () => {
    const el = html(`<table><thead><tr>
        <th><strong>名称</strong></th><th><del>隐藏</del></th><th>[]完成</th><th style="text-align: right;">金额</th></tr></thead><tbody>
        <tr><td>a</td><td>x</td><td>Y</td><td>-12345.5</td></tr>
        <tr><td>b</td><td>y</td><td>?</td><td>88.8%</td></tr></tbody></table>`);
    M.renderSection(el, ctx());
    assert.equal(el.querySelectorAll("thead th").length, 3, "删除线列不发布");
    assert.ok(el.querySelector("td").classList.contains("v-tbl-col-fmt-bold"));
    assert.equal(el.querySelector(".v-tbl-col-fmt-chkbox svg").getAttribute("data-chk"), "yes");
    const num = el.querySelectorAll(".v-tbl-col-fmt-num")[0];
    assert.ok(num.classList.contains("v-tbl-col-fmt-num-negative"));
    assert.match(num.textContent, /-12,345\.5/);
    assert.ok(el.querySelector(".v-tbl-col-fmt-percent"));
});

test("表格：行分组折叠", () => {
    const el = html(`<table><thead><tr><th>分类</th><th>B</th></tr></thead><tbody>
        <tr><td>动物</td><td></td></tr>
        <tr><td>&gt; 脊椎动物</td><td></td></tr>
        <tr><td>&gt;&gt; 哺乳动物</td><td></td></tr>
        <tr><td>植物</td><td></td></tr></tbody></table>`);
    M.renderSection(el, ctx());
    const rows = el.querySelectorAll("tbody tr");
    assert.equal(rows[0].dataset.folder, "true");
    assert.equal(rows[1].dataset.parentFolderId, rows[0].dataset.folderId);
    assert.ok(rows[1].classList.contains('vlook-row-folded'));
    rows[0].querySelector(".v-tbl-row-g-btn").click();
    assert.ok(!rows[1].classList.contains('vlook-row-folded'));
});

test("表格：单元格背景着色", () => {
    const el = html(`<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>内容<em>~Rd!~</em></td></tr></tbody></table>`);
    M.renderSection(el, ctx());
    assert.equal(el.querySelector("td").getAttribute("data-rb-cell-bg"), "Rd");
});

test("图片 #魔法：从源码恢复后缀并生成插图题注", () => {
    const md = "![VLOOK 标志](pic/logo.png#200w \"副题注\")";
    const c = withSource(md, 0);
    const el = html(`<p><img src="app://local/vault/pic/logo.png?123" alt="VLOOK 标志"></p>`);
    M.renderSection(el, c);
    const img = el.querySelector("img");
    assert.match(img.getAttribute("src"), /#200w$/);
    assert.ok(el.querySelector("figure.v-cap-cntr .v-caption.figure"));
    assert.match(el.querySelector(".v-cap-1").textContent, /1 VLOOK 标志/);
    assert.equal(el.querySelector(".v-cap-2").textContent, "副题注");
});

test("图片 #icon 不作为插图", () => {
    const md = "前 ![](a.png#icon) 后";
    const c = withSource(md, 0);
    const el = html(`<p>前 <img src="app://x/a.png"> 后</p>`);
    M.renderSection(el, c);
    assert.equal(el.querySelector("figure"), null);
    assert.ok(el.querySelector(".v-icon img"));
});

test("被原样输出的图片与 <br> 还原", () => {
    const el = html(`<blockquote><p><mark>![](pic/a.svg?fill=text#icon2x)&lt;br&gt;&lt;br&gt;小标题</mark></p></blockquote>`);
    M.renderSection(el, ctx());
    assert.equal(el.querySelectorAll("mark br").length, 2);
    assert.ok(el.querySelector("mark .internal-embed[src='pic/a.svg?fill=text#icon2x']"));
    assert.ok(!el.textContent.includes("!["));
});

test("链接内的标签色号", () => {
    const el = html(`<p><a href="https://x"><em><code>VIP</code></em><em>~BnGd~</em></a></p>`);
    M.renderSection(el, ctx());
    const code = el.querySelector("a code.v-tag");
    assert.ok(code);
    assert.match(code.getAttribute("style") || "", /linear-gradient/);
    assert.ok(!el.textContent.includes("~"));
});

test("音频：mini 控件与标准控件", () => {
    const el = html(`<p><img src="media/a.mp3?controls=mini&pause=true"> 点击播放</p>`);
    M.renderSection(el, ctx());
    const audio = el.querySelector("audio");
    assert.ok(audio && !audio.controls);
    assert.ok(el.querySelector(".v-audio-mini-control"));
    const el2 = html(`<p><img src="media/b.mp3?loop=true" alt="音频示例"></p>`);
    M.renderSection(el2, ctx());
    const a2 = el2.querySelector("audio");
    assert.ok(a2.controls && a2.loop);
    assert.ok(el2.querySelector("figure .v-caption audio"));
});

test("视频：宽高参数", () => {
    const el = html(`<p><img src="media/v.mp4?preload=true&height=240"></p>`);
    M.renderSection(el, ctx());
    const v = el.querySelector("video");
    assert.equal(v.getAttribute("height"), "240");
    assert.equal(v.preload, "auto");
});

test("表格：仅含待解析嵌入的单元格不被当作空单元格清空", () => {
    const el = html(`<table><thead><tr><th>a</th><th>示例</th></tr></thead><tbody><tr><td>x</td><td><span class="internal-embed" src="media/a.mp3?controls=mini"></span></td></tr></tbody></table>`);
    M.renderSection(el, ctx());
    assert.ok(el.querySelector("td .internal-embed, td audio"));
    assert.ok(!el.querySelector("td.v-empty-cell"));
});

test("表格内的音频不使用表格的题注编号", () => {
    const el = html(`<table><thead><tr><th>a</th><th>示例</th></tr></thead><tbody><tr><td>x</td><td><img src="media/a.mp3?loop=true" alt="循环播放"></td></tr></tbody></table>`);
    const source='![先行](first.mp3)\n\n*==示例表==*\n\n|a|示例|\n|---|---|\n|x|![循环播放](media/a.mp3?loop=true)|';
    M.renderSection(el, withSource(source,4));
    assert.ok(el.querySelector("td audio"));
    assert.match(el.querySelector("td .v-caption figcaption").textContent, /(?:音频|Audio) 2.*循环播放/);
    assert.match(el.querySelector(".v-caption.table > figcaption").textContent, /(?:表|Table) 1.*示例表/);
});

test("Obsidian 原生音频嵌入：alt 作为题注", () => {
    const el = html(`<p><span class="internal-embed" src="media/a.mp3" alt="标准模式"></span></p>`);
    M.renderSection(el, ctx());
    assert.match(el.querySelector(".v-caption figcaption")?.textContent || "", /(音频|Audio).*标准模式/);
});

test("导出：app:// 资源地址改为相对路径并去掉时间戳", () => {
    const el = html(`<p><a href="https://x"><img src="app://abc/Users/me/vault/samples/pic/icon%20more.svg?1792512482835&fill=text#icon"></a><img src="https://x/y.png"></p>`);
    M.appUrlsToRelative(el, "/Users/me/vault", "samples");
    const [a, b] = el.querySelectorAll("img");
    assert.equal(a.getAttribute("src"), "pic/icon%20more.svg?fill=text#icon");
    assert.equal(b.getAttribute("src"), "https://x/y.png");
});

test("字面量图片与 <br>：跨多个相邻文本节点也能还原", () => {
    const el = html(`<blockquote><p><mark></mark></p></blockquote>`);
    const mark = el.querySelector("mark");
    ["![](pic/a.svg?fill=text", "&darksrc=invert#icon2x)", "<br><br>小标题"].forEach(t => mark.append(document.createTextNode(t)));
    M.normalizeSubSup(el, false);
    assert.ok(!mark.textContent.includes("!["));
    assert.equal(mark.querySelectorAll("br").length, 2);
});

test("代码块助手：保留高亮、切换换行和长代码折叠", () => {
    const source = Array.from({length: 25}, (_, i) => `line${i}`).join("\n");
    const el = html(`<pre><code class="language-js"><span class="token">${source}</span></code></pre>`);
    M.renderSection(el, ctx());
    const pre = el.querySelector("pre");
    assert.equal(el.querySelector("code").textContent, source);
    assert.ok(el.querySelector(".token"));
    const buttons = el.querySelectorAll(".vlook-code-tools button");
    assert.equal(buttons.length, 3);
    assert.ok(pre.classList.contains("vlook-code-collapsed"));
    buttons[2].click();
    assert.ok(!pre.classList.contains("vlook-code-collapsed"));
    buttons[1].click();
    assert.ok(!pre.classList.contains("vlook-code-wrap"));
    M.renderSection(el, ctx());
    assert.equal(el.querySelectorAll(".vlook-code-tools").length, 1);
    assert.equal(el.querySelectorAll(".vlook-view-menu").length, 1);
    assert.ok(el.querySelector(".vlook-view-menu .vlook-content-tools"));
});

test("交叉引用：源码索引识别尚未渲染的标题和失效锚点", () => {
    const el = html('<p><a href="#目标章节">跳转</a> <a href="#不存在">失效</a> <a href="https://example.org">外链</a></p>');
    const index = M.getSourceIndex("# 目标章节\n\n正文\n\n# 第二章\n", {captionGroup:false, captionNumber:true});
    M.renderSection(el, ctx({index}));
    assert.ok(!el.querySelector('a[href="#目标章节"]').classList.contains("vlook-link-missing"));
    assert.ok(el.querySelector('a[href="#不存在"]').classList.contains("vlook-link-missing"));
    assert.equal(el.querySelector('a[href^="https"]').rel, "noopener noreferrer");
});

test('脚注角标及字面区域链接不被页内交叉引用误标或改写',()=>{
    const root=html('<p><sup class="footnote-ref"><a href="#fn-one">1</a></sup><sup data-footnote-id="one"><a href="#fn-two">2</a></sup><a class="footnote-backref" href="#fn-ref">返回</a></p><pre><code><a href="#不存在">示例</a><a href="https://example.org/">外链示例</a></code></pre><p><a href="#不存在">真正失效</a></p>');
    const index=M.getSourceIndex('# 正文\n\n[^one]: 脚注',{captionGroup:false,captionNumber:true});
    M.renderSection(root,ctx({index}));
    assert.equal(root.querySelectorAll('.vlook-link-missing').length,1);
    assert.equal(root.querySelector('pre a').dataset.vlookLink,undefined);
    assert.equal(root.querySelector('pre a[href^="https"]').hasAttribute('target'),false);
    assert.equal(root.querySelector('sup a').hasAttribute('title'),false);
});

test('字面区域中的跨文档链接不会触发文件读取',async()=>{
    let reads=0;const app={metadataCache:{getFirstLinkpathDest:()=>({path:'target.md',extension:'md'})},vault:{cachedRead:async()=>{reads++;return '# 标题'}}};
    const root=html('<pre><code><a href="target.md#标题">代码示例</a></code></pre><div class="math"><a href="target.md#标题">公式示例</a></div>');
    await M.processExternalReferences(root,ctx({app}));assert.equal(reads,0);assert.equal(root.querySelector('[data-vlook-external-ref]'),null);
});

test('页内链接重用后重建点击目标，旧 cleanup 不移除新处理器',()=>{
    const root=html('<a href="#一">链接</a>'),anchor=root.querySelector('a'),calls=[],oldCleanup=[],newCleanup=[];
    const app={workspace:{openLinkText:(...args)=>calls.push(args)}};
    const index=M.getSourceIndex('# 一\n\n正文\n\n# 二',{captionGroup:false,captionNumber:true});
    M.processLinks(root,ctx({app,index,registerCleanup:fn=>oldCleanup.push(fn)}));
    anchor.setAttribute('href','#二');anchor.click();assert.equal(calls.length,0);
    M.processLinks(root,ctx({app,index,registerCleanup:fn=>newCleanup.push(fn)}));oldCleanup.forEach(fn=>fn());
    anchor.click();assert.equal(calls.length,1);assert.equal(calls[0][3].eState.line,4);
    newCleanup.forEach(fn=>fn());anchor.click();assert.equal(calls.length,1);
});

test('链接重用清除旧失效状态，清理时恢复原属性并保留外部新修改',()=>{
    const root=html('<a href="#缺失" title="原提示" aria-label="原标签">链接</a>'),anchor=root.querySelector('a');
    const index=M.getSourceIndex('# 一',{captionGroup:false,captionNumber:true});
    M.processLinks(root,ctx({index}));assert.ok(anchor.classList.contains('vlook-link-missing'));
    anchor.setAttribute('href','https://example.org/');const cleanups=[];
    M.processLinks(root,ctx({index,registerCleanup:fn=>cleanups.push(fn)}));
    assert.equal(anchor.classList.contains('vlook-link-missing'),false);assert.equal(anchor.title,'原提示');assert.equal(anchor.target,'_blank');
    anchor.setAttribute('rel','author');cleanups.forEach(fn=>fn());
    assert.equal(anchor.hasAttribute('target'),false);assert.equal(anchor.rel,'author');assert.equal(anchor.getAttribute('aria-label'),'原标签');
});

test('异步跨文档引用移入代码后取消旧请求，不写回字面区域',async()=>{
    let finish;const app={metadataCache:{getFirstLinkpathDest:()=>({path:'target.md',extension:'md'})},vault:{cachedRead:()=>new Promise(resolve=>{finish=resolve})}};
    const root=html('<a href="target.md#标题" aria-label="原标签">链接</a>'),anchor=root.querySelector('a');
    const context=ctx({app,cssVar:()=> 'h1{{###. }}'}),pending=M.processExternalReferences(root,context);
    await Promise.resolve();const pre=document.createElement('pre');root.append(pre);pre.append(anchor);
    await M.processExternalReferences(root,context);finish('# 标题');await pending;
    assert.equal(anchor.dataset.vlookExternalRef,undefined);assert.equal(anchor.dataset.vlookRef,undefined);assert.equal(anchor.getAttribute('aria-label'),'原标签');
});

test('图片参数还原按完整键合并，源码覆盖旧值且重复处理不累加',()=>{
    const source='![图](a.png?fill=blue&flag&fill=red#100w)',root=html('<img src="a.png?f%69ll=old&cache=1">');
    M.restoreImages(root,source,(_raw,current)=>current);
    const image=root.querySelector('img');assert.equal(image.getAttribute('src'),'a.png?cache=1&fill=blue&flag&fill=red#100w');
    const result=image.getAttribute('src');M.restoreImages(root,source,(_raw,current)=>current);assert.equal(image.getAttribute('src'),result);
});

test('图片查询参数不会因路径或其他参数值包含同形子串而遗漏',()=>{
    const root=html('<img src="a=1.png?data=a=1">');M.restoreImages(root,'![图](a=1.png?a=1)',(_raw,current)=>current);
    assert.equal(root.querySelector('img').getAttribute('src'),'a=1.png?data=a=1&a=1');
});

test('视频封面与 src 一起导出为相对路径，库外和远程资源不误改',()=>{
    const root=html('<video src="app://local/vault/media/demo.mp4?123&loop" poster="app://local/vault/pic/a%23b.png?456#cover"></video><video poster="https://example.org/poster.png"></video><img src="app://local/vault-other/a.png">');
    M.appUrlsToRelative(root,'/vault','notes');const video=root.querySelector('video');
    assert.equal(video.getAttribute('src'),'../media/demo.mp4?loop');assert.equal(video.getAttribute('poster'),'../pic/a%23b.png#cover');
    assert.equal(root.querySelectorAll('video')[1].getAttribute('poster'),'https://example.org/poster.png');assert.equal(root.querySelector('img').getAttribute('src'),'app://local/vault-other/a.png');
});

test('Windows 库路径的盘符及分隔符转换，缺失库根目录时不猜绝对路径',()=>{
    const root=html('<img src="app://local/c:/Users/Me/Vault/pic/a%20b.png?123"><source src="app://local/C:/Users/Me/Vault/audio/a.mp3">');
    M.appUrlsToRelative(root,['C:','Users','Me','Vault'].join(String.fromCharCode(92)),'notes');
    assert.equal(root.querySelector('img').getAttribute('src'),'../pic/a%20b.png');assert.equal(root.querySelector('source').getAttribute('src'),'../audio/a.mp3');
    const unknown=html('<img src="app://local/Users/me/private/a.png">'),before=unknown.innerHTML;
    M.appUrlsToRelative(unknown,'','notes');assert.equal(unknown.innerHTML,before);
});

test('导出 srcset 转换 img 和 picture source，保留描述符、逗号及 data URL',()=>{
    const root=html('<picture><source srcset="app://local/vault/pic/a,b.png?123 640w, app://local/vault/pic/large.png 1280w"><img srcset="data:text/plain,app://local/vault/inside-data 1x, app://local/vault/pic/a%20b.png?456 2x, https://example.org/a.png 3x"></picture>');
    M.appUrlsToRelative(root,'/vault','notes');
    assert.equal(root.querySelector('source').getAttribute('srcset'),'../pic/a%2Cb.png 640w, ../pic/large.png 1280w');
    assert.equal(root.querySelector('img').getAttribute('srcset'),'data:text/plain,app://local/vault/inside-data 1x, ../pic/a%20b.png 2x, https://example.org/a.png 3x');
    const result=root.innerHTML;M.appUrlsToRelative(root,'/vault','notes');assert.equal(root.innerHTML,result);
});

test('srcset 无描述符候选与括号中的逗号不破坏后续候选边界',()=>{
    const root=html('<img srcset="app://local/vault/a.png, app://local/vault/b.png invalid(foo,bar), app://local/vault/c.png 2x">');
    M.appUrlsToRelative(root,'/vault','');
    assert.equal(root.querySelector('img').getAttribute('srcset'),'a.png, b.png invalid(foo,bar), c.png 2x');
});

test('字幕轨道随媒体导出，保留语言、类型、默认选择和外部地址',()=>{
    const root=html('<video controls><source src="app://local/vault/media/a.mp4?123" type="video/mp4"><track kind="subtitles" srclang="zh" label="中文" default src="app://local/vault/sub/中文%20字幕.vtt?456"><track kind="captions" srclang="en" label="English" src="https://example.org/captions.vtt"></video>');
    M.appUrlsToRelative(root,'/vault','notes');M.toTyporaDom(root,true);
    const tracks=root.querySelectorAll('video track');assert.equal(tracks.length,2);
    assert.equal(tracks[0].getAttribute('src'),'../sub/%E4%B8%AD%E6%96%87%20%E5%AD%97%E5%B9%95.vtt');
    assert.equal(tracks[0].getAttribute('kind'),'subtitles');assert.equal(tracks[0].getAttribute('srclang'),'zh');assert.equal(tracks[0].getAttribute('label'),'中文');assert.equal(tracks[0].hasAttribute('default'),true);
    assert.equal(tracks[1].getAttribute('src'),'https://example.org/captions.vtt');assert.equal(root.querySelector('video source').getAttribute('src'),'../media/a.mp4');
});

test("编辑插入：保留选区，进度条使用原版语法", () => {
    let output;
    M.insertSyntax({getSelection: () => "42", replaceSelection: s => output = s}, M.INSERT_SYNTAX.find(s => s.id === "progress"));
    assert.equal(output, "**==42==**");
});

test("自动任务进度：只统计叶子，修改勾选后重新计算", () => {
    const md = '进度 **==?==**\n\n- [ ] 父任务\n  - [x] 一\n  - [ ] 二\n';
    let c = withSource(md, 0);
    assert.equal(M.taskPercentFromSource(c), 50);
    c = withSource(md.replace('[ ] 二', '[x] 二'), 0);
    assert.equal(M.taskPercentFromSource(c), 100);
});

test('自动任务进度支持有序和混合列表，不把围栏代码示例当作任务',()=>{
    const source='进度 **==?==**\n\n1. [x] 完成\n2. [ ] 父任务\n   - [X] 子任务\n   - 普通子项\n3. [ ] 未完成\n\n   ```md\n   - [x] 代码示例\n   ```\n';
    assert.equal(M.taskPercentFromSource(withSource(source,0)),50);
});

test('DOM 自动任务进度按当前复选框属性计算，忽略陈旧状态类',()=>{
    const root=html('<p>进度 <strong><mark>?</mark></strong></p><ul><li class="task-list-item is-checked"><input type="checkbox" checked>取消</li><li class="task-list-item"><input type="checkbox">完成</li></ul>');
    const inputs=root.querySelectorAll('input');inputs[0].checked=false;inputs[1].checked=true;
    M.renderSection(root,ctx());assert.equal(root.querySelector('strong').textContent,'50');
});

test("编辑图片定位：保留魔法参数与准确的替换范围", () => {
    const text = '前 ![标题](pic/a.png?darksrc=~#logo "副标题") 后 ![[pic/b.svg#icon|图标]]';
    const refs = M.sourceImages(text);
    assert.equal(refs.length, 2);
    assert.equal(text.slice(refs[0].pos, refs[0].end), '![标题](pic/a.png?darksrc=~#logo "副标题")');
    assert.equal(refs[0].title, "副标题");
    assert.equal(refs[1].raw, "pic/b.svg#icon");
});

test("编辑块级图片：避开代码围栏，光标进入后恢复源码", () => {
    const plugin = {settings:{...M.DEFAULT_SETTINGS}, app:{metadataCache:{getFirstLinkpathDest:()=>({path:"pic/a.png"})}}};
    const field = M.blockPreviewExtension(plugin);
    const doc = '开头\n\n![图](pic/a.png?darksrc=~#logo)\n\n```md\n![伪图片](pic/a.png?darksrc=~#logo)\n```';
    let state = M.EditorState.create({doc, extensions:[M.editorInfoField, M.editorLivePreviewField, field]});
    const plans=M.blockPreviewPlans(M.getSourceIndex(doc,{captionGroup:false,captionNumber:true}),M.DEFAULT_SETTINGS);
    assert.deepEqual(plans.map(p=>p.blocks[0].type),['image','code']);
    assert.equal(state.field(field).size, 2);
    state = state.update({selection:{anchor:doc.indexOf('![图]')}}).state;
    assert.equal(state.field(field).size, 1);
});

test("编辑进度装饰器随任务勾选更新，不依赖滚动重建", () => {
    const plugin = {settings:{...M.DEFAULT_SETTINGS}, app:{workspace:{getActiveFile:()=>({path:'test.md'})}}};
    const field = M.livePreviewExtension(plugin);
    const doc = '前言\n\n进度 **==?==**\n\n- [x] 一\n- [ ] 二\n';
    let state = M.EditorState.create({doc, extensions:[M.editorInfoField, M.editorLivePreviewField, field]});
    const text = () => {
        let result = '';
        state.field(field).between(0, state.doc.length, (_from, _to, deco) => {
            if (deco.spec.widget) result += deco.spec.widget.toDOM().textContent;
        });
        return result;
    };
    assert.equal(text(), '50');
    const at = doc.indexOf('[ ]') + 1;
    state = state.update({changes:{from:at, to:at + 1, insert:'x'}}).state;
    assert.equal(text(), '100');
});

test('实时预览各级父任务只统计自己的子列表，勾选后独立更新',()=>{
    const plugin={settings:{...M.DEFAULT_SETTINGS},app:{workspace:{getActiveFile:()=>({path:'test.md'})}}};
    const field=M.livePreviewExtension(plugin);
    const doc='前言\n\n整体 **==?==**\n\n- [ ] 甲 **==?==**\n  - [x] 甲一\n  - [ ] 甲二\n- [ ] 乙 **==?==**\n  1. [x] 乙一\n  2. [x] 乙二\n- [ ] 没有子列表 **==?==**\n';
    let state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
    const values=()=>{const result=[];state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)result.push(deco.spec.widget.toDOM().textContent)});return result};
    assert.deepEqual(values(),['60','50','100']);
    const offset=doc.indexOf('[ ] 甲二')+1;state=state.update({changes:{from:offset,to:offset+1,insert:'x'}}).state;
    assert.deepEqual(values(),['80','100','100']);
});

test('引用块内的父任务进度按局部列表计算，围栏内同形语法保持源码',()=>{
    const plugin={settings:{...M.DEFAULT_SETTINGS},app:{workspace:{getActiveFile:()=>({path:'test.md'})}}};
    const field=M.livePreviewExtension(plugin);
    const doc='前言\n\n> 整体 **==?==**\n>\n> - [ ] 父项 **==?==**\n>   - [X] 完成\n>   - [ ] 未完成\n\n```md\n伪进度 **==?==**\n\n- [x] 伪任务\n```\n';
    const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
    const result=[];state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)result.push(deco.spec.widget.toDOM().textContent)});
    assert.deepEqual(result,['50','50']);
});

test('编辑进度范围更新保留标题后列表的自动进度',()=>{
    const plugin={settings:{...M.DEFAULT_SETTINGS},app:{workspace:{getActiveFile:()=>({path:'test.md'})}}};
    const field=M.livePreviewExtension(plugin),doc='前言\n\n## 进度 **==?==**\n\n1. [x] 完成\n';
    const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
    const values=[];state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)values.push(deco.spec.widget.toDOM().textContent)});assert.deepEqual(values,['100']);
});

test('引用块和列表内的围栏、缩进代码不生成行内增强装饰器',()=>{
    const plugin={settings:{...M.DEFAULT_SETTINGS},app:{workspace:{getActiveFile:()=>({path:'test.md'})}}};
    for(const literal of [
        '> ```md\n> **==25==** _^code^_\n> ```',
        '- 项目\n\n  ```md\n  **==25==** _^code^_\n  ```',
        '- 项目\n\n      **==25==** _^code^_',
        '> <pre>\n> **==25==** _^code^_\n> </pre>',
    ]){
        const field=M.livePreviewExtension(plugin),doc='前言\n\n'+literal+'\n\n正常 **==75==**\n';
        const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
        const values=[];state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)values.push(deco.spec.widget.toDOM().textContent)});
        assert.deepEqual(values,['75'],literal);
    }
});

test('普通行内代码不渲染内部语法，VLOOK 代码式标签、徽章和注音仍正常',()=>{
    const plugin={settings:{...M.DEFAULT_SETTINGS},app:{workspace:{getActiveFile:()=>({path:'test.md'})}}};
    const field=M.livePreviewExtension(plugin);
    const doc='前言\n\n`**==25==** ~下标~ ^上标^` ``*`伪标签`*``\n\n*`真标签`* *名称`值`后缀* `{字}(zì)` **==75==**\n';
    const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
    const values=[];state.field(field).between(0,state.doc.length,(from,to,deco)=>{if(deco.spec.widget)values.push({source:state.doc.sliceString(from,to),text:deco.spec.widget.toDOM().textContent})});
    assert.deepEqual(values.map(value=>value.source),['*`真标签`*','*名称`值`后缀*','`{字}(zì)`','**==75==**']);
    assert.equal(values.at(-1).text,'75');
});

test('段落着色可包含普通行内代码，多行行内代码中的伪语法保持原样',()=>{
    const plugin={settings:{...M.DEFAULT_SETTINGS},app:{workspace:{getActiveFile:()=>({path:'test.md'})}}};
    const field=M.livePreviewExtension(plugin),doc='前言\n\n_~Rd~_ 正文 `**==25==**`\n\n`跨行\n**==30==** ~sub~\n结束`\n\n**==75==**\n';
    const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
    const values=[],marks=[];state.field(field).between(0,state.doc.length,(from,to,deco)=>{
        if(deco.spec.widget)values.push(deco.spec.widget.toDOM().textContent);
        if(deco.spec.class==='vlook-lp-colored')marks.push(state.doc.sliceString(from,to));
    });
    assert.deepEqual(values,['75']);assert.deepEqual(marks,['正文 `**==25==**`']);
});

test('转义的行内语法保持原样，偶数反斜杠后的真实语法仍可增强',()=>{
    const plugin={settings:{...M.DEFAULT_SETTINGS},app:{workspace:{getActiveFile:()=>({path:'test.md'})}}};
    const field=M.livePreviewExtension(plugin),slash=String.fromCharCode(92);
    const doc='前言\n\n'+slash+'**==25==** '+slash+'*`伪标签`* '+slash+'~sub~ '+slash+'^sup^ ~尾部'+slash+'~\n\n'+slash+slash+'~真下标~ '+slash+slash+'^真上标^ **==75==**\n';
    const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
    const values=[];state.field(field).between(0,state.doc.length,(from,to,deco)=>{if(deco.spec.widget)values.push(state.doc.sliceString(from,to))});
    assert.deepEqual(values,['~真下标~','^真上标^','**==75==**']);
});

test('反斜杠不冒充注音文字，非标点前的反斜杠不禁用真实注音',()=>{
    const plugin={settings:{...M.DEFAULT_SETTINGS},app:{workspace:{getActiveFile:()=>({path:'test.md'})}}};
    const field=M.livePreviewExtension(plugin),slash=String.fromCharCode(92);
    const doc='前言\n\n字'+slash+'_^zì^_ *提示**内容'+slash+'***\n\n'+slash+'字_^zì^_\n';
    const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
    const values=[];state.field(field).between(0,state.doc.length,(from,to,deco)=>{if(deco.spec.widget)values.push(state.doc.sliceString(from,to))});
    assert.deepEqual(values,['字_^zì^_']);
});

test('编辑进度与阅读共用零值、负值、超额及指定色号显示',async()=>{
    const plugin={settings:{...M.DEFAULT_SETTINGS},app:{workspace:{getActiveFile:()=>({path:'test.md'})}}};
    const field=M.livePreviewExtension(plugin),doc='前言\n\n**==0==** **==-25==** **==125==** **==50==**_~Bu~_\n';
    const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]}),widgets=[];
    state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)widgets.push(deco.spec.widget.toDOM().querySelector('strong'))});
    const reading=html('<p><strong><mark>0</mark></strong> <strong><mark>-25</mark></strong> <strong><mark>125</mark></strong> <strong data-rb-text="bu" style="color:var(--ac-bu)"><mark>50</mark></strong></p>');
    M.renderSection(reading,ctx());await new Promise(resolve=>window.requestAnimationFrame(resolve));
    const labels=Array.from(reading.querySelectorAll('strong label'));
    assert.equal(widgets.length,4);assert.equal(widgets[0].style.color,'var(--ac-gy)');
    assert.equal(widgets[1].querySelector('label').style.outlineStyle,'dashed');
    assert.ok(parseFloat(widgets[1].querySelector('label').style.marginLeft)>0);assert.ok(parseFloat(widgets[2].querySelector('label').style.marginRight)>0);
    widgets.forEach((widget,i)=>{const label=widget.querySelector('label');for(const property of ['background','outlineStyle','boxShadow','marginLeft','marginRight'])assert.equal(label.style[property],labels[i].style[property],property)});
});

test('进度条拒绝非十进制和非有限数值，负值阴影保留原版正常色',async()=>{
    const root=html('<p><strong><mark>0x10</mark></strong> <strong><mark>Infinity</mark></strong> <strong><mark>50%</mark></strong> <strong><mark>-25</mark></strong></p>');
    M.renderSection(root,ctx());await new Promise(resolve=>window.requestAnimationFrame(resolve));
    assert.equal(root.querySelectorAll('.v-pgbar').length,1);const label=root.querySelector('.v-pgbar label');
    assert.ok(label.style.boxShadow.includes('var(--ac-rd)'));assert.ok(label.style.background.includes('var(--ac-rd-a-lg)'));
});

test('编辑进度色号支持强调后缀，无效色号不作为进度颜色消费',()=>{
    const plugin={settings:{...M.DEFAULT_SETTINGS},app:{workspace:{getActiveFile:()=>({path:'test.md'})}}};
    const field=M.livePreviewExtension(plugin),doc='前言\n\n**==25==**_~Rd!~_ **==50==**_~Nope~_\n';
    const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]}),values=[];
    state.field(field).between(0,state.doc.length,(from,to,deco)=>{if(deco.spec.widget)values.push({source:state.doc.sliceString(from,to),element:deco.spec.widget.toDOM()})});
    assert.deepEqual(values.map(item=>item.source),['**==25==**_~Rd!~_','**==50==**']);
    assert.equal(values[0].element.querySelector('strong').getAttribute('data-rb-text'),'rd');
    assert.equal(values[1].element.querySelector('strong').hasAttribute('data-rb-text'),false);
});

test('独占段落分页：阅读渲染保留原版类，代码与行内提及不触发', () => {
    const el = html('<p>---page</p><p>示例 ---page</p><p><code>---page</code></p>');
    M.renderSection(el, ctx());
    assert.equal(el.querySelectorAll('.v-page-break').length, 1);
    assert.equal(el.querySelector('.v-page-break').getAttribute('aria-label'), '分页标记');
    const quote = html('<blockquote><p>---page</p></blockquote>');
    M.renderSection(quote, ctx());
    assert.equal(quote.querySelector('.v-page-break'), null);
});

test('表格内容助手：换行与冻结切换，十字阅读支持合并单元格及隐藏行导航', () => {
    const root = html('<table class="v-freeze"><thead><tr><th colspan="2">合并标题</th><th>C</th></tr></thead><tbody><tr><td rowspan="2">A</td><td>B1</td><td>C1</td></tr><tr style="display:none"><td>B2</td><td>C2</td></tr><tr><td>A3</td><td>B3</td><td>C3</td></tr></tbody></table>');
    M.processTableTools(root);
    const table = root.querySelector('table');
    const grid = M.tableGrid(table);
    assert.equal(grid[0][0], grid[0][1]);
    assert.equal(grid[1][0], grid[2][0]);
    const buttons = root.querySelectorAll('.vlook-table-tools button');
    buttons[0].click(); assert.ok(table.classList.contains('vlook-table-wrap'));
    buttons[0].click(); assert.ok(table.classList.contains('vlook-table-nowrap'));
    buttons[1].click(); assert.equal(table.classList.contains('v-freeze'), false);
    buttons[1].click(); assert.ok(table.classList.contains('v-freeze'));
    buttons[2].click();
    grid[0][0].click();
    const key = value => table.dispatchEvent(new window.KeyboardEvent('keydown', {key:value, bubbles:true, cancelable:true}));
    key('ArrowRight'); assert.ok(grid[0][2].classList.contains('vlook-table-current'));
    key('ArrowDown'); assert.ok(grid[1][2].classList.contains('vlook-table-current'));
    key('ArrowDown'); assert.ok(grid[3][2].classList.contains('vlook-table-current'));
    key('Escape'); assert.equal(table.querySelector('.vlook-table-current'), null);
    M.processTableTools(root); assert.equal(root.querySelectorAll('.vlook-table-tools').length, 1);
});

test('十字阅读网格：rowspan 不穿越行组且不生成虚构行', () => {
    const root = html('<table><thead><tr><th rowspan="999">标题</th><th>B</th></tr></thead><tbody><tr><td rowspan="0">A</td><td>B1</td></tr><tr><td>B2</td></tr></tbody></table>');
    const grid = M.tableGrid(root.querySelector('table'));
    assert.equal(grid.length, 3);
    assert.equal(grid[1][0].textContent, 'A');
    assert.equal(grid[1][0], grid[2][0]);
    assert.equal(grid[2][1].textContent, 'B2');
});

test('表格网格的 rowspan=0 仅跨真实行，不把脚本节点算入行组',()=>{
    const root=html('<table><tbody><tr><td rowspan="0">首组</td></tr><script type="application/json">{}</script></tbody><tbody><tr><td>次组</td></tr></tbody></table>');
    const grid=M.tableGrid(root.querySelector('table'));assert.equal(grid.length,2);
    assert.equal(grid[0][0].textContent,'首组');assert.equal(grid[1][0].textContent,'次组');assert.equal(grid[1].length,1);
});

test('十字阅读 Enter 只切换当前表格行分组，不触发嵌套表格按钮',()=>{
    const root=html('<table id="outer"><tr><td id="cell">外层<table><tr><td><button class="v-tbl-row-g-btn" id="inner">内层</button></td></tr></table><button class="v-tbl-row-g-btn" id="own">外层</button></td></tr></table>');
    M.processTableTools(root);const table=root.querySelector('#outer'),cell=root.querySelector('#cell');let inner=0,own=0;
    root.querySelector('#inner').addEventListener('click',()=>inner++);root.querySelector('#own').addEventListener('click',()=>own++);
    Array.from(table.previousElementSibling.querySelectorAll('button')).find(button=>button.textContent==='十字阅读').click();cell.click();
    table.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(own,1);assert.equal(inner,0);
    root.querySelector('#own').remove();table.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(inner,0);
});

test('外层表格格式和列编号不扩散至嵌套表格，内层合并独立执行',()=>{
    const root=html('<table id="outer"><thead><tr><th><strong>外层标题</strong></th><th>外二</th></tr></thead><tbody><tr><td id="outer-cell">正文<table id="inner"><thead><tr><th><em>内标题</em></th><th>内二</th></tr></thead><tbody><tr><td>A</td><td>==</td></tr><tr><td>B</td><td>C</td></tr></tbody></table></td><td>外数据</td></tr></tbody></table>');
    M.renderSection(root,ctx());const outer=root.querySelector('#outer'),inner=root.querySelector('#inner');
    assert.equal(outer.dataset.cellMerge,undefined);assert.equal(inner.dataset.cellMerge,'true');
    assert.equal(inner.querySelector('tbody td').getAttribute('colspan'),'2');
    const outerId=outer.dataset.num,innerId=inner.dataset.num;assert.notEqual(outerId,innerId);
    for(const cell of inner.querySelectorAll('th,td')){
        assert.ok(cell.dataset.tblCol.startsWith('tbl-'+innerId+'-'));assert.equal(cell.classList.contains('v-tbl-col-fmt-bold'),false);
    }
    assert.ok(root.querySelector('#outer-cell').classList.contains('v-tbl-col-fmt-bold'));
    assert.equal(inner.querySelectorAll('tbody td').length,3);
});

test('嵌套表格行分组独立识别与折叠，不把外层标记为分组表',()=>{
    const root=html('<table id="outer"><tbody><tr id="outer-row"><td>容器<table id="inner"><tbody><tr><td>组</td><td>A</td></tr><tr id="child"><td>&gt; 子项</td><td>B</td></tr></tbody></table></td></tr></tbody></table>');
    M.renderSection(root,ctx());const outer=root.querySelector('#outer'),inner=root.querySelector('#inner'),child=root.querySelector('#child');
    assert.equal(outer.dataset.rowGroup,undefined);assert.equal(inner.dataset.rowGroup,'true');
    assert.equal(inner.querySelectorAll('.v-tbl-row-g-btn').length,1);assert.ok(child.classList.contains('vlook-row-folded'));
    inner.querySelector('.v-tbl-row-g-btn').click();assert.ok(!child.classList.contains('vlook-row-folded'));
    assert.ok(!root.querySelector('#outer-row').classList.contains('vlook-row-folded'));
});

test('行分组跳过非行节点，无父行或跨 tbody 的孤立标记保持可见',()=>{
    const root=html('<table><tbody><tr id="parent"><td>父组</td></tr><script type="application/json">{}</script><tr id="child"><td>&gt; 子项</td></tr></tbody><tbody><tr id="orphan"><td>&gt; 新行组孤立项</td></tr></tbody></table>');
    M.renderSection(root,ctx());const parent=root.querySelector('#parent'),child=root.querySelector('#child'),orphan=root.querySelector('#orphan');
    assert.ok(parent.querySelector('.v-tbl-row-g-btn'));assert.ok(child.classList.contains('vlook-row-folded'));
    assert.ok(!orphan.classList.contains('vlook-row-folded'));assert.ok(orphan.textContent.includes('> 新行组孤立项'));assert.equal(orphan.dataset.parentFolderId,undefined);
    parent.querySelector('.v-tbl-row-g-btn').click();assert.ok(!child.classList.contains('vlook-row-folded'));assert.ok(!orphan.classList.contains('vlook-row-folded'));
});

test('原生表格助手展开和收起全部分组，多级处理幂等且隔离嵌套表格',()=>{
    const root=html('<table id="outer"><tbody><tr><td>父组<table id="inner"><tr><td>内父</td></tr><tr id="inner-child"><td>&gt; 内子</td></tr></table></td></tr><tr id="level1"><td>&gt; 一级</td></tr><tr id="level2"><td>&gt;&gt; 二级</td></tr><tr id="sibling"><td>&gt; 同级</td></tr></tbody></table>');
    M.renderSection(root,ctx());const table=root.querySelector('#outer'),tools=root.querySelector(':scope > .vlook-view-menu .vlook-table-tools');
    const expand=Array.from(tools.querySelectorAll('button')).find(button=>button.textContent==='展开全部分组'),collapse=Array.from(tools.querySelectorAll('button')).find(button=>button.textContent==='收起全部分组');
    assert.ok(expand&&collapse);assert.equal(expand.hasAttribute('aria-pressed'),false);
    expand.click();expand.click();
    for(const id of ['level1','level2','sibling'])assert.ok(!root.querySelector('#'+id).classList.contains('vlook-row-folded'));
    assert.ok(root.querySelector('#inner-child').classList.contains('vlook-row-folded'));
    collapse.click();collapse.click();
    for(const id of ['level1','level2','sibling'])assert.ok(root.querySelector('#'+id).classList.contains('vlook-row-folded'));
    const folders=Array.from(table.querySelectorAll('tr[data-folder="true"]')).filter(row=>row.closest('table')===table);
    assert.ok(folders.every(row=>row.dataset.rowFolded==='true'));
});

test('内容全屏：保留同一节点和交互，关闭后恢复原位，避免重复入口', () => {
    const root = html('<figure class="v-cap-cntr"><table><tr><td>数据</td></tr></table></figure>');
    document.body.append(root);
    const figure = root.querySelector('figure');
    let clicks = 0; figure.addEventListener('click', () => clicks++);
    const prototype = window.HTMLDialogElement.prototype;
    const oldShow = prototype.showModal, oldClose = prototype.close;
    prototype.showModal = function(){this.setAttribute('open','');};
    prototype.close = function(){this.removeAttribute('open');this.dispatchEvent(new window.Event('close'));};
    try {
        M.processContentViewers(root); M.processContentViewers(root);
        assert.equal(root.querySelectorAll('.vlook-content-tools').length, 1);
        const dialog = M.openContentViewer(figure);
        assert.equal(dialog.querySelector('figure'), figure);
        figure.click(); assert.equal(clicks, 1);
        assert.ok(root.querySelector('.vlook-content-placeholder'));
        dialog.close();
        assert.equal(root.querySelector('figure'), figure);
        assert.equal(root.querySelector('.vlook-content-placeholder'), null);
        assert.equal(document.querySelector('.vlook-content-viewer'), null);
        const second = M.openContentViewer(figure);
        window.dispatchEvent(new window.Event('beforeprint'));
        assert.equal(root.querySelector('figure'), figure);
        assert.equal(second.isConnected, false);
    } finally {
        root.remove(); prototype.showModal = oldShow; prototype.close = oldClose;
    }
});

test('全屏分类与翻阅：切换时先恢复上一内容，关闭恢复当前内容', () => {
    const root = html('<figure class="v-cap-cntr"><figcaption>第一表</figcaption><table><tr><td>A</td></tr></table></figure><figure class="v-cap-cntr"><figcaption>第二表</figcaption><table><tr><td>B</td></tr></table></figure><pre><code>代码</code></pre>');
    document.body.append(root);
    const [first, second] = root.querySelectorAll('figure'); const code = root.querySelector('pre');
    const prototype = window.HTMLDialogElement.prototype;
    const oldShow = prototype.showModal, oldClose = prototype.close;
    prototype.showModal = function(){this.setAttribute('open','');};
    prototype.close = function(){this.dispatchEvent(new window.Event('close'));};
    try {
        M.processContentViewers(root);
        const dialog = M.openContentViewer(first);
        const next = Array.from(dialog.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='下一项');
        const index = dropdown(dialog, '内容索引');
        assert.equal(index.options.length, 2);
        next.click();
        assert.equal(dialog.querySelector('figure'), second);
        assert.equal(root.querySelector('figure'), first);
        assert.equal(next.disabled, true);
        dropdown(dialog, '内容分类').value = '代码';
        assert.equal(dialog.querySelector('pre'), code);
        assert.equal(root.querySelectorAll('figure').length, 2);
        dialog.close();
        assert.equal(root.querySelector('pre'), code);
        assert.equal(root.querySelector('.vlook-content-placeholder'), null);
    } finally {root.remove();prototype.showModal=oldShow;prototype.close=oldClose;}
});

test('全文浏览异步竞态：旧结果不能覆盖新内容，关闭释放待渲染组件与事件订阅', async () => {
    const root=html('<pre data-vlook-viewer="1">源内容</pre>'); document.body.append(root);
    const index=M.getSourceIndex('```js\nFIRST\n```\n\n```js\nSECOND\n```', {captionGroup:false,captionNumber:true});
    const bus=()=>({refs:new Set(), on(name,fn){const ref={name,fn};this.refs.add(ref);return ref;},offref(ref){this.refs.delete(ref);}});
    const workspace=Object.assign(bus(),{getActiveFile:()=>({path:'test.md'}),getActiveViewOfType:()=>null});
    const vault=bus(); const jobs=[];
    const original=M.MarkdownRenderer.render;
    M.MarkdownRenderer.render=(_app,source,host,_path,component)=>new Promise(resolve=>jobs.push({source,host,component,resolve}));
    const prototype=window.HTMLDialogElement.prototype, oldShow=prototype.showModal,oldClose=prototype.close;
    prototype.showModal=function(){this.setAttribute('open','');};
    prototype.close=function(){this.dispatchEvent(new window.Event('close'));};
    try {
        const dialog=M.openSourceContentViewer(root.querySelector('pre'),ctx({app:{workspace,vault},index,block:index.blocks[0]}));
        const next=Array.from(dialog.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='下一项');
        next.click(); assert.equal(jobs.length,2);assert.equal(jobs[0].component.loaded,false);
        jobs[1].host.textContent='SECOND';jobs[1].resolve();await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(dialog.querySelector('.vlook-content-body').textContent,'SECOND');
        jobs[0].host.textContent='FIRST';jobs[0].resolve();await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(dialog.querySelector('.vlook-content-body').textContent,'SECOND');
        assert.equal(jobs[0].component.loaded,false);
        const previous=Array.from(dialog.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='上一项');previous.click();
        assert.equal(dialog.querySelector('.vlook-content-body').textContent,'');
        assert.equal(jobs.length,3);dialog.close();
        assert.equal(jobs[2].component.loaded,false);
        assert.equal(workspace.refs.size+vault.refs.size,0);
        jobs[2].resolve();await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(dialog.isConnected,false);
    } finally {M.MarkdownRenderer.render=original;prototype.showModal=oldShow;prototype.close=oldClose;root.remove();}
});

test('混合媒体段落：原生音频不占用图片参数的源码序号', () => {
    const source='![配乐](song.mp3?controls=mini) ![插图](image.png?darksrc=invert#200w)';
    const root=html('<audio src="song.mp3"></audio><img src="image.png" alt="插图">');
    M.renderSection(root,withSource(source,0));
    const image=root.querySelector('img');
    assert.equal(image.dataset.darksrc,'invert');
    assert.ok(image.getAttribute('src').includes('#200w'));
    assert.equal(image.getAttribute('src').includes('controls=mini'),false);
});

test('图片源码解析：括号嵌套、空格路径、转义 alt 与三种 title', () => {
    const source=String.raw`![嵌套](folder/a(b(c)).png?darksrc=invert#200w "下题注")
![带\]括号](<folder/带 空格.png> '第二题注')
![第三](folder/a\(b\).png (括号题注))
![[folder/Wiki 图.png|说明]]`;
    const refs=M.sourceImages(source);
    assert.deepEqual(refs.map(ref=>ref.raw),['folder/a(b(c)).png?darksrc=invert#200w','folder/带 空格.png','folder/a(b).png','folder/Wiki 图.png']);
    assert.deepEqual(refs.map(ref=>ref.title),['下题注','第二题注','括号题注',undefined]);
    assert.equal(refs[1].alt,'带]括号');
    for(const ref of refs)assert.ok(source.slice(ref.pos,ref.end).startsWith('!['));
});

test('图片源码解析：排除围栏、行内代码与转义示例，保留真实引用偏移', () => {
    const source='```markdown\n![示例](fake.png)\n```\n\n`![行内](fake2.png)`\n\n\\![转义](fake3.png)\n\n![真实](real.png "标题")';
    const refs=M.sourceImages(source);
    assert.equal(refs.length,1);
    assert.equal(refs[0].raw,'real.png');
    assert.equal(source.slice(refs[0].pos,refs[0].end),'![真实](real.png "标题")');
});

test('导出资源地址：文件名 # ? % 不变成参数，也不因裸百分号崩溃', () => {
    const root=html('<img src="app://local/Users/me/vault/pic/a%23b%3Fc%25.png?123456#200w"><video src="app://local/Users/me/vault/50%.mp4?123456"></video>');
    M.appUrlsToRelative(root,'/Users/me/vault','notes');
    assert.equal(root.querySelector('img').getAttribute('src'),'../pic/a%23b%3Fc%25.png#200w');
    assert.equal(root.querySelector('video').getAttribute('src'),'../50%25.mp4');
    assert.equal(M.decodeUrlPart('a%23b%3Fc.png'),'a#b?c.png');
    assert.equal(M.decodeUrlPart('50%.png'),'50%.png');
});

test('Obsidian 部分解码地址：裸百分号不妨碍还原编码的 # 与 ?', () => {
    assert.equal(M.decodeUrlPart('pic/验收 (一)%2350%%3F.png'),'pic/验收 (一)#50%?.png');
    const root=html('<span class="internal-embed" src="pic/验收 (一)%2350%%3F.png?darksrc=invert#200w" alt="特殊图片"></span>');
    const app={metadataCache:{getFirstLinkpathDest:path=>path==='pic/验收 (一)#50%?.png'?{}:null},vault:{getResourcePath:()=> 'app://local/file.png?123'}};
    M.renderSection(root,ctx({app}));
    assert.ok(root.querySelector('img'));
    assert.equal(root.querySelector('img').dataset.darksrc,'invert');
});

test('图片媒体共用参数：值含等号问号及裸百分号时保持完整', () => {
    assert.deepEqual(M.resourceQuery('song.mp3?token=a=b?c&label=50%&controls=mini#片段'),{token:'a=b?c',label:'50%',controls:'mini'});
    const root=html('<img src="song.mp3?unused=50%&amp;controls=mini" alt="配乐">');
    M.renderSection(root,ctx());
    assert.ok(root.querySelector('audio'));
    assert.ok(root.querySelector('.v-audio-mini-control'));
});

test('引用式图片：完整、折叠、简写与跨区块定义，标签忽略大小写和多余空白', () => {
    const definitions='[Photo   ID]: <pic/a b.png?darksrc=invert#200w> "题注"\n[折叠]: b.png\n[简写]: c.png\n[photo id]: wrong.png';
    const text='![说明][PHOTO ID]\n\n![折叠][]\n\n![简写]';
    const refs=M.sourceImages(text,definitions);
    assert.deepEqual(refs.map(ref=>ref.raw),['pic/a b.png?darksrc=invert#200w','b.png','c.png']);
    assert.equal(refs[0].title,'题注');
    assert.equal(text.slice(refs[0].pos,refs[0].end),'![说明][PHOTO ID]');
    assert.equal(M.sourceImages('![不存在][missing]',definitions).length,0);
    const source=text+'\n\n'+definitions;
    const items=M.sourceContentItems(M.getSourceIndex(source,{captionGroup:false,captionNumber:true}));
    assert.equal(items.filter(item=>item.kind==='插图').length,3);
});

test('引用图片定义：地址和题注可分别放在后续缩进行', () => {
    const source='![引用][picture]\n\n[picture]:\n    <pic/a b.png#200w>\n    "下一行题注"';
    const refs=M.sourceImages(source);
    assert.equal(refs.length,1);
    assert.equal(refs[0].raw,'pic/a b.png#200w');
    assert.equal(refs[0].title,'下一行题注');
});

test('引用式资源相对 img：先解析 vault 地址再转换音频，保留 URL 参数', () => {
    const root=html('<img src="pic/a%20b.png?darksrc=invert#200w" alt="插图"><img src="media/sound.mp3?controls=mini" alt="配乐">');
    const app={metadataCache:{getFirstLinkpathDest:path=>({path})},vault:{getResourcePath:file=>'app://local/vault/'+file.path.replace(/ /g,'%20')+'?123'}};
    M.renderSection(root,ctx({app}));
    const image=root.querySelector('img');
    assert.equal(image.getAttribute('src'),'app://local/vault/pic/a%20b.png?123&darksrc=invert#200w');
    assert.equal(root.querySelector('audio').getAttribute('src'),'app://local/vault/media/sound.mp3?123&controls=mini');
    assert.ok(root.querySelector('.v-audio-mini-control'));
});

test('迷你音频：键盘播放暂停、状态标签、有限时长与错误复位', async () => {
    const root=html('<img src="song.mp3?controls=mini&amp;pause=true&amp;duration=true">');
    M.renderSection(root,ctx());document.body.append(root);
    const audio=root.querySelector('audio'),button=root.querySelector('[role="button"]');
    let paused=true;
    Object.defineProperty(audio,'paused',{get:()=>paused});
    Object.defineProperty(audio,'duration',{configurable:true,value:NaN});
    audio.play=async()=>{paused=false;audio.dispatchEvent(new window.Event('playing'));};
    audio.pause=()=>{paused=true;audio.dispatchEvent(new window.Event('pause'));};
    audio.dispatchEvent(new window.Event('canplay'));
    assert.equal(root.querySelector('.v-duration'),null);
    assert.equal(button.getAttribute('aria-disabled'),'false');
    button.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    assert.equal(button.getAttribute('aria-label'),'暂停音频');
    assert.equal(button.getAttribute('aria-pressed'),'true');
    button.dispatchEvent(new window.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));
    assert.equal(button.getAttribute('aria-label'),'播放音频');
    Object.defineProperty(audio,'duration',{value:65});audio.dispatchEvent(new window.Event('durationchange'));
    assert.equal(root.querySelector('.v-duration').textContent,'1′5″');
    audio.dispatchEvent(new window.Event('error'));
    assert.equal(button.dataset.vlookAudioState,'error');
    assert.equal(button.getAttribute('aria-disabled'),'true');
    assert.equal(button.classList.contains('playing'),false);
    root.remove();
});

test('区块媒体卸载：原生音视频和生成播放器均暂停，包括移入浮窗的节点', () => {
    const root=html('<img src="song.mp3?controls=mini"><video src="clip.mp4"></video>');
    const cleanups=[];
    M.renderSection(root,ctx({registerCleanup:fn=>cleanups.push(fn)}));
    const audio=root.querySelector('audio'),video=root.querySelector('video');
    let audioPaused=0,videoPaused=0;
    audio.pause=()=>audioPaused++;video.pause=()=>videoPaused++;
    const floating=document.createElement('div');floating.append(audio);
    for(const cleanup of cleanups)cleanup();
    assert.equal(audioPaused,1);assert.equal(videoPaused,1);
});

test('段落漫游目标：引用段落、列表子项与折叠摘要各自定位', () => {
    const quote=html('<blockquote><p>第一段</p><p>第二段</p></blockquote>');
    assert.equal(M.roamingTarget(quote,['> 第一段','>','> 第二段']),quote.querySelectorAll('p')[1]);
    const list=html('<ul><li>甲<ul><li>乙</li></ul></li><li>丙</li></ul>');
    assert.equal(M.roamingTarget(list,['- 甲','  - 乙']),list.querySelectorAll('li')[1]);
    const fold=html('<details><summary>标题</summary><p>正文</p></details>');
    assert.equal(M.roamingTarget(fold,['> 标题']),fold.querySelector('summary'));
    assert.equal(M.roamingTarget(fold,['> 标题','>','> 正文']),fold.querySelector('p'));
});

test('阅读进度：插件卸载后不允许延迟布局回调重新注册观察器', () => {
    let ready;const cleanups=[];
    const plugin={
        app:{workspace:{on(){return {};},onLayoutReady(fn){ready=fn;},getActiveViewOfType(){throw new Error('卸载后不应读取视图');}},vault:{on(){return {};}}},
        addStatusBarItem(){return document.createElement('div');},registerEvent(){},register(fn){cleanups.push(fn);},
    };
    new M.ReadingProgress(plugin).register();
    cleanups.forEach(fn=>fn());
    assert.doesNotThrow(()=>ready());
});

test('阅读进度：按活动文档窗口创建观察器，切换视图解绑旧滚动监听', () => {
    const tracked=[];let active,ready;
    const oldResize=window.ResizeObserver,oldMutation=window.MutationObserver;
    class Observer {constructor(callback){this.callback=callback;tracked.push(this);}observe(node){this.node=node;}disconnect(){this.disconnected=true;}}
    window.ResizeObserver=Observer;window.MutationObserver=Observer;
    const makeView=()=>{
        const contentEl=html('<div class="markdown-preview-view"></div>');
        const scroller=contentEl.firstElementChild;
        Object.defineProperties(scroller,{scrollHeight:{value:1500},clientHeight:{value:500}});
        return {contentEl,getMode:()=> 'preview',scroller,editor:{getValue:()=> '中'.repeat(400)}};
    };
    const secondary=new JSDOM('<div class="view"><div class="markdown-preview-view"></div></div>',{pretendToBeVisual:true});
    class SecondaryObserver extends Observer {constructor(callback){super(callback);this.realm='secondary';}}
    secondary.window.ResizeObserver=SecondaryObserver;secondary.window.MutationObserver=SecondaryObserver;
    const first=makeView();
    const second={contentEl:secondary.window.document.querySelector('.view'),getMode:()=> 'preview',scroller:secondary.window.document.querySelector('.markdown-preview-view')};
    Object.defineProperties(second.scroller,{scrollHeight:{value:1500},clientHeight:{value:500}});active=first;
    const events=new Map(),cleanups=[];let status;
    const plugin={app:{workspace:{on(name,fn){events.set(name,fn);return {};},onLayoutReady(fn){ready=fn;},getActiveViewOfType(){return active;}},vault:{on(){return {};}}},
        addStatusBarItem(){status=document.createElement('div');return status;},registerEvent(){},register(fn){cleanups.push(fn);}};
    try {
        new M.ReadingProgress(plugin).register();ready();
        assert.equal(status.getAttribute('aria-valuenow'),'0');
        assert.ok(status.textContent.includes('约 2 分钟'));assert.ok(status.title.includes('正文估算'));
        assert.equal(tracked[0].node,first.scroller);
        second.scroller.scrollTop=500;active=second;events.get('active-leaf-change')();
        assert.equal(tracked[0].disconnected,true);assert.equal(tracked[1].disconnected,true);
        assert.equal(tracked[2].node,second.scroller);
        assert.equal(tracked[2].realm,'secondary');assert.equal(tracked[3].realm,'secondary');
        assert.equal(status.getAttribute('aria-valuenow'),'50');
        assert.equal(status.textContent.includes('分钟'),false,'尚无编辑器的视图不保留上一份文档估算');
        cleanups.forEach(fn=>fn());
        assert.ok(tracked.every(observer=>observer.disconnected));
    } finally {window.ResizeObserver=oldResize;window.MutationObserver=oldMutation;secondary.window.close();}
});

test('宁静视图：临时类退出恢复，不改变侧栏或工作区布局', () => {
    const root=html('<div class="workspace-leaf"><div class="view"><div class="content"></div></div></div>');document.body.append(root);
    const containerEl=root.querySelector('.view'),contentEl=root.querySelector('.content');
    const view={containerEl,contentEl,getMode:()=> 'preview'};
    const keys=new Map(),events=new Map(),cleanups=[];
    const plugin={app:{workspace:{getActiveViewOfType:()=>view,on(name,fn){events.set(name,fn);return {};}}},addCommand(){},registerEvent(){},registerDomEvent(_doc,name,fn){keys.set(name,fn);},register(fn){cleanups.push(fn);}};
    const quiet=new M.QuietView(plugin);quiet.register();
    try {
        quiet.toggle();assert.ok(document.body.classList.contains('vlook-quiet-view'));
        assert.ok(root.firstElementChild.classList.contains('vlook-quiet-leaf'));
        contentEl.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        assert.equal(document.body.classList.contains('vlook-quiet-view'),false);
        quiet.toggle();events.get('active-leaf-change')();
        assert.equal(root.querySelector('.vlook-quiet-leaf'),null);
    } finally {cleanups.forEach(fn=>fn());root.remove();}
});

test("不发布引用：阅读提示与导出共享小标题规则，折叠后仍保留标记", () => {
    const index=M.getSourceIndex('---\nvlook-unpub: 内部引用\n---\n\n> 内容',{captionGroup:false,captionNumber:true});
    for(const source of [
        '<blockquote><p><strong>部分 <del>内部</del> 标题</strong></p><p>正文</p></blockquote>',
        '<blockquote><p>前言</p><p><mark>内部引用</mark></p><p>正文</p></blockquote>',
        '<blockquote><h6><del>折叠</del></h6><p>正文</p></blockquote>',
    ]) {
        const root=html(source);M.renderSection(root,ctx({index,suppressContentViewers:true}));
        assert.ok(root.querySelector('blockquote.vlook-unpub,details.vlook-unpub'),source);
        const off=html(source);M.renderSection(off,ctx({index,query:new M.Query('unpub=off'),suppressContentViewers:true}));
        assert.equal(off.querySelector('.vlook-unpub'),null,source);
    }
    for(const source of [
        '<blockquote><p>正文中 <del>删除线</del></p></blockquote>',
        '<blockquote><p>前言</p><p>正文</p><p><strong><del>第三段</del></strong></p></blockquote>',
        '<blockquote><p><strong><a href="x"><del>链接内</del></a></strong></p></blockquote>',
    ]) {
        const root=html(source);M.renderSection(root,ctx({index,suppressContentViewers:true}));
        assert.equal(root.querySelector('.vlook-unpub'),null,source);
    }
});

test("表格嵌套列格式：加粗高亮双向嵌套与三层组合同时作用，局部文字不扩散", () => {
    for(const heading of ['<mark><strong>组合</strong></mark>','<strong><mark>组合</mark></strong>','<em><mark><strong>组合</strong></mark></em>']) {
        const root=html(`<table><thead><tr><th>${heading}</th></tr></thead><tbody><tr><td>正文</td></tr></tbody></table>`);
        M.renderSection(root,ctx());
        const cell=root.querySelector('td');
        assert.ok(cell.classList.contains('v-tbl-col-fmt-bold'),heading);
        assert.ok(cell.classList.contains('v-tbl-col-fmt-mark'),heading);
        if(heading.startsWith('<em>'))assert.ok(cell.classList.contains('v-tbl-col-fmt-em'));
        assert.equal(root.querySelector('th mark'),null);
    }
    const partial=html('<table><thead><tr><th>局部 <strong>加粗</strong></th></tr></thead><tbody><tr><td>正文</td></tr></tbody></table>');
    M.renderSection(partial,ctx());
    assert.ok(!partial.querySelector('td').classList.contains('v-tbl-col-fmt-bold'));
});

test("表格数值只改文字：链接地址、小数属性与已有事件保持不变", () => {
    const root=html('<table><thead><tr><th style="text-align:right">数值</th></tr></thead><tbody><tr><td><a href="https://example.com/v1.23/1234567" data-price="123456.78">12345.67</a></td></tr><tr><td><a href="note-12.34.md">+88.5%</a></td></tr></tbody></table>');
    const links=root.querySelectorAll('a');let clicked=0;
    links[0].addEventListener('click',event=>{event.preventDefault();clicked++});
    M.renderSection(root,ctx());
    assert.equal(root.querySelector('a'),links[0]);
    assert.equal(links[0].getAttribute('href'),'https://example.com/v1.23/1234567');
    assert.equal(links[0].dataset.price,'123456.78');
    assert.equal(links[0].textContent,'12,345.67');
    assert.equal(links[1].getAttribute('href'),'note-12.34.md');
    assert.match(links[1].textContent,/▴ 88.5%/);
    links[0].click();assert.equal(clicked,1);
});

test("表格标记只移除文字：复选框与行分组保留链接属性和监听器", () => {
    const root=html('<table><thead><tr><th>分类</th><th><a href="help[]manual.md">[]完成</a></th></tr></thead><tbody><tr><td>父组</td><td><a href="Yes.md">Y 已完成</a></td></tr><tr><td><a href="group&gt; child.md">&gt; 子组</a></td><td><strong>?</strong> 待确认</td></tr></tbody></table>');
    const links=Array.from(root.querySelectorAll('a'));let clicked=0;
    links.forEach(link=>link.addEventListener('click',event=>{event.preventDefault();clicked++}));
    M.renderSection(root,ctx());
    assert.equal(root.querySelector('th a'),links[0]);
    assert.equal(links[0].getAttribute('href'),'help[]manual.md');
    assert.equal(links[0].textContent,'完成');
    assert.equal(links[1].getAttribute('href'),'Yes.md');
    assert.equal(links[1].textContent,' 已完成');
    assert.equal(links[2].getAttribute('href'),'group> child.md');
    assert.equal(links[2].textContent,'子组');
    links.forEach(link=>link.click());assert.equal(clicked,3);
    assert.equal(root.querySelectorAll('svg[data-chk="yes"]').length,1);
    assert.equal(root.querySelectorAll('svg[data-chk="un"]').length,1);
});

test("行分组键盘：焦点与状态同步，Enter/空格切换，长按不重复，Tab 分隔层级有效", () => {
    const root=html('<table><thead><tr><th>分组</th></tr></thead><tbody><tr><td>父组</td></tr><tr><td>&gt;\t子组</td></tr><tr><td>&gt;&gt; 孙组</td></tr></tbody></table>');
    M.renderSection(root,ctx());
    const rows=root.querySelectorAll('tbody tr');
    const button=rows[0].querySelector('.v-tbl-row-g-btn');
    assert.equal(button.tabIndex,0);assert.equal(button.getAttribute('role'),'button');
    assert.equal(button.getAttribute('aria-expanded'),'false');
    assert.equal(rows[1].querySelector('td').dataset.identLevel,'1');
    button.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    assert.equal(button.getAttribute('aria-expanded'),'true');assert.ok(!rows[1].classList.contains('vlook-row-folded'));
    button.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true}));
    assert.equal(button.getAttribute('aria-expanded'),'true');
    const child=rows[1].querySelector('.v-tbl-row-g-btn');child.click();
    assert.equal(child.getAttribute('aria-expanded'),'true');
    button.dispatchEvent(new window.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));
    assert.equal(button.getAttribute('aria-expanded'),'false');
    assert.equal(child.getAttribute('aria-expanded'),'false');
    assert.ok(rows[2].classList.contains('vlook-row-folded'));
});

test("表格千分位：跨链接和强调文字节点计算，原内容结构不被拼平", () => {
    const root=html('<table><thead><tr><th style="text-align:right">金额</th></tr></thead><tbody><tr><td><a href="number.md">12</a><strong>345</strong>.67</td></tr><tr><td>USD <em>-1234</em><a href="currency.md">567.89</a></td></tr></tbody></table>');
    const a=root.querySelector('a'),strong=root.querySelector('strong');
    M.renderSection(root,ctx());
    const cells=root.querySelectorAll('td');
    assert.equal(cells[0].textContent,'12,345.67');
    assert.match(cells[1].textContent,/-1,234,567.89/);
    assert.equal(root.querySelector('a'),a);assert.equal(root.querySelector('strong'),strong);
    assert.equal(a.getAttribute('href'),'number.md');
});

test("表格长小数：千分位只作用于整数，原小数精度保持", () => {
    const root=html('<table><thead><tr><th style="text-align:right">数值</th></tr></thead><tbody><tr><td>12345.123456789</td></tr><tr><td>USD 12345.123456789</td></tr></tbody></table>');
    M.renderSection(root,ctx());
    const cells=root.querySelectorAll('td');
    assert.equal(cells[0].textContent,'12,345.123456789');
    assert.match(cells[1].textContent,/12,345\.123456789$/);
});

test("跨节点数值样式：小数、百分号与货币前缀分片均完整着色", () => {
    const root=html('<table><thead><tr><th style="text-align:right">金额</th></tr></thead><tbody><tr><td><a href="a.md">12.</a><strong>34</strong><em>56</em></td></tr><tr><td>+<strong>88.</strong><a href="p.md">25%</a></td></tr><tr><td><b>U</b><a href="c.md">SD</a> <em>12345.</em><strong>67</strong></td></tr></tbody></table>');
    const links=Array.from(root.querySelectorAll('a'));
    M.renderSection(root,ctx());
    const cells=root.querySelectorAll('td');
    const styled=(cell,cls)=>Array.from(cell.querySelectorAll('.'+cls),el=>el.textContent).join('');
    assert.equal(cells[0].textContent,'12.3456');
    assert.equal(styled(cells[0],'v-tbl-col-fmt-num-decimal'),'3456');
    assert.equal(styled(cells[1],'v-tbl-col-fmt-num-decimal'),'25');
    assert.equal(styled(cells[1],'v-tbl-col-fmt-percent'),'%');
    assert.equal(styled(cells[2],'v-tbl-col-fmt-currency'),'USD');
    assert.equal(styled(cells[2],'v-tbl-col-fmt-num-decimal'),'67');
    assert.match(cells[2].textContent,/USD12,345.67/);
    links.forEach(link=>assert.ok(root.contains(link)));
});

test("正文页内链接：章节与引用式图片题注按行定位，同名标题取首处，排除块引用", () => {
    const source='# 重复\n\n正文\n\n# 重复\n\n正文\n\n![参考图][pic]\n\n[pic]: image.png';
    const index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true});
    const calls=[];
    const root=html('<p><a href="#重复">章节</a><a href="#参考图">题注</a><a href="#^block">块引用</a></p>');
    M.renderSection(root,ctx({index,app:{workspace:{openLinkText(...args){calls.push(args)}}}}));
    const links=root.querySelectorAll('a');
    links[0].dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true}));
    links[1].dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}));
    assert.deepEqual(calls,[['test.md','',false,{eState:{line:0}}],['test.md','',true,{eState:{line:8}}]]);
    assert.ok(!links[2].classList.contains('vlook-link-missing'));
});

test('内容助手返回原窗格、拒绝过期源码，目录重命名和删除关闭弹窗', async () => {
    const root=html('<div class="markdown-preview-view"><pre>原代码</pre></div>');document.body.append(root);
    const source='```js\n原代码\n```',index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true});
    let currentSource=source;const applied=[],events=new Map();
    const bus={on(name,fn){events.set(name,fn);return {name}},offref(){}};
    const own={file:{path:'folder/test.md'},contentEl:root,getMode:()=> 'preview',editor:{getValue:()=>currentSource,lineCount:()=>3},setEphemeralState(state){applied.push(state.line)}};
    const other={file:{path:'folder/test.md'},contentEl:html('<div></div>'),getMode:()=> 'preview',editor:{getValue:()=>source}};
    const workspace={...bus,getLeavesOfType:()=>[{view:own},{view:other}],getActiveViewOfType:()=>other,getActiveFile:()=>other.file};
    const app={workspace,vault:bus};own.app=app;
    const context=ctx({app,sourcePath:'folder/test.md',index,block:index.blocks[0]});
    const prototype=window.HTMLDialogElement.prototype,oldShow=prototype.showModal,oldClose=prototype.close;
    prototype.showModal=function(){this.open=true};prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'))};
    let dialog;
    try{
        const open=()=>M.openSourceContentViewer(root.querySelector('pre'),context);
        dialog=open();await new Promise(resolve=>setTimeout(resolve,0));
        Array.from(dialog.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='回到文档位置').click();assert.deepEqual(applied,[0]);
        dialog=open();currentSource='前言\n\n'+source;
        Array.from(dialog.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='回到文档位置').click();assert.deepEqual(applied,[0]);
        currentSource=source;dialog=open();events.get('rename')({path:'renamed'},'folder');assert.equal(dialog.isConnected,false);
        dialog=open();events.get('delete')({path:'folder'});assert.equal(dialog.isConnected,false);
    }finally{dialog?.close();root.remove();prototype.showModal=oldShow;prototype.close=oldClose;}
});

test('内容分类：pre 形式 Mermaid 仍是插图，普通代码保持代码分类', () => {
    assert.equal(M.contentKind(html('<pre class="mermaid"><svg></svg></pre>').firstElementChild),'插图');
    assert.equal(M.contentKind(html('<pre><code>const a=1</code></pre>').firstElementChild),'代码');
});

test('全文助手快捷键：上下左右和标点切换，输入与媒体控件不抢键，Esc 清理', async () => {
    const root=html('<pre>原代码</pre>');document.body.append(root);
    const index=M.getSourceIndex('```js\nFIRST\n```\n\n```js\nSECOND\n```',{captionGroup:false,captionNumber:true});
    const events={on:()=>({}),offref:()=>{}};
    const workspace={...events,getActiveFile:()=>({path:'test.md'}),getActiveViewOfType:()=>null};
    const proto=window.HTMLDialogElement.prototype,oldShow=proto.showModal,oldClose=proto.close;
    proto.showModal=function(){this.open=true};proto.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'))};
    let dialog;
    try{
        dialog=M.openSourceContentViewer(root,ctx({app:{workspace,vault:events},index,block:index.blocks[0]}));await new Promise(resolve=>setTimeout(resolve,0));
        const select=dropdown(dialog,'全文内容索引');
        const press=(target,key,extra={})=>target.dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}));
        press(dialog,'ArrowDown');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(select.value,'1');
        press(dialog,',');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(select.value,'0');
        press(select.el,'ArrowRight');assert.equal(select.value,'0');
        const video=document.createElement('video');dialog.append(video);press(video,'ArrowRight');assert.equal(select.value,'0');
        press(dialog,'.',{ctrlKey:true});assert.equal(select.value,'0');
        press(dialog,'.');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(select.value,'1');
        press(dialog,'Escape');assert.equal(dialog.isConnected,false);
    }finally{dialog?.close();root.remove();proto.showModal=oldShow;proto.close=oldClose;}
});

test('已挂载内容全屏快捷键复用：切换后关闭仍恢复两个原节点', () => {
    const root=html('<div class="markdown-preview-view"><pre data-vlook-viewer="1">一</pre><pre data-vlook-viewer="1">二</pre></div>');document.body.append(root);
    const first=root.querySelectorAll('pre')[0],second=root.querySelectorAll('pre')[1];
    const proto=window.HTMLDialogElement.prototype,oldShow=proto.showModal,oldClose=proto.close;
    proto.showModal=function(){this.open=true};proto.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'))};
    let dialog;
    try{
        dialog=M.openContentViewer(first);dialog.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
        assert.ok(dialog.contains(second));assert.ok(root.contains(first));
        dialog.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        assert.ok(root.contains(first));assert.ok(root.contains(second));assert.equal(dialog.isConnected,false);
    }finally{dialog?.close();root.remove();proto.showModal=oldShow;proto.close=oldClose;}
});

test('内容助手空白、题注与工具区滚轮保持滚动，只有图像区域缩放',()=>{
    const body=html('<p>上下文说明</p><figure><img src="a.png"><figcaption>题注</figcaption></figure><div class="vlook-content-tools"><svg><path/></svg></div>');
    const image=body.querySelector('img'),zoom=new M.ContentZoom(body);
    const wheel=target=>{const event=new window.WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true});target.dispatchEvent(event);return event;};
    try{
        const before=image.style.transform;
        for(const target of [body,body.querySelector('p'),body.querySelector('figcaption'),body.querySelector('path')]){
            assert.equal(wheel(target).defaultPrevented,false);
            assert.equal(image.style.transform,before);
        }
        assert.equal(wheel(image).defaultPrevented,true);assert.match(image.style.transform,/scale\(1.5\)/);
        const after=image.style.transform;
        assert.equal(wheel(body).defaultPrevented,false);assert.equal(image.style.transform,after);
    }finally{zoom.dispose();}
});

test('内容缩放：滚轮锚点、双击复位、拖动和双指缩放，退出恢复原样式', () => {
    const body=html('<img src="a.png" style="transform:rotate(5deg);cursor:crosshair;touch-action:pan-y"><button>工具</button>');
    const image=body.querySelector('img');image.getBoundingClientRect=()=>({left:10,top:20,width:100,height:100});
    body.setPointerCapture=()=>{};body.hasPointerCapture=()=>false;
    const zoom=new M.ContentZoom(body);
    const pointer=(type,id,x,y)=>{const event=new window.MouseEvent(type,{clientX:x,clientY:y,bubbles:true,cancelable:true,button:0});Object.defineProperty(event,'pointerId',{value:id});image.dispatchEvent(event)};
    try{
        image.dispatchEvent(new window.WheelEvent('wheel',{deltaY:-100,clientX:110,clientY:120,bubbles:true,cancelable:true}));
        assert.match(image.style.transform,/translate\(-50px, -50px\) scale\(1.5\) rotate\(5deg\)/);
        const before=image.style.transform;body.querySelector('button').dispatchEvent(new window.WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));assert.equal(image.style.transform,before);
        image.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true,cancelable:true}));assert.match(image.style.transform,/translate\(0px, 0px\) scale\(1\)/);
        pointer('pointerdown',1,10,20);pointer('pointermove',1,35,60);assert.match(image.style.transform,/translate\(25px, 40px\)/);pointer('pointerup',1,35,60);
        zoom.reset();zoom.refresh();pointer('pointerdown',1,0,0);pointer('pointerdown',2,100,0);pointer('pointermove',2,200,0);assert.match(image.style.transform,/scale\(2\)/);pointer('pointercancel',1,0,0);pointer('pointerup',2,200,0);
    }finally{zoom.dispose();}
    assert.equal(image.style.transform,'rotate(5deg)');assert.equal(image.style.cursor,'crosshair');
    image.dispatchEvent(new window.WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));assert.equal(image.style.transform,'rotate(5deg)');
});

test('全屏查看原图片：缩放后关闭恢复原节点及 transform', () => {
    const root=html('<div class="markdown-preview-view"><img src="a.png" data-vlook-viewer="1" style="transform:rotate(10deg)"></div>');document.body.append(root);
    const image=root.querySelector('img'),proto=window.HTMLDialogElement.prototype,oldShow=proto.showModal,oldClose=proto.close;
    proto.showModal=function(){this.open=true};proto.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'))};let dialog;
    try{
        dialog=M.openContentViewer(image);
        image.dispatchEvent(new window.WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));assert.match(image.style.transform,/scale\(1.5\)/);
        dialog.close();assert.ok(root.contains(image));assert.equal(image.style.transform,'rotate(10deg)');
    }finally{dialog?.close();root.remove();proto.showModal=oldShow;proto.close=oldClose;}
});

test('内容自适配：超高图片缩到可视区并居中，双击相对适配尺寸缩放', () => {
    const body=html('<img src="large.png">'),image=body.querySelector('img');
    Object.defineProperties(body,{clientWidth:{value:400},clientHeight:{value:300}});
    body.getBoundingClientRect=()=>({left:10,top:20,width:400,height:300});
    image.getBoundingClientRect=()=>({left:10,top:20,width:200,height:1000});
    const zoom=new M.ContentZoom(body);
    try{
        assert.equal(image.style.transform,'translate(170px, 0px) scale(0.3)');
        image.dispatchEvent(new window.MouseEvent('dblclick',{clientX:110,clientY:120,bubbles:true,cancelable:true}));assert.match(image.style.transform,/scale\(0.6\)/);
        image.dispatchEvent(new window.MouseEvent('dblclick',{clientX:110,clientY:120,bubbles:true,cancelable:true}));assert.equal(image.style.transform,'translate(170px, 0px) scale(0.3)');
    }finally{zoom.dispose();}
    assert.equal(image.style.transform,'');
});

test('适配随窗口变化更新，放大操作期间不抢状态，卸载断开观察', () => {
    const original=window.ResizeObserver;let callback,disconnected=false,width=400,height=300;
    window.ResizeObserver=class {constructor(fn){callback=fn}observe(){}disconnect(){disconnected=true}};
    const body=html('<img src="a.png">'),image=body.querySelector('img');
    Object.defineProperties(body,{clientWidth:{get:()=>width},clientHeight:{get:()=>height}});
    body.getBoundingClientRect=()=>({left:0,top:0,width,height});image.getBoundingClientRect=()=>({left:0,top:0,width:200,height:1000});
    const zoom=new M.ContentZoom(body);
    try{
        width=300;height=600;callback();assert.equal(image.style.transform,'translate(90px, 0px) scale(0.6)');
        image.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true,cancelable:true}));const enlarged=image.style.transform;
        width=500;callback();assert.equal(image.style.transform,enlarged);
    }finally{zoom.dispose();window.ResizeObserver=original;}
    assert.equal(disconnected,true);
});

test('多图内容按指针选择对象，切换对象时恢复上一个原始变换', () => {
    const body=html('<img src="a.png" style="transform:rotate(5deg)"><img src="b.png" style="transform:rotate(-5deg)">');
    const [first,second]=body.querySelectorAll('img'),zoom=new M.ContentZoom(body);
    try{
        second.dispatchEvent(new window.WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));
        assert.equal(first.style.transform,'rotate(5deg)');assert.match(second.style.transform,/scale\(1.5\).*rotate\(-5deg\)/);
        first.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true,cancelable:true}));assert.match(first.style.transform,/scale\(2\)/);assert.equal(second.style.transform,'rotate(-5deg)');
    }finally{zoom.dispose();}
    assert.equal(first.style.transform,'rotate(5deg)');assert.equal(second.style.transform,'rotate(-5deg)');
});

test('显示公式可缩放：MathJax CHTML 与 KaTeX 内容，工具 SVG 不作为目标', () => {
    const body=html('<div class="vlook-code-tools"><svg></svg></div><div class="math-block"><mjx-container display="true"><mjx-math>公式</mjx-math></mjx-container></div><div class="math-block"><span class="katex-display"><span>第二个公式</span></span></div>');
    const formula=body.querySelector('mjx-container'),katex=body.querySelector('.katex-display'),zoom=new M.ContentZoom(body);
    try{
        formula.firstElementChild.dispatchEvent(new window.WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));assert.match(formula.style.transform,/scale\(1.5\)/);
        katex.firstElementChild.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true,cancelable:true}));assert.match(katex.style.transform,/scale\(2\)/);assert.equal(formula.style.transform,'');
        assert.equal(body.querySelector('svg').style.transform,'');
    }finally{zoom.dispose();}
    assert.equal(katex.style.transform,'');
});

test('预览导出图片恢复：Markdown 与 HTML 混用仍恢复参数，排除代码中的 img', () => {
    const source='![第一张](a.png?darksrc=invert#200w "第一题注")\n\n<img src="b.png?fill=text#icon" alt="HTML 图" title="HTML题注">\n\n![最后](c.png?srcset=@2x#300w)\n\n```html\n<img src="fake.png">\n```';
    const root=html('<img src="a.png"><img src="b.png"><img src="c.png">');
    M.restoreImages(root,source,(raw)=>'assets/'+raw.split(/[?#]/)[0]);
    assert.deepEqual(Array.from(root.querySelectorAll('img'),img=>img.getAttribute('src')),['assets/a.png?darksrc=invert#200w','assets/b.png?fill=text#icon','assets/c.png?srcset=@2x#300w']);
    assert.equal(root.children[0].title,'第一题注');assert.equal(root.children[1].title,'HTML题注');
});

test('图片恢复不把 HTML 注释、原始文本及属性中的 Markdown 当额外图片', () => {
    const source='<!-- <img src="comment.png"> ![伪图](fake-comment.png) -->\n\n<script>const sample="<img src=\'script.png\'>";</script>\n\n<img src="real.png#200w" alt="![示例](fake.png)">';
    const root=html('<img src="real.png">');M.restoreImages(root,source,(_raw,current)=>current);
    assert.equal(root.firstElementChild.getAttribute('src'),'real.png#200w');
    const mismatch=html('<img src="real.png"><img src="unexpected.png">');M.restoreImages(mismatch,source,(_raw,current)=>current);
    assert.equal(mismatch.firstElementChild.getAttribute('src'),'real.png#200w');
    assert.equal(mismatch.children[1].getAttribute('src'),'unexpected.png');
});

test('原生阅读混合图片不会错配：HTML 图保留自己参数，前后 Markdown 图分别恢复', () => {
    const source='![首图](a.png?darksrc=invert#200w) <img src="b.png#icon" title="HTML题注"> ![末图](c.png?darksrc=dark.png#300w "末图题注")';
    const root=html('<p><img src="a.png"><img src="b.png#icon" title="HTML题注"><img src="c.png"></p>');
    M.renderSection(root,withSource(source,0));
    const imgs=root.querySelectorAll('img');
    assert.equal(imgs[0].dataset.darksrc,'invert');
    assert.equal(imgs[1].dataset.darksrc,undefined);assert.equal(imgs[1].title,'HTML题注');
    assert.equal(imgs[2].closest('.v-caption').querySelector('.v-cap-2').textContent,'末图题注');assert.equal(imgs[2].getAttribute('src').includes('#300w'),true);
    assert.equal(imgs[2].dataset.darksrc,'alter');assert.match(imgs[2].dataset.srcDark,/dark\.png/);
});

test('原生阅读图片数量不明时不把源图参数套给额外渲染图片', () => {
    const source='![原图](a.png?darksrc=invert#200w)';
    const root=html('<p><img src="extra.png"><img src="a.png"></p>');
    M.renderSection(root,withSource(source,0));
    assert.equal(root.querySelectorAll('img')[0].dataset.darksrc,undefined);
    assert.equal(root.querySelectorAll('img')[1].dataset.darksrc,'invert');
    assert.equal(root.querySelector('img').getAttribute('src'),'extra.png');
});

test('同段多媒体题注各自恢复，不误用前面图片的 title', () => {
    const source='![图片](a.png "图片题注") ![配乐](song.mp3 "音频题注") ![视频](movie.mp4 \'视频题注\')';
    const root=html('<p><img src="a.png"><span class="internal-embed" src="song.mp3" alt="配乐"><audio></audio></span><span class="internal-embed" src="movie.mp4" alt="视频"><video></video></span></p>');
    M.renderSection(root,withSource(source,0));
    const embeds=root.querySelectorAll('span.internal-embed');
    assert.equal(embeds[0].parentElement.querySelector('.v-cap-2').textContent,'音频题注');
    assert.equal(embeds[1].parentElement.querySelector('.v-cap-2').textContent,'视频题注');
});

test('媒体 URL 参数触发替换时保留该媒体自己的 title', () => {
    const source='![配乐](song.mp3?controls=mini "专属音频说明")';
    const root=html('<p><span class="internal-embed" src="song.mp3?controls=mini" alt="配乐"></span></p>');
    const file={path:'song.mp3'};
    const app={metadataCache:{getFirstLinkpathDest:()=>file},vault:{getResourcePath:()=> 'app://resource/song.mp3'}};
    M.renderSection(root,withSource(source,0,{app}));
    assert.equal(root.querySelector('audio').title,'专属音频说明');assert.ok(root.querySelector('.v-audio-mini-control'));
});

test('触屏双击缩放：两次轻触切换，拖动、取消和双指手势不误触', () => {
    const body=html('<img src="a.png">'),image=body.querySelector('img'),zoom=new M.ContentZoom(body);
    body.setPointerCapture=()=>{};body.hasPointerCapture=()=>false;
    const pointer=(type,id,x=10,y=10)=>{const event=new window.MouseEvent(type,{clientX:x,clientY:y,bubbles:true,cancelable:true,button:0});Object.defineProperties(event,{pointerId:{value:id},pointerType:{value:'touch'}});image.dispatchEvent(event)};
    const tap=id=>{pointer('pointerdown',id);pointer('pointerup',id)};
    try{
        tap(1);tap(2);assert.match(image.style.transform,/scale\(2\)/);
        tap(3);tap(4);assert.match(image.style.transform,/scale\(1\)/);
        pointer('pointerdown',5);pointer('pointermove',5,40,10);pointer('pointerup',5,40,10);tap(6);assert.match(image.style.transform,/scale\(1\)/);
        pointer('pointerdown',7);pointer('pointercancel',7);tap(8);assert.match(image.style.transform,/scale\(1\)/);
        pointer('pointerdown',9);pointer('pointerdown',10,100,10);pointer('pointerup',9);pointer('pointerup',10,100,10);tap(11);assert.match(image.style.transform,/scale\(1\)/);
    }finally{zoom.dispose();}
});

test('缩放保留主题 CSS 变换，退出恢复原内联属性和优先级', () => {
    const style=document.createElement('style');style.textContent='.vlook-zoom-css-test { transform:rotate(15deg) !important;transform-origin:50% 50% !important; }';document.head.append(style);
    const body=html('<img src="a.png" class="vlook-zoom-css-test" style="cursor:crosshair !important;touch-action:pan-y !important">');document.body.append(body);
    const image=body.querySelector('img'),before=image.style.cssText,touchBefore=image.style.getPropertyValue('touch-action'),zoom=new M.ContentZoom(body);
    try{
        image.dispatchEvent(new window.WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));
        assert.match(image.style.transform,/scale\(1.5\).*rotate\(15deg\)/);assert.equal(image.style.getPropertyPriority('transform'),'important');
    }finally{zoom.dispose();}
    assert.equal(image.style.transform,'');assert.equal(image.style.getPropertyPriority('cursor'),'important');assert.equal(image.style.cursor,'crosshair');assert.equal(image.style.getPropertyValue('touch-action'),touchBefore);
    assert.equal(image.style.cssText,before);
    body.remove();style.remove();
});

test('十字阅读退出恢复原 tabindex，组合键不抢导航，Esc 后可关闭全屏', () => {
    const root=html('<table tabindex="3"><tr><td>A</td><td>B</td></tr></table>');document.body.append(root);M.processTableTools(root);
    const table=root.querySelector('table'),button=Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='十字阅读');
    const proto=window.HTMLDialogElement.prototype,oldShow=proto.showModal,oldClose=proto.close;proto.showModal=function(){this.open=true};proto.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'))};let dialog;
    try{
        button.click();table.querySelector('td').click();
        const modified=new window.KeyboardEvent('keydown',{key:'ArrowRight',ctrlKey:true,bubbles:true,cancelable:true});table.dispatchEvent(modified);assert.equal(modified.defaultPrevented,false);assert.equal(table.querySelector('.vlook-table-current').textContent,'A');
        dialog=M.openContentViewer(table);
        table.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        assert.ok(dialog.isConnected);assert.equal(button.getAttribute('aria-pressed'),'false');assert.equal(table.getAttribute('tabindex'),'3');assert.equal(table.classList.contains('vlook-table-reading'),false);
        table.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(dialog.isConnected,false);
    }finally{dialog?.close();root.remove();proto.showModal=oldShow;proto.close=oldClose;}
});

test('图片错数恢复：重名、网络同名与未知图片不进行猜测', () => {
    const source='![原图](a.png?darksrc=invert#200w)';
    const duplicate=html('<img src="one/a.png"><img src="two/a.png">');M.restoreImages(duplicate,source,()=> 'wrong.png');
    assert.equal(duplicate.children[0].getAttribute('src'),'one/a.png');assert.equal(duplicate.children[1].getAttribute('src'),'two/a.png');
    const network=html('<img src="https://example.org/a.png"><img src="unknown.png">');M.restoreImages(network,source,()=> 'wrong.png');
    assert.equal(network.children[0].getAttribute('src'),'https://example.org/a.png');
    const missing=html('<img src="b.png">');M.restoreImages(missing,'![甲](a.png#100w) ![乙](b.png#200w)',(_raw,current)=>current);assert.equal(missing.firstElementChild.getAttribute('src'),'b.png#200w');
    const known=html('<img src="unknown.png"><img src="app://resource/path/%E5%9B%BE%20a.png">');M.restoreImages(known,'![图](图%20a.png#300w)',(_raw,current)=>current);
    assert.equal(known.children[1].getAttribute('src'),'app://resource/path/%E5%9B%BE%20a.png#300w');
});

test('十字阅读跨 colspan 保留逻辑列，跨短行和隐藏行组继续寻找目标', () => {
    const root=html('<table><tbody><tr><td>A1</td><td>B1</td><td>C1</td></tr><tr><td>A2</td><td colspan="2">BC2</td></tr><tr><td>A3</td><td>B3</td><td>C3</td></tr><tr><td>短行</td></tr></tbody><tbody hidden><tr><td>A隐藏</td><td>B隐藏</td><td>C隐藏</td></tr></tbody><tbody><tr><td>A6</td><td>B6</td><td>C6</td></tr></tbody></table>');
    M.processTableTools(root);const table=root.querySelector('table');Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='十字阅读').click();
    Array.from(table.querySelectorAll('td')).find(td=>td.textContent==='C1').click();
    const key=()=>table.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
    key();assert.equal(table.querySelector('.vlook-table-current').textContent,'BC2');
    key();assert.equal(table.querySelector('.vlook-table-current').textContent,'C3');
    key();assert.equal(table.querySelector('.vlook-table-current').textContent,'C6');
});

test('引用块标题交叉引用：不标缺失，点击按源码行定位折叠标题', () => {
    const source='[查看](#折叠标题)\n\n> ###### 折叠标题\n>\n> 正文';
    const calls=[];const app={workspace:{getActiveViewOfType:()=>null,openLinkText(...args){calls.push(args)}}};
    const root=html('<p><a href="#折叠标题">查看</a></p>');M.renderSection(root,withSource(source,0,{app}));
    const anchor=root.querySelector('a');assert.equal(anchor.classList.contains('vlook-link-missing'),false);anchor.click();assert.equal(calls[0][3].eState.line,2);
});

test('显式 HTML 锚点保留原生导航，代码里的伪锚点仍标记缺失', () => {
    const source='[显式](#custom) [旧式](#legacy) [伪造](#fake)\n\n<div id="custom">正文</div>\n\n<a name="legacy"></a>\n\n```html\n<div id="fake"></div>\n```';
    const root=html('<p><a href="#custom">显式</a><a href="#legacy">旧式</a><a href="#fake">伪造</a></p>');
    M.renderSection(root,withSource(source,0));
    const links=root.querySelectorAll('a');
    assert.equal(links[0].classList.contains('vlook-link-missing'),false);
    assert.equal(links[1].classList.contains('vlook-link-missing'),false);
    assert.equal(links[2].classList.contains('vlook-link-missing'),true);
});

test('规范化标点锚点仍定位原始标题源码行', () => {
    const source='[查看](#api-ab测试)\n\n# API: A+B，测试！\n\n正文';
    const calls=[];const app={workspace:{getActiveViewOfType:()=>null,openLinkText(...args){calls.push(args)}}};
    const root=html('<p><a href="#api-ab测试">查看</a></p>');M.renderSection(root,withSource(source,0,{app}));
    const anchor=root.querySelector('a');assert.equal(anchor.classList.contains('vlook-link-missing'),false);
    anchor.click();assert.equal(calls[0][3].eState.line,2);
});

test('MathJax 公式锚点保留运行时导航，不与规范化标题混淆', () => {
    const source='[公式](#mjx-eqn%3Aenergy)\n\n# mjxeqnenergy\n\n正文';
    const calls=[];const app={workspace:{getActiveViewOfType:()=>null,openLinkText(...args){calls.push(args)}}};
    const root=html('<p><a href="#mjx-eqn%3Aenergy">公式</a></p>');M.renderSection(root,withSource(source,0,{app}));
    const anchor=root.querySelector('a');assert.equal(anchor.classList.contains('vlook-link-missing'),false);
    const event=new window.MouseEvent('click',{bubbles:true,cancelable:true});anchor.dispatchEvent(event);
    assert.equal(event.defaultPrevented,false);assert.equal(calls.length,0);
});

test('未渲染公式标签按源码定位，保留大小写及新窗口修饰键',()=>{
    const source='[公式](#mjx-eqn%3AEnergy%3AA%2BB)\n\n$$\nx=1\\label{Energy:A+B}\\tag{一}\n$$\n\n$$\nx=2\\label{energy:a+b}\n$$';
    const calls=[],app={workspace:{getActiveViewOfType:()=>null,openLinkText(...args){calls.push(args);}}};
    const root=html('<a href="#mjx-eqn%3AEnergy%3AA%2BB">公式一</a><a href="#mjx-eqn%3Aenergy%3Aa%2Bb">公式二</a>');
    M.renderSection(root,withSource(source,0,{app}));
    const [first,second]=root.querySelectorAll('a');
    const event=new window.MouseEvent('click',{bubbles:true,cancelable:true});first.dispatchEvent(event);
    assert.equal(event.defaultPrevented,true);assert.equal(calls[0][3].eState.line,2);
    second.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}));
    assert.equal(calls[1][3].eState.line,6);assert.equal(calls[1][2],true);
    assert.equal(first.dataset.vlookRef,undefined,'公式自带编号不重复添加章节编号');
});

test('已渲染公式保留原生精确标签跳转，不退回整个 align 公式块',()=>{
    const source='[公式](#mjx-eqn%3Aenergy)\n\n$$\nx=1\\label{energy}\n$$';
    const calls=[],app={workspace:{getActiveViewOfType:()=>null,openLinkText(...args){calls.push(args);}}};
    const root=html('<a href="#mjx-eqn%3Aenergy">公式</a><span id="mjx-eqn:energy">编号</span>');
    M.renderSection(root,withSource(source,0,{app}));
    const event=new window.MouseEvent('click',{bubbles:true,cancelable:true});root.querySelector('a').dispatchEvent(event);
    assert.equal(event.defaultPrevented,false);assert.equal(calls.length,0);
});

test('资源失败提示：重复事件不重复提示、成功恢复、卸载移除监听', () => {
    const root=html('<p><img src="missing.png" alt="保留说明" title="原题注"></p><video src="movie.mp4"></video>');
    const cleanups=[];const context=ctx({registerCleanup:fn=>cleanups.push(fn)});
    M.processResourceStatus(root,context);M.processResourceStatus(root,context);
    const image=root.querySelector('img');image.dispatchEvent(new window.Event('error'));image.dispatchEvent(new window.Event('error'));
    assert.equal(root.querySelectorAll('.vlook-resource-error').length,1);
    assert.equal(image.title,'原题注');assert.equal(image.alt,'保留说明');
    image.dispatchEvent(new window.Event('load'));assert.equal(root.querySelector('.vlook-resource-error'),null);
    const video=root.querySelector('video');video.dispatchEvent(new window.Event('error'));
    assert.match(root.querySelector('.vlook-resource-error').textContent,/视频加载失败/);
    let loads=0;video.load=()=>loads++;
    const retry=root.querySelector('.vlook-resource-error button');retry.click();assert.equal(loads,1);
    assert.equal(retry.disabled,true);assert.equal(root.querySelector('.vlook-resource-error').getAttribute('aria-busy'),'true');
    assert.match(root.querySelector('.vlook-resource-error').textContent,/正在重新加载视频/);
    retry.click();assert.equal(loads,1);
    video.dispatchEvent(new window.Event('error'));assert.equal(retry.disabled,false);
    assert.equal(root.querySelector('.vlook-resource-error button'),retry);
    cleanups.forEach(fn=>fn());
    assert.equal(root.querySelector('.vlook-resource-error'),null);
    video.dispatchEvent(new window.Event('error'));assert.equal(root.querySelector('.vlook-resource-error'),null);
});

test('已完成但损坏的图片能立即提示，正常图片不误报', () => {
    const root=html('<img src="bad.png"><img src="good.png">'),images=root.querySelectorAll('img');
    Object.defineProperties(images[0],{complete:{value:true},naturalWidth:{value:0}});
    Object.defineProperties(images[1],{complete:{value:true},naturalWidth:{value:120}});
    M.processResourceStatus(root,ctx());
    assert.equal(root.querySelectorAll('.vlook-resource-error').length,1);
    assert.equal(images[0].dataset.vlookResourceError,'1');assert.equal(images[1].dataset.vlookResourceError,undefined);
});

test('资源检查汇总只列当前视图同源码区块的实际失败，恢复和卸载后清除', () => {
    const source='前言\n\n![图例](bad.png)';
    const root=html('<p><img src="bad.png" alt="图例"></p>');const cleanups=[];
    M.processResourceStatus(root,withSource(source,2,{registerCleanup:fn=>cleanups.push(fn)}));
    const image=root.querySelector('img');image.dispatchEvent(new window.Event('error'));
    const failures=M.renderedResourceFailures(root,'test.md',source);
    assert.equal(failures.length,1);assert.equal(failures[0].status,'missing-resource');
    assert.deepEqual(failures[0].link,{title:'图例',href:'bad.png',line:2});
    assert.equal(M.renderedResourceFailures(root,'other.md',source).length,0);
    assert.equal(M.renderedResourceFailures(root,'test.md','前言\n\n![修改](good.png)').length,0);
    assert.equal(M.renderedResourceFailures(html('<div></div>'),'test.md',source).length,0);
    image.dispatchEvent(new window.Event('load'));assert.equal(M.renderedResourceFailures(root,'test.md',source).length,0);
    image.dispatchEvent(new window.Event('error'));cleanups.forEach(fn=>fn());
    assert.equal(M.renderedResourceFailures(root,'test.md',source).length,0);
});

test('虚拟化卸载保留故障快照，实际恢复清除；旧源码的异步失败不污染新源码', () => {
    const history=new M.ResourceFailureHistory(),source='![图](bad.png)',cleanups=[];
    const root=html('<img src="bad.png" alt="图">');
    M.processResourceStatus(root,withSource(source,0,{resourceHistory:history,registerCleanup:fn=>cleanups.push(fn)}));
    root.querySelector('img').dispatchEvent(new window.Event('error'));cleanups.forEach(fn=>fn());
    assert.equal(history.results('test.md',source).length,1);
    assert.match(history.results('test.md',source)[0].detail,/尚未确认恢复/);
    assert.equal(history.results('other.md',source).length,0);
    assert.equal(history.results('test.md','修改后的文档').length,0);
    const next=html('<img src="bad.png" alt="图">');M.processResourceStatus(next,withSource(source,0,{resourceHistory:history}));
    next.querySelector('img').dispatchEvent(new window.Event('load'));
    assert.equal(history.results('test.md',source).length,0);
    history.record('test.md','旧源码',{link:{title:'旧',href:'old.png',line:0},status:'missing-resource',detail:''});
    assert.equal(history.results('test.md',source).length,0);
    history.clear();assert.equal(history.results('test.md','旧源码').length,0);
});

test('媒体参数按原版保留布尔参数出现语义及 preload 的标准取值', () => {
    for(const kind of ['mp3','mp4']){
        for(const preload of ['none','metadata','auto','']){
            const root=html(`<img src="media/test.${kind}?autoplay&amp;loop&amp;preload=${preload}">`);
            M.renderSection(root,ctx());const media=root.querySelector('audio,video');
            assert.equal(media.autoplay,true);assert.equal(media.loop,true);assert.equal(media.getAttribute('preload'),preload);
        }
        const root=html(`<img src="media/test.${kind}?autoplay=false&amp;loop=false">`);
        M.renderSection(root,ctx());const media=root.querySelector('audio,video');
        assert.equal(media.autoplay,true);assert.equal(media.loop,true);assert.equal(media.preload,'metadata');
    }
});

test('迷你音频生命周期：错误/加载中的 pause 不伪装恢复，旧播放拒绝不覆盖新加载', async () => {
    const root=html('<img src="song.mp3?controls=mini">');document.body.append(root);M.renderSection(root,ctx());
    const audio=root.querySelector('audio'),button=root.querySelector('.v-audio-mini-control');
    audio.dispatchEvent(new window.Event('error'));audio.dispatchEvent(new window.Event('pause'));
    assert.equal(button.dataset.vlookAudioState,'error');assert.equal(button.getAttribute('aria-label'),'音频加载失败');
    audio.dispatchEvent(new window.Event('loadstart'));audio.dispatchEvent(new window.Event('pause'));
    assert.equal(button.dataset.vlookAudioState,'loading');assert.equal(button.getAttribute('aria-disabled'),'true');
    audio.dispatchEvent(new window.Event('canplay'));assert.equal(button.dataset.vlookAudioState,'ready');
    let rejectPlay;audio.play=()=>new Promise((resolve,reject)=>{rejectPlay=reject});
    button.click();audio.dispatchEvent(new window.Event('loadstart'));rejectPlay(new Error('旧请求被取消'));
    await Promise.resolve();await Promise.resolve();
    assert.equal(button.dataset.vlookAudioState,'loading');assert.equal(button.getAttribute('aria-busy'),'true');
    audio.dispatchEvent(new window.Event('canplay'));assert.equal(button.dataset.vlookAudioState,'ready');
    root.remove();
});

test('无题注媒体保留内容浏览入口，内嵌平台视频包装但普通文库 iframe 不受影响', () => {
    const root=html('<audio src="a.mp3"></audio><video src="v.mp4"></video><iframe src="https://player.bilibili.com/player.html?bvid=example#pt"></iframe><iframe src="manual.html"></iframe>');
    M.renderSection(root,ctx());
    assert.equal(root.querySelectorAll('.v-cap-cntr').length,3);
    assert.equal(root.querySelectorAll('.vlook-content-tools').length,3);
    assert.equal(root.querySelector('iframe[src="manual.html"]').closest('.v-cap-cntr'),null);
    assert.equal(M.contentKind(root.querySelector('iframe')),'多媒体');
    const plain=html('<audio src="a.mp3"></audio><video src="v.mp4"></video>');
    M.renderSection(plain,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false}}));
    assert.equal(plain.querySelector('.v-cap-cntr'),null);assert.equal(plain.querySelectorAll('.vlook-content-tools').length,2);
});

test('行内迷你音频不插入浮窗工具，关闭题注时平台 iframe 仍有入口', () => {
    const root=html('<p>行内<img src="song.mp3?controls=mini"></p><iframe src="https://www.youtube.com/embed/example"></iframe><iframe src="manual.html"></iframe>');
    M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false}}));
    assert.equal(root.querySelector('p .vlook-content-tools'),null);
    assert.equal(root.querySelectorAll('.vlook-content-tools').length,1);
    assert.equal(root.querySelector('iframe[src="manual.html"]').dataset.vlookViewer,undefined);
});

test('全文媒体播放交接：暂停原文，复制进度和音量，关闭后按实际状态归还', async () => {
    const origin=html('<video src="clip.mp4"></video>'),full=html('<video src="clip.mp4"></video>');document.body.append(origin,full);
    const original=origin.querySelector('video'),clone=full.querySelector('video');
    let originalPaused=false,clonePaused=true;
    Object.defineProperties(original,{paused:{get:()=>originalPaused},readyState:{value:4}});
    Object.defineProperties(clone,{paused:{get:()=>clonePaused},readyState:{value:4}});
    original.pause=()=>{originalPaused=true};original.play=async()=>{originalPaused=false};
    clone.pause=()=>{clonePaused=true};clone.play=async()=>{clonePaused=false};
    original.currentTime=7;original.volume=.4;original.muted=true;original.playbackRate=1.5;
    const handoff=new M.MediaHandoff(origin);assert.equal(originalPaused,true);
    handoff.attach(full);assert.equal(clone.currentTime,7);assert.equal(clone.volume,.4);assert.equal(clone.muted,true);assert.equal(clone.playbackRate,1.5);assert.equal(clonePaused,false);
    clone.currentTime=11;handoff.release(true);assert.equal(clonePaused,true);assert.equal(original.currentTime,11);assert.equal(originalPaused,false);
    handoff.release(true);origin.remove();full.remove();
});

test('媒体交接切换/失败：切换不恢复后台播放，加载前关闭恢复原状态，已卸载原文不重播', () => {
    const origin=html('<audio src="sound.mp3"></audio>');document.body.append(origin);
    const audio=origin.querySelector('audio');let plays=0;
    Object.defineProperty(audio,'paused',{value:false});audio.pause=()=>{};audio.play=async()=>{plays++};
    new M.MediaHandoff(origin).release(false);assert.equal(plays,0);
    new M.MediaHandoff(origin).release(true);assert.equal(plays,1);
    const gone=new M.MediaHandoff(origin);origin.remove();gone.release(true);assert.equal(plays,1);
});

test('浮窗原文卸载：显式暂停已移出的媒体，再丢弃旧播放器节点', async () => {
    const proto=window.HTMLDialogElement.prototype,oldShow=proto.showModal,oldClose=proto.close;
    proto.showModal=function(){this.open=true};proto.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'))};
    const root=html('<figure><video src="clip.mp4"></video></figure>');document.body.append(root);
    const video=root.querySelector('video');let pauses=0;video.pause=()=>pauses++;
    let dialog;
    try{
        dialog=M.openContentViewer(root.querySelector('figure'));
        root.remove();await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(pauses,1);assert.equal(dialog.isConnected,false);assert.equal(video.isConnected,false);
    }finally{dialog?.remove();root.remove();proto.showModal=oldShow;proto.close=oldClose;}
});

test('保留状态移动：借用和归还调用原子移动，关闭后原节点恢复且不重复恢复', () => {
    const root=html('<section><iframe src="about:blank"></iframe></section><div class="destination"></div>');document.body.append(root);
    const origin=root.querySelector('section'),destination=root.querySelector('.destination'),frame=origin.querySelector('iframe'),calls=[];
    const move=function(node,before){calls.push(this);this.insertBefore(node,before)};
    origin.moveBefore=move;destination.moveBefore=move;
    const borrowed=M.borrowContent(frame,destination);assert.ok(borrowed);assert.equal(frame.parentElement,destination);
    assert.ok(origin.querySelector('.vlook-content-placeholder'));
    borrowed.restore(true);borrowed.restore(true);assert.equal(frame.parentElement,origin);assert.deepEqual(calls,[destination,origin]);
    assert.equal(origin.querySelector('.vlook-content-placeholder'),null);root.remove();
});

test('借用内容不在缺少原子移动时退化重载，失效原文不插回旧 iframe', () => {
    const root=html('<section><iframe src="about:blank"></iframe></section><div class="destination"></div>');document.body.append(root);
    const origin=root.querySelector('section'),destination=root.querySelector('.destination'),frame=origin.querySelector('iframe');
    Object.defineProperty(destination,'moveBefore',{configurable:true,writable:true,value:undefined});
    assert.equal(M.borrowContent(frame,destination),null);assert.equal(frame.parentElement,origin);
    const move=function(node,before){this.insertBefore(node,before)};destination.moveBefore=move;origin.moveBefore=move;
    const borrowed=M.borrowContent(frame,destination);origin.remove();borrowed.restore(false);assert.equal(frame.isConnected,false);root.remove();
});

test('全文浏览复用已渲染 iframe：不重渲染，关闭归还原节点，源码改变后不插回旧内容', () => {
    const source='<iframe src="https://www.youtube.com/embed/example"></iframe>',index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true});
    const root=html('<div data-vlook-source-path="test.md" data-vlook-source-line="0"><figure><iframe src="https://www.youtube.com/embed/example"></iframe></figure></div>');document.body.append(root);
    const frame=root.querySelector('iframe'),section=root.firstElementChild;let current=source,renders=0;
    const bus={on:()=>({}),offref(){}};
    const own={file:{path:'test.md'},contentEl:root,editor:{getValue:()=>current}};
    const app={workspace:{...bus,getLeavesOfType:()=>[{view:own}],getActiveViewOfType:()=>own,getActiveFile:()=>own.file},vault:bus};
    const proto=window.HTMLDialogElement.prototype,oldShow=proto.showModal,oldClose=proto.close,elementProto=window.HTMLElement.prototype,oldMove=elementProto.moveBefore,oldRender=M.MarkdownRenderer.render;
    proto.showModal=function(){this.open=true};proto.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'))};
    elementProto.moveBefore=function(node,before){this.insertBefore(node,before)};M.MarkdownRenderer.render=async()=>{renders++};
    let dialog;
    try{
        const open=()=>M.openSourceContentViewer(root.querySelector('figure'),ctx({app,index,block:index.blocks[0]}));
        dialog=open();assert.equal(renders,0);assert.equal(dialog.querySelector('iframe'),frame);assert.equal(root.querySelector('iframe'),null);
        dialog.close();assert.equal(root.querySelector('iframe'),frame);assert.equal(root.firstElementChild,section);
        dialog=open();current='修改后的内容';dialog.close();assert.equal(frame.isConnected,false);assert.equal(root.querySelector('iframe'),null);
    }finally{dialog?.remove();root.remove();proto.showModal=oldShow;proto.close=oldClose;M.MarkdownRenderer.render=oldRender;if(oldMove)elementProto.moveBefore=oldMove;else delete elementProto.moveBefore;}
});

test('同段多个音视频使用各自题注编号，原生嵌入与生成播放器按顺序对齐', () => {
    const source='![音一](a.mp3) ![音二](b.mp3) ![影一](v.mp4)';
    const root=html('<span class="internal-embed" src="a.mp3" alt="音一"><audio src="a.mp3"></audio></span><img src="b.mp3" alt="音二"><img src="v.mp4" alt="影一">');
    M.renderSection(root,withSource(source,0));
    const captions=Array.from(root.querySelectorAll('.v-cap-1')).map(node=>node.textContent);
    assert.equal(captions.length,3);assert.match(captions[0],/1.*音一/);assert.match(captions[1],/2.*音二/);assert.match(captions[2],/1.*影一/);
});

test('同块第二媒体交叉引用带自己的编号，并能定位到题注源行', () => {
    const source='[二](#二) [视频](#视频)\n\n![一](a.mp3) ![二](b.mp3)\n![视频](a.mp4)';
    const calls=[];const app={workspace:{getActiveViewOfType:()=>null,openLinkText(...args){calls.push(args)}}};
    const root=html('<p><a href="#二">二</a><a href="#视频">视频</a></p>');M.renderSection(root,withSource(source,0,{app}));
    const links=root.querySelectorAll('a');assert.equal(links[0].dataset.vlookRef,'2');assert.equal(links[1].dataset.vlookRef,'1');
    assert.ok(Array.from(links).every(link=>!link.classList.contains('vlook-link-missing')));
    links[0].click();links[1].click();assert.deepEqual(calls.map(call=>call[3].eState.line),[2,3]);
});

test('第二个原生 HTML 媒体题注可引用且不误报缺失', () => {
    const source='[查看](#视频二)\n\n<audio src="a.wav" alt="音频一"></audio>\n<video src="v.mp4" alt="视频二"></video>';
    const calls=[];const app={workspace:{getActiveViewOfType:()=>null,openLinkText(...args){calls.push(args)}}};
    const root=html('<p><a href="#视频二">查看</a></p>');M.renderSection(root,withSource(source,0,{app}));
    const anchor=root.querySelector('a');assert.equal(anchor.dataset.vlookRef,'1');assert.equal(anchor.classList.contains('vlook-link-missing'),false);
    anchor.click();assert.equal(calls[0][3].eState.line,3);
});

test('引用内原生视频与列表音频使用独立源码题注信息', () => {
    const source='> ![引用音频](quote.mp3)\n>\n> > <video src="nested.mp4" alt="嵌套原生视频"></video>\n\n- ![列表音频](list.mp3)';
    const quote=html('<blockquote><p><img src="quote.mp3" alt="引用音频"></p><blockquote><video src="nested.mp4" alt="嵌套原生视频"></video></blockquote></blockquote>');
    M.renderSection(quote,withSource(source,0));
    const captions=Array.from(quote.querySelectorAll('figcaption')).map(el=>el.textContent);
    assert.equal(captions.length,2);assert.match(captions[0],/^(?:音频|Audio) 1 引用音频$/);assert.match(captions[1],/^(?:视频|Video) 1 嵌套原生视频$/);
    const list=html('<ul><li><img src="list.mp3" alt="列表音频"></li></ul>');
    M.renderSection(list,withSource(source,4));
    assert.match(list.querySelector('figcaption').textContent,/^(?:音频|Audio) 2 列表音频$/);
});

test('HTML img 音视频使用各自编号且保留第二题注', () => {
    const source='<div><img src="a.mp3" alt="HTML 音频" title="补充说明"><audio src="b.wav" alt="原生"></audio><img src="v.mp4" alt="HTML 视频"></div>';
    const el=html(source);M.renderSection(el,withSource(source,0));
    const caps=Array.from(el.querySelectorAll('.v-cap-1')).map(cap=>cap.textContent);
    assert.equal(caps.length,3);
    assert.match(caps[0],/^(?:音频|Audio) 2 HTML 音频$/);
    assert.match(caps[1],/^(?:音频|Audio) 1 原生$/);
    assert.match(caps[2],/^(?:视频|Video) 1 HTML 视频$/);
    assert.equal(el.querySelector('.v-cap-2').textContent,'补充说明');
});

test('混合 HTML 普通 iframe 不被后置题注回退误包裹', () => {
    const source='<div><iframe src="https://example.com/document" title="普通网页"></iframe><video src="clip.mp4" alt="标准视频"></video></div>';
    const el=html(source);M.renderSection(el,withSource(source,0));
    assert.equal(el.querySelector('iframe').closest('.v-caption'),null);
    assert.equal(el.querySelectorAll('.v-cap-1').length,1);
    assert.match(el.querySelector('.v-cap-1').textContent,/^(?:视频|Video) 1 标准视频$/);
});

test('混合 HTML 迷你音频不被后置题注回退误包裹', () => {
    const source='<div><img src="mini.mp3?controls=mini" alt="迷你"><img src="standard.mp3" alt="标准音频"></div>';
    const el=html(source);M.renderSection(el,withSource(source,0));
    assert.equal(el.querySelector('audio[id^="vk-id-mini-audio"]').closest('.v-caption'),null);
    assert.equal(el.querySelectorAll('.v-cap-1').length,1);
    assert.match(el.querySelector('.v-cap-1').textContent,/^(?:音频|Audio) 1 标准音频$/);
});

test('段落内 HTML 与 Markdown 音频渲染使用源序各自编号', () => {
    const source='文字 <img src="one.mp3" alt="HTML 图片式音频"> <audio src="two.wav" alt="HTML 原生音频"></audio> ![Markdown 音频](three.mp3)';
    const el=html('<p>文字 <img src="one.mp3" alt="HTML 图片式音频"> <audio src="two.wav" alt="HTML 原生音频"></audio> <img src="three.mp3" alt="Markdown 音频"></p>');
    M.renderSection(el,withSource(source,0));
    const captions=Array.from(el.querySelectorAll('.v-cap-1')).map(cap=>cap.textContent);
    assert.equal(captions.length,3);
    assert.match(captions[0],/^(?:音频|Audio) 2 HTML 图片式音频$/);
    assert.match(captions[1],/^(?:音频|Audio) 1 HTML 原生音频$/);
    assert.match(captions[2],/^(?:音频|Audio) 3 Markdown 音频$/);
});

test('媒体锚点点击按最新源码重定位，不使用渲染时旧行号', () => {
    const source='[查看](#后一个)\n\n文字 <audio src="first.mp3" alt="前一个"></audio>\n<audio src="second.mp3" alt="后一个"></audio>';
    const root=html('<p><a href="#后一个">查看</a></p>');
    let current=source;const lines=[],opened=[];
    const view={file:{path:'test.md'},contentEl:root,editor:{getValue:()=>current,lineCount:()=>current.split('\n').length,getCursor:()=>({line:0}),setCursor:()=>{},scrollIntoView:()=>{}},getMode:()=> 'source',setEphemeralState:state=>lines.push(state.line)};
    const app={workspace:{getLeavesOfType:()=>[{view}],getActiveViewOfType:()=>view,openLinkText:(...args)=>opened.push(args)}};view.app=app;
    M.renderSection(root,withSource(source,0,{app}));
    const anchor=root.querySelector('a');assert.equal(anchor.dataset.vlookRef,'2');
    current=source.replace('文字 <audio','新增正文\n\n文字 <audio');anchor.click();
    assert.deepEqual(lines,[5]);assert.equal(opened.length,0);
    current=current.replace('alt="后一个"','alt="已改名"');anchor.click();
    assert.deepEqual(lines,[5]);assert.equal(opened.length,0);
});

test('表格及嵌套列表的媒体锚点点击定位各自具体源行', () => {
    const source='[表中](#表内视频) [嵌套](#嵌套音频)\n\n|类型|媒体|\n|---|---|\n|视频|<video src="v.mp4" alt="表内视频"></video>|\n\n- 正文\n  - ![嵌套音频](a.mp3)';
    const calls=[];const app={workspace:{getActiveViewOfType:()=>null,openLinkText:(...args)=>calls.push(args)}};
    const root=html('<p><a href="#表内视频">表中</a><a href="#嵌套音频">嵌套</a></p>');M.renderSection(root,withSource(source,0,{app}));
    const links=Array.from(root.querySelectorAll('a'));assert.ok(links.every(a=>!a.classList.contains('vlook-link-missing')));
    links.forEach(a=>a.click());assert.deepEqual(calls.map(call=>call[3].eState.line),[4,7]);
});

test('图文混排与同块多图生成独立题注，不再要求段落只有一张图', () => {
    const source='文字 ![一](one.png) ![音频](a.mp3)\n![二](two.png "第二说明")';
    const root=html('<p>文字 <img src="one.png" alt="一"><img src="a.mp3" alt="音频"><img src="two.png" alt="二" title="第二说明"></p>');
    M.renderSection(root,withSource(source,0));
    const images=root.querySelectorAll('img');assert.equal(images.length,2);
    assert.match(images[0].closest('.v-caption').querySelector('.v-cap-1').textContent,/^(?:图|Figure) 1 一$/);
    assert.match(images[1].closest('.v-caption').querySelector('.v-cap-1').textContent,/^(?:图|Figure) 2 二$/);
    assert.equal(images[1].closest('.v-caption').querySelector('.v-cap-2').textContent,'第二说明');
    assert.match(root.querySelector('audio').closest('.v-caption').textContent,/(?:音频|Audio) 1 音频/);
});

test('kbd 按钮图片与正文图混排，渲染与源码计数保持一致', () => {
    const source='按钮 <kbd>![按钮图](button.png)</kbd> ![正文](one.png)';
    const root=html('<p>按钮 <kbd><img src="button.png" alt="按钮图"></kbd><img src="one.png" alt="正文"></p>');
    M.renderSection(root,withSource(source,0));
    assert.equal(root.querySelector('kbd img').closest('.v-caption'),null);
    assert.equal(root.querySelectorAll('.v-cap-1').length,1);
    assert.match(root.querySelector('.v-cap-1').textContent,/^(?:图|Figure) 1 正文$/);
});

test('HTML 图与 Markdown 图混排渲染各自编号和第二题注', () => {
    const source='![前图](first.png) <img src="second.png" alt="HTML &amp; 二" title="HTML 说明">\n\n![后图](after.png)';
    const root=html('<p><img src="first.png" alt="前图"><img src="second.png" alt="HTML &amp; 二" title="HTML 说明"></p>');
    M.renderSection(root,withSource(source,0));
    const caps=Array.from(root.querySelectorAll('.v-cap-1')).map(el=>el.textContent);
    assert.match(caps[0],/^(?:图|Figure) 1 前图$/);assert.match(caps[1],/^(?:图|Figure) 2 HTML & 二$/);
    assert.equal(root.querySelector('.v-cap-2').textContent,'HTML 说明');
});

test('图文混排前置双题注只作用于第一张图片并隐藏源题注', () => {
    const source='*==图文题注_补充说明_==*\n\n说明 ![](one.png) ![自带题注](two.png)';
    const marker=html('<p><em><mark>图文题注_补充说明_</mark></em></p>');M.renderSection(marker,withSource(source,0));
    assert.equal(marker.classList.contains('vlook-caption-source'),true);
    const root=html('<p>说明 <img src="one.png"><img src="two.png" alt="自带题注"></p>');M.renderSection(root,withSource(source,2));
    const captions=Array.from(root.querySelectorAll('.v-cap-1')).map(cap=>cap.textContent);
    assert.match(captions[0],/^(?:图|Figure) 1 图文题注$/);assert.match(captions[1],/^(?:图|Figure) 2 自带题注$/);
    assert.equal(root.querySelectorAll('.v-cap-2').length,1);assert.equal(root.querySelector('.v-cap-2').textContent,'补充说明');
});

test('引用内部前置题注在阅读与导出中一致分配并去除源段落', () => {
    const source='> *==引用题注_补充说明_==*\n>\n> ![](a.png)';
    const markup='<blockquote><p><em><mark>引用题注<em>补充说明</em></mark></em></p><p><img src="a.png"></p></blockquote>';
    const root=html(markup);M.renderSection(root,withSource(source,0));
    assert.match(root.querySelector('.v-cap-1').textContent,/^(?:图|Figure) 1 引用题注$/);
    assert.equal(root.querySelector('.v-cap-2').textContent,'补充说明');assert.equal(root.querySelector('em mark'),null);
    const exported=html(markup);M.toTyporaDom(exported,true);assert.equal(exported.querySelector('img').alt,'引用题注');assert.equal(exported.querySelector('img').title,'补充说明');
});

test('全文浏览初始定位按对象序号区分同块重名、无题注和混排媒体', () => {
    for(const titles of [['重复','重复'],['','']]){
        const source=`![${titles[0]}](a.png) ![声音](a.mp3) ![${titles[1]}](b.png)`,index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true});
        const root=html(`<p><img src="a.png" alt="${titles[0]}"><img src="a.mp3" alt="声音"><img src="b.png" alt="${titles[1]}"></p>`);
        M.renderSection(root,ctx({index,block:index.blocks[0]}));
        const items=M.sourceContentItems(index),figures=root.querySelectorAll('.v-caption.figure');
        const selected=M.selectedContentItem(items,figures[1],0);
        assert.equal(selected.target.kind,'figure');assert.equal(selected.target.index,1);assert.equal(selected,items[2]);
        const media=root.querySelector('.v-caption[data-fig-type="audio"]');assert.equal(M.selectedContentItem(items,media,0),items[1]);
    }
});

test('关闭题注时全文浏览仍按源码对象序号定位多图和混排播放器', () => {
    const source='![](a.png) ![](a.mp3) ![](b.png) ![](v.mp4)',index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true});
    const root=html('<p><img src="a.png"><img src="a.mp3"><img src="b.png"><img src="v.mp4"></p>');
    M.renderSection(root,ctx({index,block:index.blocks[0],settings:{...M.DEFAULT_SETTINGS,captions:false}}));
    assert.equal(root.querySelector('.v-caption'),null);
    const items=M.sourceContentItems(index),secondImage=root.querySelectorAll('img')[1],video=root.querySelector('video');
    assert.equal(M.selectedContentItem(items,secondImage,0),items[2]);
    assert.equal(M.selectedContentItem(items,video,0),items[3]);
    assert.equal(video.dataset.vlookContentIndex,'1');
});

test('表格整体入口不被表内媒体的对象序号抢占', () => {
    const source='|内容|\n|---|\n|![视频](v.mp4)|',index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true});
    for(const captions of [true,false]){
        const root=html('<table><thead><tr><th>内容</th></tr></thead><tbody><tr><td><img src="v.mp4" alt="视频"></td></tr></tbody></table>');
        M.renderSection(root,ctx({index,block:index.blocks[0],settings:{...M.DEFAULT_SETTINGS,captions}}));
        const items=M.sourceContentItems(index),table=root.querySelector('table');
        assert.equal(M.selectedContentItem(items,captions?table.closest('.v-cap-cntr'):table,0),items[0]);
    }
});

test('缩放适配接受当前选中图片，切换媒体时归还先前图片样式', () => {
    const body=html('<img src="a.png"><audio src="a.wav"></audio><img src="b.png">'),images=body.querySelectorAll('img'),audio=body.querySelector('audio');
    const zoom=new M.ContentZoom(body);
    zoom.refresh(images[1]);
    assert.equal(images[0].style.cursor,'');assert.equal(images[1].style.cursor,'grab');
    zoom.refresh(audio);assert.equal(images[1].style.cursor,'');assert.equal(audio.style.cursor,'');
    zoom.dispose();
});

test('浮窗 ResizeObserver 仅重新适配当前选中图片', () => {
    const old=window.ResizeObserver;let resized,height=400;
    window.ResizeObserver=class {constructor(callback){resized=callback}observe(){}disconnect(){}};
    const body=html('<img src="a.png"><img src="b.png">'),images=body.querySelectorAll('img');
    Object.defineProperties(body,{clientWidth:{value:600},clientHeight:{get:()=>height}});
    body.getBoundingClientRect=()=>({left:0,top:0,width:600,height});
    images.forEach(image=>{image.getBoundingClientRect=()=>({left:0,top:0,width:600,height:700})});
    let zoom;
    try{zoom=new M.ContentZoom(body);zoom.refresh(images[1]);height=200;resized();assert.equal(images[0].style.transform,'');assert.match(images[1].style.transform,/scale\(0\.285714/);}
    finally{zoom?.dispose();if(old)window.ResizeObserver=old;else delete window.ResizeObserver;}
});

test('全文浮窗关闭后迟到的原生媒体不留在旧渲染容器', async () => {
    const original=M.MarkdownRenderer.render,proto=window.HTMLDialogElement.prototype,show=proto.showModal,close=proto.close;
    let finish,dialog,lateHost,pauses=0;const gate=new Promise(resolve=>{finish=resolve});
    const source='![媒体](a.mp3)',index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true});
    const root=html('<div data-vlook-source-path="test.md" data-vlook-source-line="0"><audio src="a.mp3"></audio></div>');root.querySelector('audio').pause=()=>{};
    const bus={on:()=>({}),offref(){}};const app={workspace:{...bus,getActiveViewOfType:()=>null,getActiveFile:()=>({path:'test.md'})},vault:bus};
    proto.showModal=function(){this.open=true};proto.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'))};
    try{
        M.MarkdownRenderer.render=async(_app,_source,el)=>{lateHost=el;await gate;el.innerHTML='<video src="late.mp4" autoplay></video>';el.querySelector('video').pause=()=>{pauses++};};
        dialog=M.openSourceContentViewer(root.querySelector('audio'),ctx({app,index,block:index.blocks[0]}));dialog.close();finish();
        await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(pauses,1);assert.equal(lateHost.querySelector('video'),null);assert.equal(dialog.isConnected,false);
    }finally{finish();dialog?.remove();proto.showModal=show;proto.close=close;M.MarkdownRenderer.render=original;}
});

test('阅读异步 SVG 就绪后生成题注，取消时不清空宿主 DOM', async () => {
    const source='*==阅读图表==*\n\n```mermaid\nflowchart LR\nA-->B\n```',index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true});
    const root=html('<div class="mermaid"></div>'),cleanups=[];
    const ready=M.renderReadySection(root,ctx({index,block:index.blocks[1],registerCleanup:fn=>cleanups.push(fn)}));
    assert.equal(root.querySelector('.v-caption'),null);
    root.querySelector('.mermaid').innerHTML='<svg><text>异步输出</text></svg>';await ready;
    assert.match(root.querySelector('.v-cap-1').textContent,/阅读图表/);
    cleanups.forEach(fn=>fn());
    const cancelled=html('<div class="mermaid">原生占位</div>'),cancel=[];
    const waiting=M.renderReadySection(cancelled,ctx({index,block:index.blocks[1],registerCleanup:fn=>cancel.push(fn)}));
    cancel.forEach(fn=>fn());await assert.rejects(waiting,error=>error.name==='AbortError');
    assert.equal(cancelled.textContent,'原生占位');assert.equal(cancelled.querySelector('.v-caption'),null);
});

test('阅读区块重用时取消旧异步增强，旧 cleanup 不影响新任务', async () => {
    const make=title=>M.getSourceIndex(`*==${title}==*\n\n\`\`\`mermaid\nflowchart LR\nA-->B\n\`\`\``,{captionGroup:false,captionNumber:true});
    const oldIndex=make('旧题注'),newIndex=make('新题注'),root=html('<div class="mermaid"></div>'),oldCleanup=[],newCleanup=[];
    const oldTask=M.renderReadySection(root,ctx({index:oldIndex,block:oldIndex.blocks[1],registerCleanup:fn=>oldCleanup.push(fn)}));
    const rejected=assert.rejects(oldTask,error=>error.name==='AbortError');
    const newTask=M.renderReadySection(root,ctx({index:newIndex,block:newIndex.blocks[1],registerCleanup:fn=>newCleanup.push(fn)}));
    oldCleanup.forEach(fn=>fn());root.querySelector('.mermaid').innerHTML='<svg><text>新输出</text></svg>';
    await rejected;await newTask;
    assert.match(root.querySelector('.v-cap-1').textContent,/新题注/);assert.doesNotMatch(root.textContent,/旧题注/);
    newCleanup.forEach(fn=>fn());
});

test('重用区块改为普通内容时也取消旧图表等待', async () => {
    const source='```mermaid\nflowchart LR\n```',index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true}),root=html('<div class="mermaid"></div>');
    const oldTask=M.renderReadySection(root,ctx({index,block:index.blocks[0]})),rejected=assert.rejects(oldTask,error=>error.name==='AbortError');
    root.innerHTML='<p>新的正文</p>';await M.renderReadySection(root,ctx());await rejected;
    assert.equal(root.textContent,'新的正文');assert.equal(root.querySelector('.v-caption'),null);
});

test('注音查询使用触发元素所属窗口', () => {
    const other=new JSDOM('<ruby>字<rt>zì</rt></ruby>');
    const calls=[],original=window.open;
    window.open=()=>{throw new Error('不应使用主窗口')};
    other.window.open=(...args)=>calls.push(args);
    try {
        const rt=other.window.document.querySelector('rt');
        rt.addEventListener('click',event=>M.openPhoneticLookup('字','zì',event));
        rt.dispatchEvent(new other.window.MouseEvent('click',{bubbles:true}));
        assert.deepEqual(calls,[['https://www.zdic.net/hans/'+encodeURI('字'),'字']]);
    } finally {window.open=original;other.window.close();}
});

test('超范围进度条由所属窗口调度并读取样式', () => {
    const other=new JSDOM('<strong><label></label>150</strong>');
    const strong=other.window.document.querySelector('strong'),label=strong.querySelector('label');
    let frame,reads=0;
    other.window.requestAnimationFrame=callback=>{frame=callback;return 1};
    other.window.getComputedStyle=element=>{assert.equal(element,label);reads++;return {outlineWidth:'2px'}};
    label.getBoundingClientRect=()=>({width:200});
    try {
        M.buildProgress(strong,150);assert.equal(typeof frame,'function');frame();
        assert.equal(reads,1);assert.equal(label.style.marginRight,'105px');
        assert.match(label.style.boxShadow,/102px/);
    } finally {other.window.close();}
});

test('文本包装使用所属文档并保留代码和注音节点', () => {
    const other=new JSDOM('<main><p>正文<kbd>Ctrl</kbd><code>示例</code><ruby>字<rt>zì</rt></ruby></p></main>');
    try {
        const root=other.window.document.querySelector('main');M.wrapTextSpans(root);
        assert.equal(root.querySelector('p > span').textContent,'正文');
        assert.equal(root.querySelector('kbd > span').textContent,'Ctrl');
        assert.equal(root.querySelector('code > span'),null);assert.equal(root.querySelector('rt > span'),null);
        assert.equal(root.querySelector('p > span').ownerDocument,other.window.document);
    } finally {other.window.close();}
});

test('进度条重建后旧帧不能恢复已过期溢出，已应用边距也需清除', () => {
    const other=new JSDOM('<strong><label></label>150</strong>');
    const strong=other.window.document.querySelector('strong'),label=strong.querySelector('label'),frames=[];
    other.window.requestAnimationFrame=callback=>{frames.push(callback);return frames.length};
    other.window.getComputedStyle=()=>({outlineWidth:'2px'});
    label.getBoundingClientRect=()=>({width:200});
    try {
        M.buildProgress(strong,150);M.buildProgress(strong,50);frames[0]();
        assert.equal(label.style.boxShadow,'');assert.equal(label.style.marginRight,'');
        M.buildProgress(strong,-20);frames[1]();assert.equal(label.style.marginLeft,'40px');
        M.buildProgress(strong,120);assert.equal(label.style.marginLeft,'');frames[2]();
        assert.equal(label.style.marginRight,'45px');
        M.buildProgress(strong,80);assert.equal(label.style.marginRight,'');assert.equal(label.style.boxShadow,'');
        assert.equal(Array.from(strong.classList).filter(name=>/^id-\d+$/.test(name)).length,1);
    } finally {other.window.close();}
});

test('进度条标签被替换后旧测量帧不再写入旧标签', () => {
    const other=new JSDOM('<strong><label></label>150</strong>');
    const strong=other.window.document.querySelector('strong'),label=strong.querySelector('label');let frame;
    other.window.requestAnimationFrame=callback=>{frame=callback;return 1};
    other.window.getComputedStyle=()=>{throw new Error('过期标签不应测量')};
    try {
        M.buildProgress(strong,150);label.replaceWith(other.window.document.createElement('label'));frame();
        assert.equal(label.style.boxShadow,'');assert.equal(strong.querySelector('label').style.boxShadow,'');
    } finally {other.window.close();}
});

test('历史图片魔法从源码恢复并保留到导出 DOM', () => {
    const hashes=['#180deg','#fliph','#flipv','#fliph#flipv','#180deg#fliph'];
    for(const hash of hashes){
        const source=`![示例](pic/a.png${hash})`,index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true});
        const root=html('<p><img src="pic/a.png" alt="示例"></p>');
        M.renderSection(root,ctx({index,block:index.blocks[0],settings:{...M.DEFAULT_SETTINGS,captions:false}}));
        assert.equal(root.querySelector('img').getAttribute('src'),`pic/a.png${hash}`);
        M.toTyporaDom(root,source);
        assert.equal(root.querySelector('img').getAttribute('src'),`pic/a.png${hash}`);
    }
});

test('darksrcset 跟随图片所属窗口切换，切回浅色恢复原图片集', () => {
    const other=new JSDOM('<div><img src="https://example.org/pic/a.png"></div>');
    const source='![高清](https://example.org/pic/a.png?darksrc=~&srcset=@2x,@3x&darksrcset=@2x,@3x#logo)';
    const index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true});
    try {
        other.window.document.body.classList.add('theme-dark');
        const root=other.window.document.querySelector('div');
        M.renderSection(root,ctx({index,block:index.blocks[0],settings:{...M.DEFAULT_SETTINGS,captions:false}}));
        const img=root.querySelector('img');
        assert.match(img.src,/a~dark\.png/);
        assert.equal(img.srcset,'https://example.org/pic/a~dark@2x.png 2x,https://example.org/pic/a~dark@3x.png 3x');
        other.window.document.body.classList.remove('theme-dark');M.applyColorScheme(root);
        assert.match(img.src,/\/a\.png\?/);
        assert.equal(img.srcset,'https://example.org/pic/a@2x.png 2x,https://example.org/pic/a@3x.png 3x');
    } finally {other.window.close();}
});

test('深色替换没有高清图片集时清除浅色 srcset，切回时恢复', () => {
    const root=html('<img data-darksrc="alter" data-src-light="light.png" data-src-dark="dark.png" data-srcset-light="light@2x.png 2x" src="light.png" srcset="light@2x.png 2x">');
    const wasDark=document.body.classList.contains('theme-dark');
    try {
        document.body.classList.add('theme-dark');M.applyColorScheme(root);
        const img=root.querySelector('img');assert.equal(img.getAttribute('src'),'dark.png');assert.equal(img.hasAttribute('srcset'),false);
        document.body.classList.remove('theme-dark');M.applyColorScheme(root);
        assert.equal(img.getAttribute('src'),'light.png');assert.equal(img.srcset,'light@2x.png 2x');
    } finally {document.body.classList.toggle('theme-dark',wasDark);}
});

test('原生 HTML 图片的浅色 srcset 在明暗往返后保留', () => {
    const root=html('<img src="https://example.org/a.png?darksrc=~" srcset="https://example.org/native.png 2x">');
    const wasDark=document.body.classList.contains('theme-dark');
    try {
        document.body.classList.add('theme-dark');M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false}}));
        const img=root.querySelector('img');assert.equal(img.hasAttribute('srcset'),false);
        document.body.classList.remove('theme-dark');M.applyColorScheme(root);
        assert.equal(img.srcset,'https://example.org/native.png 2x');
    } finally {document.body.classList.toggle('theme-dark',wasDark);}
});

test('深色约定文件名保留编码后的井号问号和百分号', () => {
    const cases=[['photo%23name.png','photo%23name~dark.png'],['photo%3Fname.png','photo%3Fname~dark.png'],['photo%25name.png','photo%25name~dark.png'],['photo%20name.png','photo%20name~dark.png']];
    for(const [light,dark] of cases){
        const root=html(`<img src="https://example.org/pic/${light}?darksrc=~">`);
        M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false}}));
        assert.equal(root.querySelector('img').dataset.srcDark,`https://example.org/pic/${dark}`);
    }
});

test('深色资源允许协议相对地址，不拼接到原图片目录', () => {
    const root=html('<img src="https://example.org/pic/light.png?darksrc=%2F%2Fcdn.example.org%2Fdark.png">');
    M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false}}));
    assert.equal(root.querySelector('img').dataset.srcDark,'https://cdn.example.org/dark.png');
});

test('SVG 剪影迟到响应不能替换已改地址的图片', async () => {
    const original=globalThis.fetch;let finish;
    globalThis.fetch=()=>new Promise(resolve=>{finish=resolve});
    try {
        const root=html('<img src="https://example.org/old.svg?fill=rd#icon">');
        M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false}}));
        const img=root.querySelector('img');img.src='https://example.org/new.svg';
        finish({ok:true,text:async()=>'<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H1"/></svg>'});
        await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(root.querySelector('img'),img);assert.equal(root.querySelector('svg'),null);
    } finally {globalThis.fetch=original;}
});

test('SVG 剪影卸载后不替换节点，HTTP 失败保持原图', async () => {
    const original=globalThis.fetch;let finish;const cleanups=[];
    globalThis.fetch=()=>new Promise(resolve=>{finish=resolve});
    try {
        const root=html('<img src="https://example.org/a.svg?fill=bu#icon">');
        M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false},registerCleanup:fn=>cleanups.push(fn)}));
        const img=root.querySelector('img');cleanups.forEach(fn=>fn());
        finish({ok:true,text:async()=>'<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>'});
        await new Promise(resolve=>setTimeout(resolve,0));assert.equal(root.querySelector('img'),img);
        globalThis.fetch=async()=>({ok:false,text:async()=>'<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>'});
        const failed=html('<img src="https://example.org/b.svg?fill=bu#icon">');
        M.renderSection(failed,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false}}));
        await new Promise(resolve=>setTimeout(resolve,0));assert.ok(failed.querySelector('img'));assert.equal(failed.querySelector('svg'),null);
    } finally {globalThis.fetch=original;}
});

test('SVG 剪影支持未挂载的渲染区块并导入所属文档', async () => {
    const original=globalThis.fetch;
    globalThis.fetch=async()=>({ok:true,text:async()=>'<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H1"/></svg>'});
    const other=new JSDOM('<main></main>');
    try {
        const root=other.window.document.createElement('div');root.innerHTML='<img src="https://example.org/a.svg?fill=bu#icon" width="42">';
        M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false}}));
        await new Promise(resolve=>setTimeout(resolve,0));
        const svg=root.querySelector('svg');assert.ok(svg);assert.equal(svg.ownerDocument,other.window.document);
        assert.equal(svg.getAttribute('data-img-fill'),'bu');assert.equal(svg.getAttribute('width'),'42');
        assert.equal(svg.querySelector('path').style.fill,'var(--ac-bu)');
    } finally {globalThis.fetch=original;other.window.close();}
});

test('SVG 正文读取期间卸载会取消请求且迟到正文不写入', async () => {
    const original=globalThis.fetch;let finish,signal,started=false;const cleanups=[];
    globalThis.fetch=async(_url,options)=>{signal=options.signal;return {ok:true,text:()=>{started=true;return new Promise(resolve=>{finish=resolve})}}};
    try {
        const root=html('<img src="https://example.org/a.svg?fill=text#icon">');
        M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false},registerCleanup:fn=>cleanups.push(fn)}));
        const img=root.querySelector('img');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(started,true);
        cleanups.forEach(fn=>fn());assert.equal(signal.aborted,true);finish('<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>');
        await new Promise(resolve=>setTimeout(resolve,0));assert.equal(root.querySelector('img'),img);assert.equal(root.querySelector('svg'),null);
    } finally {globalThis.fetch=original;}
});

test('明信片紧随引用块作为富文本正文且保留原链接节点', () => {
    const root=html('<blockquote><p><a href="https://example.org"><img src="a.png#card" alt="被替换正文" title="标题"></a></p><blockquote><p>富文本<strong>加粗</strong><a href="https://example.org/info">详情</a></p><ul><li>项目</li></ul></blockquote></blockquote>');
    const link=root.querySelector('a[href="https://example.org/info"]');let clicks=0;link.addEventListener('click',event=>{event.preventDefault();clicks++});
    M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false}}));
    const body=root.querySelector('.v-card-text');assert.ok(body.querySelector('strong'));assert.ok(body.querySelector('ul > li'));
    assert.equal(body.querySelector('a'),link);assert.doesNotMatch(body.textContent,/被替换正文/);
    assert.equal(root.querySelectorAll('blockquote').length,1);assert.equal(root.querySelector('.v-card-title').textContent,'标题');
    link.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true}));assert.equal(clicks,1);
});

test('明信片只取紧邻引用块，不跳过普通段落消费后续内容', () => {
    const root=html('<p><img src="a.png#card" alt="原正文"></p><p>间隔</p><blockquote><p>独立内容</p></blockquote>');
    M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false}}));
    assert.equal(root.querySelector('.v-card-text').textContent,'原正文');assert.equal(root.querySelector('blockquote').textContent,'独立内容');
});

test('平铺明信片立即按所属窗口初始化宽度且卸载移除监听', () => {
    const other=new JSDOM('<div><p><img src="https://example.org/a.png#cardd" alt="正文"></p></div>');
    const original=other.window.getComputedStyle;let width='240px';const cleanups=[];
    other.window.getComputedStyle=()=>({width});
    try {
        const root=other.window.document.querySelector('div');
        M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false},registerCleanup:fn=>cleanups.push(fn)}));
        const card=root.querySelector('.v-post-card'),img=root.querySelector('img');assert.equal(card.style.width,'240px');
        width='320px';img.dispatchEvent(new other.window.Event('load'));assert.equal(card.style.width,'320px');
        cleanups.forEach(fn=>fn());width='400px';img.dispatchEvent(new other.window.Event('load'));assert.equal(card.style.width,'320px');
    } finally {other.window.getComputedStyle=original;other.window.close();}
});

test('键盘聚焦展开明信片，进入正文链接不收起，Escape 归还焦点', () => {
    const root=html('<p><img src="a.png#card" alt="正文" style="filter:grayscale(1)"></p><blockquote><p><a href="https://example.org">详情</a></p></blockquote><button>外部</button>');document.body.append(root);
    try {
        M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false}}));
        const img=root.querySelector('img'),card=root.querySelector('.v-post-card'),link=card.querySelector('a');
        assert.equal(img.tabIndex,0);assert.equal(img.getAttribute('aria-details'),card.id);
        img.focus();assert.equal(card.style.display,'block');link.focus();assert.equal(card.style.display,'block');
        img.dispatchEvent(new window.MouseEvent('mouseleave'));assert.equal(card.style.display,'block');
        link.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        assert.equal(document.activeElement,img);assert.equal(card.style.display,'none');assert.equal(img.style.filter,'grayscale(1)');
        link.focus();root.querySelector('button').focus();assert.equal(card.style.display,'none');
    } finally {root.remove();}
});

test('图片链接明信片复用原生链接焦点，保留 Enter 导航，卸载清理增强', () => {
    const root=html('<p><a href="https://example.org" aria-details="existing"><img src="a.png#card" alt="正文"></a></p>');document.body.append(root);const cleanups=[];
    try {
        M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false},registerCleanup:fn=>cleanups.push(fn)}));
        const link=root.querySelector('a'),img=root.querySelector('img'),card=root.querySelector('.v-post-card');
        assert.equal(img.hasAttribute('tabindex'),false);link.focus();assert.equal(card.style.display,'block');
        const enter=new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});link.dispatchEvent(enter);assert.equal(enter.defaultPrevented,false);
        cleanups.forEach(fn=>fn());assert.equal(link.getAttribute('aria-details'),'existing');assert.equal(link.hasAttribute('tabindex'),false);
    } finally {root.remove();}
});

test('SVG 填色替换后明信片仍能聚焦展开、Escape 收起并清理', async () => {
    const original=globalThis.fetch;let finish;const cleanups=[];
    globalThis.fetch=()=>new Promise(resolve=>{finish=resolve});
    const root=html('<p><img src="https://example.org/a.svg?fill=bu#card" alt="剪影卡片"></p><blockquote><p><a href="#target">正文链接</a></p></blockquote>');document.body.append(root);
    try {
        M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false},registerCleanup:fn=>cleanups.push(fn)}));
        root.querySelector('img').focus();
        finish({ok:true,text:async()=>'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><path/></svg>'});
        await new Promise(resolve=>setTimeout(resolve,0));
        const svg=root.querySelector('svg'),card=root.querySelector('.v-post-card');
        assert.equal(document.activeElement,svg);assert.equal(svg.getAttribute('aria-label'),'剪影卡片');assert.equal(svg.getAttribute('role'),'img');
        assert.equal(svg.getAttribute('aria-details'),card.id);assert.equal(svg.getAttribute('tabindex'),'0');
        svg.getBoundingClientRect=()=>({width:240,bottom:120});
        svg.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(card.style.display,'none');
        svg.dispatchEvent(new window.MouseEvent('mouseenter'));assert.equal(card.style.display,'block');assert.equal(card.style.width,'240px');
        const link=card.querySelector('a');link.focus();link.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        assert.equal(document.activeElement,svg);assert.equal(card.style.display,'none');
        cleanups.forEach(fn=>fn());assert.equal(svg.hasAttribute('tabindex'),false);assert.equal(svg.hasAttribute('aria-details'),false);
        svg.dispatchEvent(new window.MouseEvent('mouseenter'));assert.equal(card.style.display,'none');
    } finally {root.remove();globalThis.fetch=original;}
});

test('平铺 SVG 明信片替换时重新测量并迁移尺寸观察器', async () => {
    const original=globalThis.fetch,other=new JSDOM('<main><p><img src="https://example.org/a.svg?fill=bu#cardd" alt="正文"></p></main>');
    const cleanups=[],observers=[];
    other.window.ResizeObserver=class {constructor(callback){this.callback=callback;observers.push(this)}observe(target){this.target=target}disconnect(){this.disconnected=true}};
    other.window.getComputedStyle=element=>({width:element.tagName.toLowerCase()==='svg'?'320px':'240px'});
    globalThis.fetch=async()=>({ok:true,text:async()=>'<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>'});
    try {
        const root=other.window.document.querySelector('main');
        M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false},registerCleanup:fn=>cleanups.push(fn)}));
        const card=root.querySelector('.v-post-card');assert.equal(card.style.width,'240px');
        await new Promise(resolve=>setTimeout(resolve,0));assert.equal(card.style.width,'320px');
        assert.equal(observers.length,2);assert.equal(observers[0].disconnected,true);assert.equal(observers[1].target,root.querySelector('svg'));
        cleanups.forEach(fn=>fn());assert.equal(observers[1].disconnected,true);
    } finally {globalThis.fetch=original;other.window.close();}
});

test('GIF 播放移除高清封面集并保留查询和魔法，停止恢复原图集', () => {
    const root=html('<img src="https://example.org/a.png?srcset=@2x#gif#200w" alt="动画">');
    M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false}}));const img=root.querySelector('img');
    assert.equal(img.srcset,'https://example.org/a@2x.png 2x');img.click();
    assert.equal(img.src,'https://example.org/a.gif?srcset=@2x#gif#200w');assert.equal(img.hasAttribute('srcset'),false);
    assert.equal(img.getAttribute('aria-pressed'),'true');
    img.dispatchEvent(new window.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));
    assert.equal(img.src,'https://example.org/a.png?srcset=@2x#gif#200w');assert.equal(img.srcset,'https://example.org/a@2x.png 2x');
    assert.equal(img.getAttribute('aria-pressed'),'false');
});

test('GIF 播放中切换明暗保留播放状态，停止恢复当前模式高清封面', () => {
    const root=html('<img src="https://example.org/a.png?darksrc=~&srcset=@2x&darksrcset=@2x#gif">');
    const wasDark=document.body.classList.contains('theme-dark');
    try {
        document.body.classList.remove('theme-dark');M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false}}));
        const img=root.querySelector('img');img.click();document.body.classList.add('theme-dark');M.applyColorScheme(root);
        assert.match(img.src,/a~dark\.gif#gif$/);assert.equal(img.dataset.playing,'true');assert.equal(img.hasAttribute('srcset'),false);
        img.click();assert.match(img.src,/a~dark\.png#gif$/);assert.equal(img.srcset,'https://example.org/a~dark@2x.png 2x');
    } finally {document.body.classList.toggle('theme-dark',wasDark);}
});

test('GIF 键盘忽略重复键和组合键，明信片组合卸载不遗留焦点属性', () => {
    const root=html('<p><img src="https://example.org/a.png#gif#card" alt="动画卡片"></p>'),cleanups=[];
    M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false},registerCleanup:fn=>cleanups.push(fn)}));
    const img=root.querySelector('img');
    img.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true}));assert.equal(img.dataset.playing,'false');
    img.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));assert.equal(img.dataset.playing,'false');
    img.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(img.dataset.playing,'true');
    cleanups.forEach(fn=>fn());assert.equal(img.hasAttribute('tabindex'),false);assert.equal(img.hasAttribute('role'),false);assert.equal(img.hasAttribute('aria-pressed'),false);
    const src=img.src;img.click();assert.equal(img.src,src);
});

test('导出 GIF 控制自包含且不重复绑定，播放停止保留资源参数及高清集', () => {
    const other=new JSDOM('<img src="a.png?token=ok#gif#200w" srcset="a@2x.png 2x">',{runScripts:'outside-only'});
    try {
        other.window.eval(`(${M.installExportGifControls.toString()})(document)`);
        other.window.eval(`(${M.installExportGifControls.toString()})(document)`);
        const img=other.window.document.querySelector('img');img.click();
        assert.equal(img.getAttribute('src'),'a.gif?token=ok#gif#200w');assert.equal(img.hasAttribute('srcset'),false);
        img.dispatchEvent(new other.window.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));
        assert.equal(img.getAttribute('src'),'a.png?token=ok#gif#200w');assert.equal(img.srcset,'a@2x.png 2x');
    } finally {other.window.close();}
});

test('导出 GIF 播放中跟随运行时切换深色，停止恢复深色封面集', async () => {
    const other=new JSDOM('<img src="light.png#gif" srcset="light@2x.png 2x">');
    try {
        M.installExportGifControls(other.window.document);const img=other.window.document.querySelector('img');img.click();
        img.setAttribute('src','dark.png');img.setAttribute('srcset','dark@2x.png 2x');
        await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(img.getAttribute('src'),'dark.gif');assert.equal(img.hasAttribute('srcset'),false);assert.equal(img.dataset.playing,'true');
        img.click();assert.equal(img.getAttribute('src'),'dark.png');assert.equal(img.srcset,'dark@2x.png 2x');
    } finally {other.window.close();}
});

test('导出 GIF 无链接播放点击不再同时打开官方图片查看器', () => {
    const other=new JSDOM('<div><img src="a.png#gif"></div>');
    try {
        M.installExportGifControls(other.window.document);const img=other.window.document.querySelector('img');let opened=0;
        img.addEventListener('click',()=>opened++);img.parentElement.addEventListener('click',()=>opened++);
        img.click();assert.equal(img.dataset.playing,'true');assert.equal(opened,0);
    } finally {other.window.close();}
});

test('导出页面从缓存恢复后继续同步 GIF 封面与高清图片集', async () => {
    const other=new JSDOM('<img src="light.png#gif" srcset="light@2x.png 2x">');
    try {
        const win=other.window,img=win.document.querySelector('img');M.installExportGifControls(win.document);img.click();
        win.dispatchEvent(new win.PageTransitionEvent('pagehide',{persisted:true}));
        img.setAttribute('src','dark.png');img.setAttribute('srcset','dark@2x.png 2x');
        win.dispatchEvent(new win.PageTransitionEvent('pageshow',{persisted:true}));
        await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(img.getAttribute('src'),'dark.gif');assert.equal(img.hasAttribute('srcset'),false);
        img.setAttribute('src','second.png');img.setAttribute('srcset','second@2x.png 2x');
        await new Promise(resolve=>setTimeout(resolve,0));assert.equal(img.getAttribute('src'),'second.gif');
        win.dispatchEvent(new win.PageTransitionEvent('pagehide',{persisted:true}));
        win.dispatchEvent(new win.PageTransitionEvent('pageshow',{persisted:true}));
        img.click();assert.equal(img.getAttribute('src'),'second.png');assert.equal(img.srcset,'second@2x.png 2x');
    } finally {other.window.close();}
});

test('深色替换图片保留原版式魔法，明确指定的深色片段优先', () => {
    const wasDark=document.body.classList.contains('theme-dark');
    try {
        document.body.classList.add('theme-dark');
        const root=html('<img src="https://example.org/a.png?darksrc=~#logo#200w#180deg"><img src="https://example.org/b.png?darksrc=dark.png%23icon#logo">');
        M.renderSection(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:false}}));
        const imgs=root.querySelectorAll('img');
        assert.equal(imgs[0].src,'https://example.org/a~dark.png#logo#200w#180deg');
        assert.equal(imgs[1].src,'https://example.org/dark.png#icon');
        document.body.classList.remove('theme-dark');M.applyColorScheme(root);
        assert.match(imgs[0].src,/#logo#200w#180deg$/);
    } finally {document.body.classList.toggle('theme-dark',wasDark);}
});

test('导出将图片参数中的 Obsidian 深色与高清资源改为相对地址', () => {
    const dark='app://local/vault/pic/dark.png?456',set='app://local/vault/pic/light@2x.png@2x,app://local/vault/pic/light@3x.png@3x';
    const root=html(`<img src="app://local/vault/pic/light.png?123&amp;token=keep%2Braw&amp;darksrc=${encodeURIComponent(dark)}&amp;srcset=${encodeURIComponent(set)}#logo">`);
    M.appUrlsToRelative(root,'/vault','notes');
    const src=root.querySelector('img').getAttribute('src'),query=new URLSearchParams(src.split('#')[0].split('?')[1]);
    assert.equal(src.split('?')[0],'../pic/light.png');assert.equal(query.get('darksrc'),'../pic/dark.png');
    assert.equal(query.get('srcset'),'../pic/light%402x.png@2x,../pic/light%403x.png@3x');
    assert.match(src,/token=keep%2Braw/);assert.match(src,/#logo$/);assert.doesNotMatch(src,/app%3A/i);
});

test('导出深色高清参数转换幂等，远程及库外资源不改写', () => {
    const darkset='app://local/vault/pic/dark@2x.png@2x,https://example.org/dark@3x.png@3x';
    const outside='app://local/other/private.png';
    const root=html(`<img src="pic/light.png?darksrcset=${encodeURIComponent(darkset)}&amp;darksrc=${encodeURIComponent(outside)}&amp;other=keep+literal#200w">`);
    M.appUrlsToRelative(root,'/vault','notes');
    const src=root.querySelector('img').getAttribute('src'),query=new URLSearchParams(src.split('#')[0].split('?')[1]);
    assert.equal(query.get('darksrcset'),'../pic/dark%402x.png@2x,https://example.org/dark@3x.png@3x');
    assert.equal(query.get('darksrc'),outside);assert.match(src,/other=keep\+literal/);
    M.appUrlsToRelative(root,'/vault','notes');assert.equal(root.querySelector('img').getAttribute('src'),src);
});

test('迷你音频不响应组合键或输入法组合，普通按键可播放', () => {
    const root=html('<img src="a.mp3?controls=mini">');M.processMedia(root,ctx());
    const audio=root.querySelector('audio'),button=root.querySelector('.v-audio-mini-control');let played=0;
    audio.play=async()=>{played++};audio.dispatchEvent(new window.Event('canplay'));
    for(const options of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{isComposing:true},{repeat:true}]){
        const key=new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...options});button.dispatchEvent(key);
    }
    assert.equal(played,0);
    button.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(played,1);
});

test('媒体播放器及持续时长直接创建在所属窗口文档', () => {
    const other=new JSDOM('<main><img src="a.mp3?controls=mini&amp;duration=true"><img src="v.mp4"></main>');
    const create=document.createElement;let mainCreated=0;
    document.createElement=function(...args){mainCreated++;return create.apply(this,args)};
    try {
        const root=other.window.document.querySelector('main');M.processMedia(root,ctx());
        const audio=root.querySelector('audio');Object.defineProperty(audio,'duration',{value:65});
        audio.dispatchEvent(new other.window.Event('canplay'));
        assert.equal(mainCreated,0);assert.equal(root.querySelector('.v-duration').textContent,'1′5″');
        assert.equal(root.querySelector('video').ownerDocument,other.window.document);
    } finally {document.createElement=create;other.window.close();}
});

test('迷你音频时长随元数据更新，不重复添加且重新加载清除旧值', () => {
    const root=html('<img src="a.mp3?controls=mini&amp;duration=true">');M.processMedia(root,ctx());const audio=root.querySelector('audio');let value=65;
    Object.defineProperty(audio,'duration',{get:()=>value});
    audio.dispatchEvent(new window.Event('canplay'));assert.equal(root.querySelector('.v-duration').textContent,'1′5″');
    const label=root.querySelector('.v-duration');value=125;audio.dispatchEvent(new window.Event('durationchange'));
    assert.equal(root.querySelectorAll('.v-duration').length,1);assert.equal(root.querySelector('.v-duration'),label);assert.equal(label.textContent,'2′5″');
    audio.dispatchEvent(new window.Event('loadstart'));assert.equal(root.querySelector('.v-duration'),null);assert.equal(audio.hasAttribute('data-duration'),false);
    value=10;audio.dispatchEvent(new window.Event('canplay'));assert.equal(root.querySelector('.v-duration').textContent,'10″');
    value=Infinity;audio.dispatchEvent(new window.Event('durationchange'));assert.equal(root.querySelector('.v-duration'),null);
});

test('迷你音频卸载清除自身时长，保留旁边内容且旧事件不重建', () => {
    const root=html('<img src="a.mp3?controls=mini&amp;duration=true"><sup class="v-duration">外部内容</sup>'),cleanups=[];
    M.processMedia(root,ctx({registerCleanup:fn=>cleanups.push(fn)}));const audio=root.querySelector('audio');audio.pause=()=>{};
    Object.defineProperty(audio,'duration',{value:65});audio.dispatchEvent(new window.Event('canplay'));
    assert.equal(root.querySelectorAll('.v-duration').length,2);cleanups.forEach(fn=>fn());
    assert.equal(root.querySelectorAll('.v-duration').length,1);assert.equal(root.querySelector('.v-duration').textContent,'外部内容');
    audio.dispatchEvent(new window.Event('durationchange'));assert.equal(root.querySelectorAll('.v-duration').length,1);
});

test('导出迷你音频访问增强支持延迟生成、键盘及媒体状态，自包含运行', async () => {
    const other=new JSDOM('<main></main>',{runScripts:'outside-only'});
    try {
        other.window.eval(`(${M.enhanceExportMiniAudio.toString()})(document)`);
        other.window.document.querySelector('main').innerHTML='<audio id="mini"></audio><div id="mini-control" class="v-audio-mini-control disabled" data-pause="true"></div>';
        await new Promise(resolve=>setTimeout(resolve,0));
        const audio=other.window.document.querySelector('audio'),ctl=other.window.document.querySelector('div');let clicks=0,paused=true;
        Object.defineProperty(audio,'paused',{get:()=>paused});ctl.addEventListener('click',()=>clicks++);
        assert.equal(ctl.getAttribute('role'),'button');assert.equal(ctl.tabIndex,0);assert.equal(ctl.getAttribute('aria-disabled'),'true');
        ctl.classList.remove('disabled');await new Promise(resolve=>setTimeout(resolve,0));
        ctl.dispatchEvent(new other.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(clicks,1);
        ctl.dispatchEvent(new other.window.KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));assert.equal(clicks,1);
        paused=false;audio.dispatchEvent(new other.window.Event('playing'));assert.equal(ctl.getAttribute('aria-label'),'暂停音频');assert.equal(ctl.getAttribute('aria-pressed'),'true');
        paused=true;audio.dispatchEvent(new other.window.Event('pause'));assert.equal(ctl.getAttribute('aria-pressed'),'false');
    } finally {other.window.close();}
});

test('媒体处理保留代码及 SVG 内图片，仅转换正文音频', () => {
    const root=html('<pre><code><img src="example.mp3?controls=mini"></code></pre><svg><foreignObject><div><img src="diagram.mp3?controls=mini"></div></foreignObject></svg><p><img src="real.mp3?controls=mini"></p>');
    const code=root.querySelector('code').innerHTML,svg=root.querySelector('svg').innerHTML;
    M.processMedia(root,ctx());
    assert.equal(root.querySelector('code').innerHTML,code);assert.equal(root.querySelector('svg').innerHTML,svg);
    assert.equal(root.querySelectorAll('audio').length,1);assert.match(root.querySelector('audio').src,/real.mp3/);
});

test('图片魔法保留字面区域及原生媒体示例，但 kbd 图标仍支持', () => {
    const root=html('<pre><code><img src="literal.png?darksrc=invert#gif"><audio src="example.mp3"></audio></code></pre><svg><foreignObject><div><img src="graphic.png?darksrc=invert#card"></div></foreignObject></svg><p><kbd><img src="icon.png?darksrc=invert#icon"></kbd></p>');
    const code=root.querySelector('code').innerHTML,svg=root.querySelector('svg').innerHTML;
    M.processImages(root,ctx({settings:{...M.DEFAULT_SETTINGS,captions:true}}));
    assert.equal(root.querySelector('code').innerHTML,code);assert.equal(root.querySelector('svg').innerHTML,svg);
    const icon=root.querySelector('kbd img');assert.equal(icon.dataset.darksrc,'invert');assert.equal(icon.closest('.v-cap-cntr'),null);
});

test('导出 GIF 与音频访问增强不改写代码示例中的控件', () => {
    const other=new JSDOM('<pre><code><img src="a.png#gif"><audio id="example"></audio><div id="example-control" class="v-audio-mini-control"></div></code></pre>');
    try {
        const code=other.window.document.querySelector('code'),before=code.innerHTML;
        M.installExportGifControls(other.window.document);M.enhanceExportMiniAudio(other.window.document);
        assert.equal(code.innerHTML,before);
    } finally {other.window.close();}
});

test('多文档样式与图标同步，新增窗口获得当前配色且重复附加不重复节点', () => {
    const one=new JSDOM('<p>主窗口</p>'),two=new JSDOM('<p>弹出窗口</p>'),assets=new M.DocumentAssets('<svg id="test-icon"></svg>');
    try {
        assets.attach(one.window.document);assets.setStyle('blue','p { color: rgb(1, 2, 3); }');assets.attach(two.window.document);assets.attach(two.window.document);
        for(const doc of [one.window.document,two.window.document]){
            assert.equal(doc.querySelectorAll('.vlook-icon-sprite').length,1);assert.equal(doc.querySelectorAll('#vlook-theme-style').length,1);
            assert.equal(doc.querySelector('#vlook-theme-style').dataset.theme,'blue');assert.ok(doc.querySelector('#test-icon'));
            assert.equal(doc.defaultView.getComputedStyle(doc.querySelector('p')).color,'rgb(1, 2, 3)');
        }
        assets.setStyle('geek','p { color: rgb(4, 5, 6); }');assert.equal(two.window.getComputedStyle(two.window.document.querySelector('p')).color,'rgb(4, 5, 6)');
        assets.setStyle(null);assert.equal(two.window.document.querySelector('style'),null);assert.ok(two.window.document.querySelector('#test-icon'));
    } finally {assets.dispose();one.window.close();two.window.close();}
});

test('多文档资源关闭和卸载仅清理自身节点，不移除已有启用标记', () => {
    const one=new JSDOM('<body class="vlook-enabled"><style id="other">p{color:red}</style></body>'),two=new JSDOM('<p>弹出</p>'),assets=new M.DocumentAssets('<svg/>');
    try {
        assets.attach(one.window.document);assets.attach(two.window.document);assets.setStyle('blue','p{color:blue}');assets.detach(two.window.document);
        assert.equal(two.window.document.querySelector('.vlook-icon-sprite'),null);assert.equal(two.window.document.body.classList.contains('vlook-enabled'),false);
        assets.dispose();assert.ok(one.window.document.querySelector('#other'));assert.equal(one.window.document.body.classList.contains('vlook-enabled'),true);
        assets.attach(two.window.document);assets.setStyle('geek','p{color:green}');assert.equal(two.window.document.querySelector('style'),null);
    } finally {assets.dispose();one.window.close();two.window.close();}
});

test('弹出文档未就绪时延迟安装，关闭后不因迟到就绪事件重新注入', () => {
    const one=new JSDOM('<p>窗口</p>'),two=new JSDOM('<p>关闭窗口</p>'),assets=new M.DocumentAssets('<svg id="ready-icon"/>');
    try {
        for(const doc of [one.window.document,two.window.document])doc.body.remove();
        assets.attach(one.window.document);assets.attach(two.window.document);assets.setStyle('blue','p{color:blue}');assets.detach(two.window.document);
        for(const win of [one.window,two.window]){win.document.documentElement.append(win.document.createElement('body'));win.document.dispatchEvent(new win.Event('DOMContentLoaded'));}
        assert.ok(one.window.document.querySelector('#ready-icon'));assert.equal(one.window.document.querySelector('style').dataset.theme,'blue');
        assert.equal(two.window.document.querySelector('#ready-icon'),null);assert.equal(two.window.document.querySelector('style'),null);
    } finally {assets.dispose();one.window.close();two.window.close();}
});

test('主题变量由元素所属窗口读取，保留去引号及空值处理', () => {
    const other=new JSDOM('<body style="--vlook-query: capnum=off; --vlook-header-autonum: &quot;h1{{###. }}&quot;"></body>');
    const original=globalThis.getComputedStyle;globalThis.getComputedStyle=()=>{throw new Error('不得调用主窗口样式读取')};
    try {
        assert.equal(M.readCssVar('--vlook-query',other.window.document.body),'capnum=off');
        assert.equal(M.readCssVar('--vlook-header-autonum',other.window.document.body),'h1{{###. }}');
        assert.equal(M.readCssVar('--absent',other.window.document.body),'');
    } finally {globalThis.getComputedStyle=original;other.window.close();}
});

test('实时预览区块直接使用编辑器所属文档，并按该窗口题注配置渲染', async () => {
    const other=new JSDOM('<main></main>');other.window.document.body.style.setProperty('--vlook-query','capnum=off');
    const original=M.MarkdownRenderer.render;let widget,dom;
    M.MarkdownRenderer.render=async(_app,source,el)=>{el.innerHTML=source.includes('| A |')?'<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>':'<p><em><mark>示例</mark></em></p>'};
    try {
        const field=M.blockPreviewExtension({settings:{...M.DEFAULT_SETTINGS},app:{}}),doc='前言\n\n*==示例==*\n\n| A |\n| - |\n| B |';
        const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});
        state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)widget=deco.spec.widget});
        dom=widget.toDOM({dom:other.window.document.querySelector('main'),requestMeasure(){},dispatch(){},focus(){}});
        assert.equal(dom.ownerDocument,other.window.document);
        await new Promise(resolve=>setTimeout(resolve,0));
        const caption=dom.querySelector('.v-cap-1');assert.ok(caption);assert.match(caption.textContent,/示例/);assert.doesNotMatch(caption.textContent,/\d/);
        assert.equal(dom.ownerDocument,other.window.document);
    } finally {if(dom)widget.destroy(dom);M.MarkdownRenderer.render=original;other.window.close();}
});

test('行内 Widget 在所属编辑器文档构建，并读取窗口标签与刮刮卡配置', () => {
    const other=new JSDOM('<main></main>',{pretendToBeVisual:true});other.window.document.body.style.setProperty('--vlook-query','tag=rd&coating=gn');
    const plugin={settings:{...M.DEFAULT_SETTINGS},app:{workspace:{getActiveFile:()=>({path:'test.md'})}}};
    try {
        const field=M.livePreviewExtension(plugin),doc='前言\n\n*`标签`* **==120==** 字_^zì^_ *提示**答案***';
        const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]}),widgets=[];
        state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)widgets.push(deco.spec.widget)});
        const host=other.window.document.querySelector('main');let frames=0;other.window.requestAnimationFrame=()=>{frames++;return 1};
        for(const widget of widgets){const dom=widget.toDOM({dom:host});assert.equal(dom.ownerDocument,other.window.document);host.append(dom);}
        assert.ok(host.querySelector('.v-tag.rd'));assert.equal(frames,1);assert.ok(host.querySelector('ruby rt'));
        const scratch=host.querySelector('.v-coating')||host.querySelector('[aria-expanded]');assert.ok(scratch);assert.match(scratch.getAttribute('style')||'',/--ac-gn/);
    } finally {other.window.close();}
});

test('行内 Widget 笔记 YAML 配置优先于所在窗口主题查询', () => {
    const other=new JSDOM('<main></main>');other.window.document.body.style.setProperty('--vlook-query','tag=rd');
    const plugin={settings:{...M.DEFAULT_SETTINGS},app:{workspace:{getActiveFile:()=>({path:'test.md'})}}};
    try {
        const field=M.livePreviewExtension(plugin),doc='---\nvlook-query: tag=bu\n---\n\n前言\n\n*`标签`*';
        const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});let widget;
        state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)widget=deco.spec.widget});
        const dom=widget.toDOM({dom:other.window.document.querySelector('main')});assert.ok(dom.querySelector('.v-tag.bu'));assert.equal(dom.querySelector('.v-tag.rd'),null);
    } finally {other.window.close();}
});

test('行内配置变化后不把旧 Widget 复用为同一显示', () => {
    const plugin={settings:{...M.DEFAULT_SETTINGS},app:{workspace:{getActiveFile:()=>({path:'test.md'})}}},field=M.livePreviewExtension(plugin);
    const make=color=>{
        const doc=`---\nvlook-query: tag=${color}\n---\n\n前言\n\n*\`标签\`*`;
        const state=M.EditorState.create({doc,extensions:[M.editorInfoField,M.editorLivePreviewField,field]});let widget;
        state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.widget)widget=deco.spec.widget});return widget;
    };
    const first=make('bu'),same=make('bu'),changed=make('rd');assert.equal(first.eq(same),true);assert.equal(first.eq(changed),false);
    plugin.settings.tagDefault='gn';assert.equal(changed.eq(make('rd')),false);
});

test('主题刷新事务不改正文选区，但使行内及块级 Widget 失效', () => {
    const plugin={settings:{...M.DEFAULT_SETTINGS},app:{workspace:{getActiveFile:()=>({path:'test.md'})}}};
    const source='前言\n\n*`标签`*\n\n> 引用内容';
    const inline=M.livePreviewExtension(plugin),block=M.blockPreviewExtension(plugin);
    const first=M.EditorState.create({doc:source,extensions:[M.editorInfoField,M.editorLivePreviewField,M.editorThemeRevision,inline,block]});
    const next=first.update({effects:M.editorThemeRefreshEffect.of(7)}).state;
    assert.equal(next.doc.toString(),source);assert.equal(next.selection.eq(first.selection),true);
    for(const field of [inline,block]){
        let oldWidget,newWidget;first.field(field).between(0,first.doc.length,(_a,_b,d)=>{if(d.spec.widget)oldWidget=d.spec.widget});
        next.field(field).between(0,next.doc.length,(_a,_b,d)=>{if(d.spec.widget)newWidget=d.spec.widget});
        assert.ok(oldWidget&&newWidget);assert.equal(oldWidget.eq(newWidget),false);
    }
});

test('编辑器刷新合并重复请求，卸载或已移除实例不接收迟到事务', async () => {
    const owner=new M.EditorThemeRefresh(),calls=[],view={dispatch:tr=>calls.push(tr)};
    const detach=owner.attach(view);owner.refresh();owner.refresh();await Promise.resolve();assert.equal(calls.length,1);
    owner.refresh();detach();await Promise.resolve();assert.equal(calls.length,1);
    owner.attach(view);owner.dispose();await Promise.resolve();assert.equal(calls.length,1);
});

test('编辑器刷新携带各自窗口的主题配置，不借用主窗口变量', async () => {
    const one=new JSDOM('<main></main>'),two=new JSDOM('<main></main>'),owner=new M.EditorThemeRefresh(),received=[];
    one.window.document.body.style.setProperty('--vlook-query','capnum=off');two.window.document.body.style.setProperty('--vlook-query','unpub=off');
    try {
        for(const win of [one.window,two.window])owner.attach({dom:win.document.querySelector('main'),dispatch:tr=>received.push(tr.effects.find(effect=>effect.is(M.editorThemeConfigEffect)).value)});
        await Promise.resolve();assert.deepEqual(received.map(value=>value.query),['capnum=off','unpub=off']);
    } finally {owner.dispose();one.window.close();two.window.close();}
});

test('源码行标题编号及不发布装饰跟随编辑器主题配置事务', () => {
    const plugin={settings:{...M.DEFAULT_SETTINGS},app:{}},field=M.blockPreviewExtension(plugin);
    const source='前言\n\n# 第一\n\n## 第二\n\n## ~~隐藏~~';
    const initial=M.EditorState.create({doc:source,extensions:[M.editorInfoField,M.editorLivePreviewField,M.editorThemeConfigField,field]});
    const first=initial.update({effects:M.editorThemeConfigEffect.of({query:'',headerTemplate:'h1{{###. }},h2{{### }}'})}).state;
    const attrs=state=>{const result=[];state.field(field).between(0,state.doc.length,(_a,_b,deco)=>{if(deco.spec.attributes)result.push(deco.spec.attributes)});return result};
    assert.ok(attrs(first).some(value=>value['data-vlook-header-num']));assert.ok(attrs(first).some(value=>value.class==='vlook-unpub'));
    const next=first.update({effects:M.editorThemeConfigEffect.of({query:'unpub=off',headerTemplate:'h1{{#none#}},h2{{#none#}}'})}).state;
    assert.equal(attrs(next).some(value=>value['data-vlook-header-num']),false);assert.equal(attrs(next).some(value=>value.class==='vlook-unpub'),false);
    assert.equal(next.doc.toString(),source);
});

test('导航列表按笔记所在窗口读取编号模板，YAML 仍可覆盖', () => {
    const other=new JSDOM('<main></main>');other.window.document.body.style.setProperty('--vlook-header-autonum','h1{{###. }},h2{{### }}');
    try {
        let source='# 第一\n\n## 第二';const view={contentEl:other.window.document.querySelector('main'),editor:{getValue:()=>source}};
        assert.match(M.navigationForView(view,M.DEFAULT_SETTINGS).find(item=>item.title.includes('第二')).title,/1\.1/);
        source='---\nvlook-header-autonum: h1{{#none#}},h2{{#none#}}\n---\n\n# 第一\n\n## 第二';
        assert.equal(M.navigationForView(view,M.DEFAULT_SETTINGS).find(item=>item.title.includes('第二')).title,'第二');
    } finally {other.window.close();}
});

test('原生演示按所属窗口不发布配置保留章节，并在同文档创建对话框', async () => {
    const other=new JSDOM('<main><div class="markdown-preview-view"></div></main>',{pretendToBeVisual:true});
    other.window.document.body.style.setProperty('--vlook-query','unpub=off');
    const proto=other.window.HTMLDialogElement.prototype;proto.showModal=function(){this.open=true};proto.close=function(){this.open=false;this.dispatchEvent(new other.window.Event('close'))};
    const source='# 第一\n\n正文\n\n# ~~内部~~\n\n隐藏正文',content=other.window.document.querySelector('main');
    const view={file:{path:'slides.md'},contentEl:content,getMode:()=> 'preview',editor:{getValue:()=>source}},bus={on:()=>({}),offref(){}};
    const slides=new M.NativeSlides({app:{workspace:{...bus,getActiveViewOfType:()=>view},vault:bus},settings:{...M.DEFAULT_SETTINGS}});
    try {
        slides.toggle();await new Promise(resolve=>setTimeout(resolve,0));
        const dialog=other.window.document.querySelector('.vlook-native-slides');assert.ok(dialog);assert.equal(dialog.ownerDocument,other.window.document);
        assert.ok(Array.from(dialog.querySelectorAll('.vlook-dropdown-option')).some(option=>option.textContent.includes('内部')));
    } finally {slides.close();other.window.close();}
});

test('完整 HTML 构建在指定宿主文档离屏渲染并跟随其明暗模式', async () => {
    const other=new JSDOM('<body class="theme-dark"></body>',{pretendToBeVisual:true});
    const original=M.MarkdownRenderer.render;let owner;
    M.MarkdownRenderer.render=async(_app,_source,el)=>{owner=el.ownerDocument;el.innerHTML='<p>正文</p>'};
    const plugin={app:{vault:{cachedRead:async()=> '正文',adapter:{basePath:'/vault'}},metadataCache:{}},settings:{...M.DEFAULT_SETTINGS},rawRenderDepth:0,resolvePreviewTheme:()=> 'blue',readThemeCss:async()=>null};
    const file={path:'note.md',basename:'note',parent:{path:'/'}};
    try {
        const result=await M.buildVlookHtml(plugin,file,{mode:'preview',document:other.window.document});
        assert.equal(owner,other.window.document);assert.match(result.html,/setItem\("color-scheme","dark"\)/);assert.match(result.html,/正文/);
        assert.equal(other.window.document.querySelector('.vlook-offscreen'),null);assert.equal(plugin.rawRenderDepth,0);
        const print=await M.buildVlookHtml(plugin,file,{mode:'preview',print:true,document:other.window.document});
        assert.match(print.html,/setItem\("color-scheme","light"\)/);
    } finally {M.MarkdownRenderer.render=original;other.window.close();}
});

test('HTML 导出按宿主窗口 unpub 默认值过滤，失败时清理离屏容器', async () => {
    const other=new JSDOM('<body style="--vlook-query: unpub=off"></body>',{pretendToBeVisual:true});
    const original=M.MarkdownRenderer.render;
    const plugin={app:{vault:{cachedRead:async()=> '# ~~内部~~\n\n内部正文',adapter:{basePath:'/vault'}},metadataCache:{}},settings:{...M.DEFAULT_SETTINGS},rawRenderDepth:0,resolvePreviewTheme:()=> 'blue',readThemeCss:async()=>null};
    const file={path:'note.md',basename:'note',parent:{path:'/'}};
    try {
        M.MarkdownRenderer.render=async(_app,_source,el)=>{el.innerHTML='<h1><del>内部</del></h1><p>内部正文</p>'};
        const kept=await M.buildVlookHtml(plugin,file,{mode:'export',document:other.window.document});assert.match(kept.html,/内部正文/);
        other.window.document.body.style.removeProperty('--vlook-query');
        const hidden=await M.buildVlookHtml(plugin,file,{mode:'export',document:other.window.document});assert.doesNotMatch(hidden.html,/内部正文/);
        M.MarkdownRenderer.render=async()=>{throw Error('渲染失败样例')};
        await assert.rejects(M.buildVlookHtml(plugin,file,{mode:'export',document:other.window.document}),/渲染失败样例/);
        assert.equal(other.window.document.querySelector('.vlook-offscreen'),null);assert.equal(plugin.rawRenderDepth,0);
    } finally {M.MarkdownRenderer.render=original;other.window.close();}
});

test('全文索引支持标准 YAML 多行查询、注释与不发布章节列表', () => {
    const source='---\nvlook-query: >-\n  capnum=off&capgroup=off\nvlook-unpub:\n  - 内部\n  - "/^草稿/"\ntitle: "示例: 标题" # 说明\n---\n\n# 公开\n\n## 内部\n\n内部正文\n\n## 草稿一\n\n草稿正文';
    const index=M.getSourceIndex(source,{captionGroup:true,captionNumber:true});
    assert.equal(index.frontmatter['vlook-query'],'capnum=off&capgroup=off');assert.equal(index.frontmatter.title,'示例: 标题');
    assert.equal(index.blocks.find(block=>block.text==='内部正文').unpub,true);assert.equal(index.blocks.find(block=>block.text==='草稿正文').unpub,true);
});

test('全文索引保留 YAML 字符串转义，非法 YAML 不局部猜测配置', () => {
    const source='---\ntitle: "引号 \\"示例\\""\nvlook-query: "capnum=off"\n---\n\n正文';
    const index=M.getSourceIndex(source,{captionGroup:true,captionNumber:true});assert.equal(index.frontmatter.title,'引号 "示例"');
    const invalid=M.getSourceIndex('---\nvlook-query: [broken\n---\n\n正文',{captionGroup:true,captionNumber:true});assert.equal(invalid.frontmatter['vlook-query'],undefined);
});

test('多行 YAML 查询的格式空白不影响开关，编码空格不被裁剪', () => {
    const query=new M.Query('capnum=on','\n capnum=off &\n capgroup=off\n & label=%20value%20 \n');
    assert.equal(query.get('capnum'),'off');assert.equal(query.get('capgroup'),'off');assert.equal(query.get('label'),' value ');
    const source='---\nvlook-query: >\n  capnum=off&\n  capgroup=off&\n  unpub=off\n---\n\n# 公开\n\n## ~~内部~~\n\n内部正文\n\n*==示例==*\n\n| A |\n| - |\n| B |';
    const index=M.getSourceIndex(source,{captionGroup:true,captionNumber:true});
    assert.equal(index.blocks.find(block=>block.text==='内部正文').unpub,undefined);
    assert.equal(index.blocks.find(block=>block.type==='table').caption.num,'');
});

test('完整预览将 YAML 章节列表序列化为官方运行时的分号格式', async () => {
    const original=M.MarkdownRenderer.render;
    const source='---\nvlook-unpub:\n  - 内部\n  - "/^草稿/"\nvlook-header-dup: [重复甲, 重复乙]\nvlook-query: >\n  capnum=off&\n  capgroup=off\n---\n\n正文';
    const plugin={app:{vault:{cachedRead:async()=>source,adapter:{basePath:'/vault'}},metadataCache:{}},settings:{...M.DEFAULT_SETTINGS},rawRenderDepth:0,resolvePreviewTheme:()=> 'blue',readThemeCss:async()=>null};
    try {
        M.MarkdownRenderer.render=async(_app,_source,el)=>{el.innerHTML='<p>正文</p>'};
        const result=await M.buildVlookHtml(plugin,{path:'note.md',basename:'note',parent:{path:'/'}},{mode:'preview'});
        const parsed=new window.DOMParser().parseFromString(result.html,'text/html');
        assert.equal(parsed.querySelector('meta[name="vlook-unpub"]').content,'内部;/^草稿/');
        assert.equal(parsed.querySelector('meta[name="vlook-header-dup"]').content,'重复甲;重复乙');
        assert.equal(parsed.querySelector('meta[name="vlook-query"]').content,'capnum=off&capgroup=off');
    } finally {M.MarkdownRenderer.render=original;}
});

test('源码索引与原版查询一致，开关值忽略大小写并解码 URL', () => {
    for(const value of ['OFF','Off','%4f%46%46']) {
        const source=`---\nvlook-query: capnum=${value}&capgroup=${value}&unpub=${value}\n---\n\n# 公开\n\n## ~~内部~~\n\n内部正文\n\n*==示例==*\n\n| A |\n| - |\n| B |`;
        const query=new M.Query('',`capnum=${value}&capgroup=${value}&unpub=${value}`);
        assert.equal(query.get('unpub'),'off');
        const index=M.getSourceIndex(source,{captionGroup:true,captionNumber:true});
        assert.equal(index.blocks.find(block=>block.text==='内部正文').unpub,undefined);
        assert.equal(index.blocks.find(block=>block.type==='table').caption.num,'');
    }
});

test('迷你音频在尚未挂载的阅读区块反馈播放拒绝，卸载后拒绝不再修改状态', async () => {
    const cleanups=[];
    const root=html('<img src="song.mp3?controls=mini">');
    M.processMedia(root,ctx({registerCleanup:fn=>cleanups.push(fn)}));
    const audio=root.querySelector('audio'),button=root.querySelector('.v-audio-mini-control');
    assert.equal(root.isConnected,false);
    audio.pause=()=>{};
    audio.dispatchEvent(new window.Event('canplay'));
    let rejectPlay;
    audio.play=()=>new Promise((_resolve,reject)=>{rejectPlay=reject});
    button.click();rejectPlay(new Error('播放被拒绝'));await Promise.resolve();
    assert.equal(button.getAttribute('aria-label'),'无法播放音频，请重试');
    button.click();cleanups.forEach(fn=>fn());rejectPlay(new Error('卸载后的旧请求'));await Promise.resolve();
    assert.equal(button.dataset.vlookAudioState,'unloaded');
    assert.equal(button.getAttribute('aria-label'),'播放器已卸载');
    assert.equal(button.getAttribute('aria-disabled'),'true');
});

test('完整预览失去来源文档时使在途构建失效，并清理旧 iframe 资源', async () => {
    const original=M.MarkdownRenderer.render;let release;
    const source='公开内容';
    const plugin={app:{vault:{cachedRead:()=>new Promise(resolve=>{release=resolve}),adapter:{basePath:'/vault'}},metadataCache:{}},settings:{...M.DEFAULT_SETTINGS},rawRenderDepth:0,resolvePreviewTheme:()=> 'blue',readThemeCss:async()=>null};
    const view=Object.create(M.VlookPreviewView.prototype),content=html('旧内容');
    content.setText=text=>{content.textContent=text};content.empty=()=>{content.textContent=''};
    Object.assign(view,{plugin,contentEl:content,seq:0,frame:null,frameCleanups:[],printMode:false,leaf:{}});
    let file={path:'sample.md',basename:'sample',extension:'md'};view.getFile=()=>file;
    let cleaned=0;view.frameCleanups.push(()=>cleaned++);
    try {
        const pending=view.refresh();await Promise.resolve();
        file=null;await view.refresh();assert.equal(cleaned,1);assert.equal(content.textContent,'未找到文档');
        release(source);await pending;
        assert.equal(content.querySelector('iframe'),null);assert.equal(content.textContent,'未找到文档');assert.equal(view.frame,null);
    } finally {M.MarkdownRenderer.render=original;}
});

test('完整预览构建失败时释放原 iframe 并保留错误反馈', async () => {
    const plugin={app:{vault:{cachedRead:async()=>{throw Error('读取失败样例')}},metadataCache:{}},settings:{...M.DEFAULT_SETTINGS},rawRenderDepth:0};
    const view=Object.create(M.VlookPreviewView.prototype),content=html('<iframe></iframe>');content.setText=text=>{content.textContent=text};
    let cleaned=0;
    Object.assign(view,{plugin,contentEl:content,seq:0,frame:content.querySelector('iframe'),frameCleanups:[()=>cleaned++],printMode:false});
    view.getFile=()=>({path:'sample.md'});await view.refresh();
    assert.equal(cleaned,1);assert.equal(view.frame,null);assert.match(content.textContent,/读取失败样例/);assert.equal(content.querySelector('iframe'),null);
});

test('完整预览链接监听由 iframe 文档持有，关闭后旧文档点击不再触发导航', async () => {
    const {JSDOM}=await import('jsdom');
    const iframeDoc=new JSDOM('<a href="next.html#章节">本地</a><a href="https://example.org/guide">外链</a>');
    const owner=new JSDOM('<main></main>'),external=[],internal=[];
    owner.window.open=(...args)=>{external.push(args);return null};
    const view=Object.create(M.VlookPreviewView.prototype);
    Object.assign(view,{contentEl:owner.window.document.querySelector('main'),filePath:'current.md',printMode:false,frameCleanups:[],app:{metadataCache:{getFirstLinkpathDest:path=>path==='next.md'?{path:'next.md',extension:'md'}:null},workspace:{openLinkText:(...args)=>internal.push(args)}}});
    try {
        view.bindLinks({contentDocument:iframeDoc.window.document});
        const [local,remote]=iframeDoc.window.document.querySelectorAll('a');
        const click=el=>el.dispatchEvent(new iframeDoc.window.MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}));
        click(local);click(remote);
        assert.deepEqual(internal,[['next.md#章节','',true]]);
        assert.deepEqual(external,[['https://example.org/guide','_blank','noopener,noreferrer']]);
        view.disposeFrame();click(local);click(remote);
        assert.equal(internal.length,1);assert.equal(external.length,1);
        assert.equal(view.frameCleanups.length,0);
    } finally {iframeDoc.window.close();owner.window.close();}
});

test('文库 iframe 从本地切换到非库地址时撤销旧 srcdoc，迟到的本地构建不能覆盖', async () => {
    const {JSDOM}=await import('jsdom');const inner=new JSDOM('<iframe name="vlook-doc-lib" src="next.html" srcdoc="旧本地内容"></iframe>');
    const owner=html(''),view=Object.create(M.VlookPreviewView.prototype);let release;
    const app={metadataCache:{getFirstLinkpathDest:path=>path==='next.md'?{path:'next.md',extension:'md'}:null},vault:{cachedRead:()=>new Promise(resolve=>{release=resolve}),adapter:{basePath:'/vault'}},workspace:{}};
    const plugin={app,settings:{...M.DEFAULT_SETTINGS},rawRenderDepth:0,resolvePreviewTheme:()=> 'blue',readThemeCss:async()=>null};
    Object.assign(view,{app,plugin,contentEl:owner,filePath:'current.md',printMode:false,frameCleanups:[]});
    try {
        view.bindLinks({contentDocument:inner.window.document});
        const child=inner.window.document.querySelector('iframe');assert.equal(child.hasAttribute('srcdoc'),false);
        child.setAttribute('src','about:blank');await Promise.resolve();
        release('迟到的本地正文');await new Promise(resolve=>setTimeout(resolve,20));
        assert.equal(child.getAttribute('src'),'about:blank');assert.equal(child.hasAttribute('srcdoc'),false);
    } finally {view.disposeFrame();inner.window.close();}
});

test('媒体题注恢复排除字面区域，额外媒体不妨碍唯一目标恢复且不猜测同名目标', () => {
    const source='![配乐](song.mp3 "专属说明")';
    const root=html('<code><img src="example.mp3"></code><p><img src="song.mp3"></p>');
    M.processImages(root,withSource(source,0,{settings:{...M.DEFAULT_SETTINGS,captions:false}}));
    assert.equal(root.querySelector('code img').getAttribute('title'),null);
    assert.equal(root.querySelector('audio').title,'专属说明');
    assert.equal(root.querySelector('code audio'),null);
    const extra=html('<img src="other.mp3"><img src="song.mp3">');
    M.processImages(extra,withSource(source,0,{settings:{...M.DEFAULT_SETTINGS,captions:false}}));
    assert.deepEqual([...extra.querySelectorAll('audio')].map(el=>el.title),['','专属说明']);
    const ambiguous=html('<img src="a/song.mp3"><img src="b/song.mp3">');
    M.processImages(ambiguous,withSource(source,0,{settings:{...M.DEFAULT_SETTINGS,captions:false}}));
    assert.deepEqual([...ambiguous.querySelectorAll('audio')].map(el=>el.title),['','']);
});

test('图片等量但重排或被额外节点替换时不按位置误套参数', () => {
    const source='![甲](a.png#100w "甲说明") ![乙](b.png#200w "乙说明")';
    const reordered=html('<img src="b.png"><img src="a.png">');
    M.restoreImages(reordered,source,(_raw,current)=>current);
    assert.deepEqual([...reordered.querySelectorAll('img')].map(el=>[el.getAttribute('src'),el.title]),[['b.png#200w','乙说明'],['a.png#100w','甲说明']]);
    const replaced=html('<img src="unknown.png"><img src="b.png">');
    M.restoreImages(replaced,source,(_raw,current)=>current);
    assert.deepEqual([...replaced.querySelectorAll('img')].map(el=>[el.getAttribute('src'),el.title]),[['unknown.png',''],['b.png#200w','乙说明']]);
    const external=html('<img src="https://example.org/a.png">');
    M.restoreImages(external,'![本地](a.png#100w "本地图说明")',()=> 'wrong.png');
    assert.equal(external.firstElementChild.getAttribute('src'),'https://example.org/a.png');assert.equal(external.firstElementChild.title,'');
});

test('不同目录同名图片按明确路径恢复，渲染重排不互换题注和宽度', () => {
    const source='![甲](one/a.png#100w "甲说明") ![乙](two/a.png#200w "乙说明")';
    const root=html('<img src="app://resource/vault/two/a.png"><img src="app://resource/vault/one/a.png">');
    M.restoreImages(root,source,(_raw,current)=>current);
    assert.deepEqual([...root.querySelectorAll('img')].map(el=>[el.getAttribute('src'),el.title]),[['app://resource/vault/two/a.png#200w','乙说明'],['app://resource/vault/one/a.png#100w','甲说明']]);
    const partial=html('<img src="app://resource/vault/two/a.png"><img src="unknown.png">');
    M.restoreImages(partial,source,(_raw,current)=>current);
    assert.equal(partial.children[0].title,'乙说明');assert.equal(partial.children[1].title,'');
    const remote=html('<img src="https://example.org/two/a.png"><img src="unknown.png">');
    M.restoreImages(remote,source,(_raw,current)=>current);
    assert.equal(remote.children[0].title,'');assert.equal(remote.children[0].getAttribute('src'),'https://example.org/two/a.png');
});

test('预览导出图片恢复不改写代码、SVG 或公式内部节点，保留键帽图标与正文恢复', () => {
    const source='![正文](a.png#100w "正文说明") ![图标](icon.png#icon "图标说明")';
    const root=html('<code><img src="a.png"></code><pre><img src="a.png"></pre><svg><foreignObject><img xmlns="http://www.w3.org/1999/xhtml" src="a.png"></foreignObject></svg><mjx-container><img src="a.png"></mjx-container><p><img src="a.png"></p><kbd><img src="icon.png"></kbd>');
    const literal=[...root.querySelectorAll('code img,pre img,svg img,mjx-container img')];
    const before=literal.map(image=>image.outerHTML),calls=[];
    M.restoreImages(root,source,(raw,current)=>{calls.push(raw);return current});
    assert.deepEqual(literal.map(image=>image.outerHTML),before);
    assert.deepEqual(calls,['a.png#100w','icon.png#icon']);
    assert.equal(root.querySelector('p img').getAttribute('src'),'a.png#100w');
    assert.equal(root.querySelector('p img').title,'正文说明');
    assert.equal(root.querySelector('kbd img').getAttribute('src'),'icon.png#icon');
});

test('原始 HTML 图片源码候选排除字面容器，跨行和嵌套保留偏移及键帽图标', () => {
    const source='<pre>\n<code><img src="fake.png"></code>\n</pre>\n<svg><foreignObject><img src="svg.png"></foreignObject></svg>\n<code><img src="inline.png"></code>\n<kbd><img src="icon.png"></kbd>\n<img src="real.png" title="正文">';
    const refs=M.renderedSourceImages(source,document);
    assert.deepEqual(refs.map(ref=>ref.raw),['icon.png','real.png']);
    for(const ref of refs)assert.equal(source.slice(ref.pos,ref.end).startsWith('<img'),true);
    const markdown='`<code>` ![正文](real.png)';
    assert.deepEqual(M.renderedSourceImages(markdown,document).map(ref=>ref.raw),['real.png']);
});

test('HTML 媒体候选忽略代码、SVG、键帽与原始文本，正文媒体偏移不变', () => {
    const source='<pre><audio src="fake.mp3"></audio></pre>\n<code><img src="fake.mp4"></code>\n<svg><foreignObject><video src="svg.mp4"></video></foreignObject></svg>\n<kbd><audio src="key.mp3"></audio></kbd>\n<script>"<audio src=script.mp3>"</script>\n<!-- <video src="comment.mp4"> -->\n<audio src="real.mp3" alt="正文"></audio>';
    const refs=M.htmlMediaSources(source,document);
    assert.deepEqual(refs.map(ref=>[ref.tag,ref.alt]),[['audio','正文']]);
    assert.equal(refs[0].pos,source.indexOf('<audio src="real.mp3"'));
    const quoted='<div title="<code>"><audio src="real.mp3"></audio></div>';
    assert.equal(M.htmlMediaSources(quoted,document).length,1);
});

test('HTML 数学及 frontmatter 类容器与 DOM 隔离一致，内部同名标签关闭不泄漏候选', () => {
    const source='<div class="math"><div><img src="hidden.png"><audio src="hidden.mp3"></audio></div><img src="also-hidden.png"></div>\n<section class="frontmatter"><video src="hidden.mp4"></video></section>\n<div title="class=math"><img src="real.png"><audio src="real.mp3"></audio></div>';
    assert.deepEqual(M.renderedSourceImages(source,document).map(ref=>ref.raw),['real.png']);
    const media=M.htmlMediaSources(source,document);
    assert.deepEqual(media.map(ref=>ref.tag),['audio']);assert.equal(media[0].pos,source.indexOf('<audio src="real.mp3"'));
});

test('引用围栏与孤立反引号不吞掉后续正文图片，围栏内示例不参与候选', () => {
    const source='> ```html\n> ![代码图片](fake.png)\n> ```\n\n![正文](real.png)\n\n孤立的 ` 反引号\n\n![后续](later.png)\n\n`行内 ![代码](inline.png)`';
    assert.deepEqual(M.sourceImages(source).map(ref=>ref.raw),['real.png','later.png']);
    assert.deepEqual(M.renderedSourceImages(source,document).map(ref=>ref.raw),['real.png','later.png']);
});

test('原版四份示例文档的全文与逐块图片候选保持顺序、地址和题注一致', async () => {
    const {readFile}=await import('node:fs/promises');
    for(const name of ['guide','guide2','guide3','chart']){
        const source=await readFile(new URL(`../upstream/released/samples/${name}.md`,import.meta.url),'utf8');
        const index=M.getSourceIndex(source,{captionGroup:true,captionNumber:true});
        const blocks=index.blocks.filter(block=>!['code','frontmatter','mermaid'].includes(block.type));
        const expected=blocks.flatMap(block=>M.renderedSourceImages(block.text,document,source));
        const whole=M.renderedSourceImages(source,document);
        const values=refs=>refs.map(ref=>[ref.raw,ref.alt,ref.title]);
        assert.deepEqual(values(whole),values(expected),name);
    }
});

test('源码题注计数排除 HTML 字面容器内的真实标签及 Markdown 图像和音视频示例', () => {
    const source='<code>![假图](fake.png) ![假音频](fake.mp3)</code>\n<pre><img src="also-fake.png"><video src="fake.mp4"></video></pre>\n<div class="math">![公式内图](math.png) ![公式内音频](math.mp3)</div>\n\n![正文](real.png) ![配乐](real.mp3)';
    const block={type:'paragraph',text:source};
    assert.deepEqual(M.figureSources(block,source,document).map(ref=>ref.raw),['real.png']);
    assert.deepEqual(M.mediaSources(block,source,document,true).map(ref=>ref.alt),['配乐']);
});

test('原版四份示例音视频候选的全文和逐块扫描保持类型、题注与顺序一致', async () => {
    const {readFile}=await import('node:fs/promises');
    for(const name of ['guide','guide2','guide3','chart']){
        const source=await readFile(new URL(`../upstream/released/samples/${name}.md`,import.meta.url),'utf8');
        const index=M.getSourceIndex(source,{captionGroup:true,captionNumber:true});
        const expected=index.blocks.filter(block=>!['code','frontmatter','mermaid'].includes(block.type)).flatMap(block=>M.mediaSources(block,source,document,true));
        const whole=M.mediaSources({type:'paragraph',text:source},source,document,true);
        const values=refs=>refs.map(ref=>[ref.type,ref.native,ref.alt]);
        assert.deepEqual(values(whole),values(expected),name);
    }
});

test('原版四份示例插图候选的全文和逐块扫描保持地址、顺序及题注一致', async () => {
    const {readFile}=await import('node:fs/promises');
    for(const [name,count] of [['guide',39],['guide2',7],['guide3',5],['chart',0]]){
        const source=await readFile(new URL(`../upstream/released/samples/${name}.md`,import.meta.url),'utf8');
        const index=M.getSourceIndex(source,{captionGroup:true,captionNumber:true});
        const whole=M.figureSources({type:'paragraph',text:source},source,document);
        const blocks=index.blocks.flatMap(block=>M.figureSources(block,source,document));
        const values=refs=>refs.map(ref=>[ref.raw,ref.alt,ref.title]);
        assert.equal(whole.length,count,`${name}: 原版普通图片候选基准（不含 Mermaid）`);
        assert.deepEqual(values(whole),values(blocks),name);
    }
});

test('重复文档参数遵循原版最后指定覆盖，源码题注与不发布标记和阅读 Query 一致', () => {
    for(const query of ['capnum=on&capnum=off&unpub=on&unpub=off','capnum=off&capnum=on&unpub=off&unpub=on']){
        const source=`---\nvlook-query: ${query}\n---\n\n# ~~内部~~\n\n![插图](a.png)`;
        const parsed=new M.Query('',query),index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true});
        const image=index.blocks.find(block=>block.type==='image');
        assert.equal(image.caption.num==='',parsed.get('capnum')==='off');
        assert.equal(Boolean(image.unpub),parsed.get('unpub')!=='off');
    }
});

test('HTML 导出与原版运行时一致使用最后一个 xmd 文档扩展名', async () => {
    const original=M.MarkdownRenderer.render;
    const source='---\nvlook-query: xmd=html&xmd=md\nvlook-doc-lib: "[后续](target.html)"\n---\n\n[后续](target.html)';
    const app={vault:{cachedRead:async()=>source,adapter:{basePath:'/vault'}},metadataCache:{getFirstLinkpathDest:path=>path==='target.md'?{path:'target.md',extension:'md'}:null}};
    const plugin={app,settings:{...M.DEFAULT_SETTINGS},rawRenderDepth:0,resolvePreviewTheme:()=> 'blue',readThemeCss:async()=>null};
    try {
        M.MarkdownRenderer.render=async(_app,_source,el)=>{el.innerHTML='<p><a href="target.html">后续</a></p>'};
        const result=await M.buildVlookHtml(plugin,{path:'note.md',basename:'note',parent:{path:'/'}},{mode:'export'});
        const template=document.createElement('template');template.innerHTML=result.html;
        assert.equal(template.content.querySelector('a').getAttribute('href'),'target.md');
        assert.equal(template.content.querySelector('meta[name="vlook-doc-lib"]').getAttribute('content'),'[后续](target.md)');
    } finally {M.MarkdownRenderer.render=original;}
});

test('导出 xmd 读取主题默认值、YAML 覆盖并规范全局大小写，全局 off 禁止单链接改扩展名', async () => {
    const other=new JSDOM('<body style="--vlook-query: xmd=off"></body>');const original=M.MarkdownRenderer.render;
    let yaml='';
    const app={vault:{cachedRead:async()=>`---\nvlook-doc-lib: "[后续](target.md)"\n${yaml}---\n\n[后续](target.md)`,adapter:{basePath:'/vault'}},metadataCache:{getFirstLinkpathDest:path=>path==='target.md'?{path:'target.md',extension:'md'}:null}};
    const plugin={app,settings:{...M.DEFAULT_SETTINGS},rawRenderDepth:0,resolvePreviewTheme:()=> 'blue',readThemeCss:async()=>null};
    try {
        M.MarkdownRenderer.render=async(_app,_source,el)=>{el.innerHTML='<p><a href="target.md">默认</a><a href="target.md?xmd=pdf">单链接</a></p>'};
        const build=async()=>{
            const result=await M.buildVlookHtml(plugin,{path:'note.md',basename:'note',parent:{path:'/'}},{mode:'export',document:other.window.document});
            const template=other.window.document.createElement('template');template.innerHTML=result.html;return template.content;
        };
        const disabled=await build();
        assert.deepEqual([...disabled.querySelectorAll('a')].map(a=>a.getAttribute('href')),['target.md','target.md?xmd=pdf']);
        assert.equal(disabled.querySelector('meta[name="vlook-doc-lib"]').getAttribute('content'),'[后续](target.md)');
        yaml='vlook-query: xmd=HTML\n';const enabled=await build();
        assert.deepEqual([...enabled.querySelectorAll('a')].map(a=>a.getAttribute('href')),['target.html','target.pdf?xmd=pdf']);
        assert.equal(enabled.querySelector('meta[name="vlook-doc-lib"]').getAttribute('content'),'[后续](target.html)');
    } finally {M.MarkdownRenderer.render=original;other.window.close();}
});

test('预览主题仅选择内置配色，无效 YAML 不替换默认蓝色，缺少主题资源优先蓝色回退', async () => {
    M.setThemes([{id:'fancy',name:'Fancy',color:'#d7785b'}]);
    const original=M.MarkdownRenderer.render;let yaml='vlook-theme: [fancy]',assets=[];
    const plugin={app:{vault:{cachedRead:async()=>`---\n${yaml}\n---\n\n正文`,adapter:{basePath:'/vault'}},metadataCache:{}},settings:{...M.DEFAULT_SETTINGS},rawRenderDepth:0,resolvePreviewTheme:()=> 'blue',readThemeCss:async(name,part)=>{assets.push(`${part}/${name}`);return name==='blue'?'/* blue-marker */':null}};
    const file={path:'note.md',basename:'note',parent:{path:'/'}};
    try {
        M.MarkdownRenderer.render=async(_app,_source,el)=>{el.innerHTML='<p>正文</p>'};
        const invalid=await M.buildVlookHtml(plugin,file,{mode:'preview'});assert.match(invalid.html,/blue-marker/);assert.deepEqual(assets,['export/blue']);
        assets=[];yaml='vlook-theme: " FANCY "';
        const missing=await M.buildVlookHtml(plugin,file,{mode:'export'});assert.match(missing.html,/blue-marker/);assert.deepEqual(assets,['export/fancy','export/blue']);
        assets=[];await M.buildVlookHtml(plugin,file,{mode:'preview',theme:'../../missing'});
        assert.deepEqual(assets,['export/fancy','export/blue']);
    } finally {M.MarkdownRenderer.render=original;M.setThemes([]);}
});

test('预处理使用的宿主 unpub/xmd 默认值写入生成文档，显式主题和运行时保持同一结构配置', async () => {
    const other=new JSDOM('<body style="--vlook-query: unpub=OFF&xmd=MD&uico=solid"></body>');const original=M.MarkdownRenderer.render;let query='';
    const app={vault:{cachedRead:async()=>`---\nvlook-query: "${query}"\n---\n\n# ~~内部~~\n\n内部正文`,adapter:{basePath:'/vault'}},metadataCache:{getFirstLinkpathDest:path=>path==='target.md'?{path:'target.md',extension:'md'}:null}};
    const plugin={app,settings:{...M.DEFAULT_SETTINGS},rawRenderDepth:0,resolvePreviewTheme:()=> 'blue',readThemeCss:async()=>':root{--vlook-query:"unpub=on&xmd=html&uico=flat"}'};
    try {
        M.MarkdownRenderer.render=async(_app,_source,el)=>{el.innerHTML='<h1><del>内部</del></h1><p>内部正文</p><p><a href="target.md">后续</a></p>'};
        const build=async()=>{
            const result=await M.buildVlookHtml(plugin,{path:'note.md',basename:'note',parent:{path:'/'}},{mode:'export',theme:'fancy',document:other.window.document});
            const template=other.window.document.createElement('template');template.innerHTML=result.html;return template.content;
        };
        const kept=await build(),params=new URLSearchParams(kept.querySelector('meta[name="vlook-query"]').getAttribute('content'));
        assert.equal(params.get('unpub'),'off');assert.equal(params.get('xmd'),'md');assert.equal(params.has('uico'),false);
        assert.match(kept.querySelector('#write').textContent,/内部正文/);assert.equal(kept.querySelector('a[href="target.md"]').textContent,'后续');
        query='unpub=on&xmd=html';const hidden=await build();
        assert.doesNotMatch(hidden.querySelector('#write').textContent,/内部正文/);
        const overridden=new URLSearchParams(hidden.querySelector('meta[name="vlook-query"]').getAttribute('content'));
        assert.equal(overridden.get('unpub'),'on');assert.equal(overridden.get('xmd'),'html');
    } finally {M.MarkdownRenderer.render=original;other.window.close();}
});

test('旧 auto / none 一律回到默认 Ignorance，下一个配色从它开始', async () => {
    M.setThemes([{id:'fancy',name:'Fancy',color:'#d7785b'}]);
    assert.equal(M.resolveStyleName('auto'),'blue');assert.equal(M.resolveStyleName(undefined),'blue');assert.equal(M.resolveStyleName('none'),'blue');assert.equal(M.resolveStyleName(' FANCY '),'fancy');
    let saved=0;const plugin={settings:{style:'none'},saveSettings:async()=>{saved++}};
    const switcher=new M.ThemeSwitcher(plugin),status=html('');
    status.empty=()=>{status.textContent=''};status.createSpan=({text,cls})=>{const span=document.createElement('span');if(text)span.textContent=text;if(cls)span.className=cls;status.append(span);return span};
    switcher.statusEl=status;switcher.update();
    assert.equal(switcher.current(),'blue');assert.match(status.textContent,/VLOOK Ignorance/);
    await switcher.next();assert.equal(plugin.settings.style,'fancy');assert.equal(saved,1);
    M.setThemes([]);
});

test('配色菜单使用点击窗口的明暗状态，命令使用当前活动窗格而非主窗口', () => {
    const other=new JSDOM('<body class="theme-dark"></body>'),calls=[];
    const wasDark=document.body.classList.contains('theme-dark');document.body.classList.remove('theme-dark');
    const app={workspace:{activeLeaf:{view:{containerEl:document.body}}},changeTheme:value=>calls.push(value)};
    const switcher=new M.ThemeSwitcher({app,settings:{style:'blue'}});
    try {
        switcher.openMenu(new other.window.MouseEvent('click',{view:other.window}));
        const menu=M.Menu.instances.at(-1),toggle=menu.items.at(-1);
        assert.equal(toggle.title,'切换到浅色模式');toggle.callback();assert.deepEqual(calls,['moonstone']);
        document.body.classList.add('theme-dark');other.window.document.body.classList.remove('theme-dark');
        app.workspace.activeLeaf.view.containerEl=other.window.document.body;
        switcher.toggleDark();assert.deepEqual(calls,['moonstone','obsidian']);
    } finally {document.body.classList.toggle('theme-dark',wasDark);other.window.close();}
});

test('完整预览关闭后迟到刷新不再查询来源或重建内容', async () => {
    const view=Object.create(M.VlookPreviewView.prototype);let cleaned=0,reads=0;
    Object.assign(view,{seq:0,frame:{},frameCleanups:[()=>cleaned++]});
    view.getFile=()=>{reads++;throw Error('关闭后不应读取来源')};
    await view.onClose();await view.refresh();await view.refresh();
    assert.equal(reads,0);assert.equal(cleaned,1);assert.equal(view.frame,null);
});

test('完整预览移到另一文档后底部避让切换到新窗口状态栏并停止观察旧状态栏', async () => {
    const first=new JSDOM('<main></main><div class="status-bar"></div>'),second=new JSDOM('<main></main><div class="status-bar"></div>');
    const observed=[],unobserved=[],cleanups=[],events={};let disconnected=0;
    class Observer{observe(node){observed.push(node)}unobserve(node){unobserved.push(node)}disconnect(){disconnected++}}
    first.window.ResizeObserver=Observer;second.window.ResizeObserver=Observer;
    const content=first.window.document.querySelector('main'),oldBar=first.window.document.querySelector('.status-bar'),newBar=second.window.document.querySelector('.status-bar');
    content.addClass=(...classes)=>content.classList.add(...classes);
    content.getBoundingClientRect=()=>({left:0,right:800,top:0,bottom:600,height:600,width:800});
    oldBar.getBoundingClientRect=()=>({left:0,right:800,top:580,bottom:600,height:20,width:800});
    newBar.getBoundingClientRect=()=>({left:0,right:800,top:700,bottom:720,height:20,width:800});
    const view=Object.create(M.VlookPreviewView.prototype);
    Object.assign(view,{contentEl:content,plugin:{settings:{},resolvePreviewTheme:()=> 'blue'},app:{workspace:{on:(name,fn)=>{(events[name]??=[]).push(fn);return{};}},vault:{on:()=>({})}}});
    view.register=fn=>cleanups.push(fn);view.registerEvent=()=>{};view.addAction=()=>{};
    try {
        await view.onOpen();assert.equal(content.style.getPropertyValue('--vlook-preview-bottom-space'),'28px');
        second.window.document.body.append(second.window.document.adoptNode(content));
        events['layout-change'].forEach(fn=>fn());
        assert.equal(content.style.getPropertyValue('--vlook-preview-bottom-space'),'0px');
        assert.ok(observed.includes(oldBar));assert.ok(observed.includes(newBar));assert.ok(unobserved.includes(oldBar));
        cleanups.forEach(fn=>fn());assert.equal(disconnected,1);
    } finally {first.window.close();second.window.close();}
});

test('Pele 兼容路径只接管 ZenUML 围栏，保留原生流程图并加入 SVG 配色', async()=>{
    const root=html('<pre><code class="language-mermaid">zenuml\nAlice -&gt; Bob: Hello</code></pre><pre><code class="language-mermaid">flowchart LR\nA --&gt; B</code></pre>');
    const calls=[],cleanups=[];
    await M.renderZenUmlFallback(root,{register:fn=>cleanups.push(fn)},async()=>({renderToSvg:source=>{calls.push(source);return {svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><text class="message-label">Hello</text></svg>'}}}));
    assert.deepEqual(calls,['\nAlice -> Bob: Hello']);
    assert.equal(root.querySelectorAll('.mermaid svg.vlook-zenuml').length,1);
    assert.ok(root.querySelector('style[data-vlook-zenuml-palette]'));
    assert.equal(root.querySelector('code').textContent,'flowchart LR\nA --> B');
    cleanups.forEach(fn=>fn());
});

test('Pele ZenUML 异步加载期间卸载不会回写旧区块', async()=>{
    const root=html('<pre><code class="language-mermaid">zenuml\nAlice -&gt; Bob</code></pre>'),before=root.innerHTML,cleanups=[];let release;
    const task=M.renderZenUmlFallback(root,{register:fn=>cleanups.push(fn)},()=>new Promise(resolve=>{release=resolve}));
    cleanups.forEach(fn=>fn());release({renderToSvg:()=>{throw Error('卸载后不能渲染')}});await task;
    assert.equal(root.innerHTML,before);
});

test('Pele 已提前生成错误容器时按围栏源码恢复 ZenUML，普通图表 SVG 保持不变',async()=>{
    const root=html('<div class="mermaid">No diagram type detected</div><div class="mermaid"><svg id="native-flow"><text>原生</text></svg></div>');
    const source='> ```mermaid\n> zenuml\n> Alice -> Bob: Hello\n> ```\n\n```mermaid\nflowchart LR\nA --> B\n```',calls=[];
    await M.renderZenUmlFallback(root,{register(){}},async()=>({renderToSvg:text=>{calls.push(text);return {svg:'<svg xmlns="http://www.w3.org/2000/svg"><text>Hello</text></svg>'}}}),source);
    assert.deepEqual(calls,['\nAlice -> Bob: Hello']);assert.equal(root.querySelectorAll('svg').length,2);assert.ok(root.querySelector('#native-flow'));
});

test('ZenUML 加载期间源码节点变化时不写入旧图形',async()=>{
    const root=html('<pre><code class="language-mermaid">zenuml\nAlice -&gt; Bob: old</code></pre>');let release,drawn=0;
    const task=M.renderZenUmlFallback(root,{register(){}},()=>new Promise(resolve=>{release=resolve}));
    root.querySelector('code').textContent='flowchart LR\nA --> B';
    release({renderToSvg:()=>{drawn++;return {svg:'<svg></svg>'}}});await task;
    assert.equal(drawn,0);assert.match(root.textContent,/flowchart LR/);assert.equal(root.querySelector('svg'),null);
});

test('同一错误容器的新 ZenUML 请求使先返回的旧请求失效',async()=>{
    const root=html('<div class="mermaid">native error</div>');let oldRelease,newRelease;
    const lifecycle={register(){}};
    const old=M.renderZenUmlFallback(root,lifecycle,()=>new Promise(resolve=>{oldRelease=resolve}),'```mermaid\nzenuml\nAlice -> Bob: old\n```');
    const next=M.renderZenUmlFallback(root,lifecycle,()=>new Promise(resolve=>{newRelease=resolve}),'```mermaid\nzenuml\nAlice -> Bob: new\n```');
    oldRelease({renderToSvg:()=>{throw Error('旧请求不能渲染')}});await old;
    assert.equal(root.textContent,'native error');
    newRelease({renderToSvg:source=>({svg:`<svg xmlns="http://www.w3.org/2000/svg"><text>${source.includes('new')?'new':'old'}</text></svg>`})});await next;
    assert.match(root.textContent,/new/);
});

test('切到普通图表后取消旧 ZenUML 请求，等待中的旧任务不接管宿主节点',async()=>{
    const root=html('<div class="mermaid">native error</div>');let release;
    const old=M.renderZenUmlFallback(root,{register(){}},()=>new Promise(resolve=>{release=resolve}),'```mermaid\nzenuml\nAlice -> Bob\n```');
    await M.renderZenUmlFallback(root,{register(){}},async()=>{throw Error('普通图表不能加载 ZenUML')},'```mermaid\nflowchart LR\nA --> B\n```');
    release({renderToSvg:()=>{throw Error('旧 ZenUML 不得接管普通图表')}});await old;
    assert.equal(root.textContent,'native error');
});

test('没有独立源码区块的嵌套内容也能在就绪阶段渲染 ZenUML',async()=>{
    const root=html('<section class="footnotes"><pre><code class="language-mermaid">zenuml\nAlice -&gt; Bob: Nested</code></pre></section>');
    const cleanups=[];
    const previousLocation=globalThis.location,previousStorage=globalThis.localStorage;
    const browser=new JSDOM('',{url:'https://vlook.test/'});globalThis.location=browser.window.location;globalThis.localStorage=browser.window.localStorage;
    M.setZenUmlSource(zenumlChunkCode);M.setZenUmlEnabled(true);
    try{await M.renderReadySection(root,ctx({registerCleanup:fn=>cleanups.push(fn)}));}
    finally{if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;if(previousStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previousStorage;browser.window.close();}
    assert.ok(root.querySelector('.footnotes .mermaid[data-vlook-diagram-kind="zenuml"] svg'));
    assert.match(root.textContent,/Nested/);
    cleanups.forEach(fn=>fn());
});

test('ZenUML 默认关闭：不加载 zenuml.js，也不改写图表',async()=>{
    M.setZenUmlEnabled(false);
    const root=html('<div class="mermaid">zenuml\nA -> B: x</div>');
    let loaded=0;M.setZenUmlSource(async()=>{loaded++;return null;});
    await M.renderZenUmlFallback(root,{register(){}},undefined,'```mermaid\nzenuml\nA -> B: x\n```');
    assert.equal(loaded,0);assert.equal(root.querySelector('svg'),null);
    assert.match(root.querySelector('pre code.language-zenuml').textContent,/A -> B/);
});

test('ZenUML 恢复宿主 SVG 错误图但保留已成功的原生 SVG',async()=>{
    const root=html('<div class="mermaid"><svg><text class="error-text">Syntax error</text></svg></div><div class="mermaid"><svg id="native-ok"><text>Flow</text></svg></div>');
    const source='```mermaid\nzenuml\nAlice -> Bob: Recovered\n```\n\n```mermaid\nflowchart LR\nA --> B\n```';
    const native=root.querySelector('#native-ok');let calls=0;
    await M.renderZenUmlFallback(root,{register(){}},async()=>({renderToSvg:()=>{calls++;return {svg:'<svg xmlns="http://www.w3.org/2000/svg"><text>Recovered</text></svg>'}}}),source);
    assert.equal(calls,1);assert.equal(root.querySelector('.error-text'),null);
    assert.equal(root.querySelector('#native-ok'),native);assert.match(root.textContent,/Recovered/);
    await M.waitForDiagrams(root,100,0,2);
});

test('脚注源码恢复宿主 ZenUML 错误容器时去除脚注缩进与引用标记',async()=>{
    const root=html('<section class="footnotes"><div class="mermaid">No diagram type detected</div></section>');
    const source='[^a]: 图表\n\n    > ```mermaid\n    > zenuml\n    > Alice -> Bob: Footnote\n    > ```';let received;
    await M.renderZenUmlFallback(root,{register(){}},async()=>({renderToSvg:text=>{received=text;return {svg:'<svg xmlns="http://www.w3.org/2000/svg"><text>Footnote</text></svg>'}}}),source);
    assert.equal(received,'\nAlice -> Bob: Footnote');assert.ok(root.querySelector('.footnotes svg'));
});

test('脚注续段中的图片与媒体参与源码恢复，代码示例中的假资源仍被排除',()=>{
    const source='正文[^nested]\n\n[^nested]: 资源\n\n    ![图片](pic/real.png#200w "脚注图片")\n\n    ![配乐](audio/real.mp3)\n\n    <img src="pic/html.png#300w" alt="HTML图片">\n\n    ```markdown\n    ![假图片](fake.png)\n    ![假配乐](fake.mp3)\n    <img src="fake-html.png">\n    ```';
    assert.deepEqual(M.sourceImages(source).map(ref=>ref.raw),['pic/real.png#200w','audio/real.mp3']);
    assert.deepEqual(M.renderedSourceImages(source,document).map(ref=>ref.raw),['pic/real.png#200w','audio/real.mp3','pic/html.png#300w']);
    const index=M.getSourceIndex(source,{captionGroup:false,captionNumber:true}),block=index.blocks.find(item=>item.text.startsWith('[^nested]:'));
    assert.deepEqual(M.mediaSources(block,source,document,true).map(ref=>ref.alt),['配乐']);
    assert.deepEqual(M.figureSources(block,source,document).map(ref=>ref.raw),['pic/real.png#200w','pic/html.png#300w']);
});

test('宿主直接以后处理根节点提供 Mermaid 错误容器时保留根节点并恢复 ZenUML',async()=>{
    const root=html('<section class="footnotes"><div class="mermaid">No diagram type detected</div></section>'),diagram=root.querySelector('.mermaid');
    await M.renderZenUmlFallback(diagram,{register(){}},async()=>({renderToSvg:()=>({svg:'<svg xmlns="http://www.w3.org/2000/svg"><text>Root footnote</text></svg>'})}),'[^n]:\n\n    ```mermaid\n    zenuml\n    Alice -> Bob: Root\n    ```');
    assert.equal(root.querySelector('.mermaid'),diagram);assert.equal(diagram.dataset.vlookDiagramKind,'zenuml');assert.match(diagram.textContent,/Root footnote/);assert.ok(diagram.querySelector('svg'));
});

test('宿主绕过普通后处理而异步挂载脚注时仍恢复 ZenUML，卸载后停止监听',async()=>{
    const host=html('<div class="markdown-preview-view"></div>');let reads=0,draws=0;
    const stop=M.watchFootnoteDiagrams(host,async()=>{reads++;return '[^n]:\n\n    ```mermaid\n    zenuml\n    Alice -> Bob: Mounted\n    ```'},async()=>({renderToSvg:()=>{draws++;return {svg:'<svg xmlns="http://www.w3.org/2000/svg"><text>Mounted</text></svg>'}}}));
    host.firstChild.innerHTML='<section class="footnotes"><div class="mermaid"><div class="pele-error">No diagram type detected</div></div></section>';
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(draws,1);assert.match(host.textContent,/Mounted/);assert.equal(host.querySelector('.pele-error'),null);
    stop();const before=reads;
    host.firstChild.innerHTML='<section class="footnotes"><div class="mermaid">No diagram type detected</div></section>';
    await new Promise(resolve=>setTimeout(resolve,10));assert.equal(reads,before);
});

test('脚注监听卸载后，迟到源码读取不得触发渲染',async()=>{
    const host=html('<div class="markdown-preview-view"><section class="footnotes"><div class="mermaid">Error</div></section></div>');let release,reads=0;
    const stop=M.watchFootnoteDiagrams(host,()=>{reads++;return new Promise(resolve=>{release=resolve})},async()=>{throw Error('卸载后不得加载')});
    await new Promise(resolve=>setTimeout(resolve,0));assert.equal(reads,1);stop();release('[^n]:\n\n    ```mermaid\n    zenuml\n    A -> B\n    ```');
    await new Promise(resolve=>setTimeout(resolve,0));assert.equal(host.textContent,'Error');
});

test('带 Mermaid 类的题注外层不会干扰混合图表的源码匹配',async()=>{
    const root=html('<div class="v-caption mermaid"><div class="mermaid"><svg id="native-flow"><text>Flow</text></svg></div></div><div class="v-caption mermaid"><div class="mermaid"><div class="pele-error">Error</div></div></div>');
    const source='```mermaid\nflowchart LR\nA-->B\n```\n\n```mermaid\nzenuml\nAlice -> Bob: Recovered\n```';let received;
    await M.renderZenUmlFallback(root,{register(){}},async()=>({renderToSvg:text=>{received=text;return {svg:'<svg xmlns="http://www.w3.org/2000/svg"><text>Recovered</text></svg>'}}}),source);
    assert.equal(received,'\nAlice -> Bob: Recovered');assert.ok(root.querySelector('#native-flow'));assert.equal(root.querySelector('.pele-error'),null);
    await M.waitForDiagrams(root,100,0,2);
});

test('一张图的题注包装不能充当两张图满足导出数量要求',async()=>{
    const root=html('<div class="v-caption mermaid"><div class="mermaid"><svg></svg></div></div>');
    await assert.rejects(M.waitForDiagrams(root,25,0,2),/1 个未完成/);
    await M.waitForDiagrams(root.querySelector('.mermaid .mermaid'),100,0,1);
});

test('目标含空格的 Typora 链接还原为链接，图片、代码与已有链接不处理',()=>{
    const root=html('<p>见 [GitHub Style Alert](guide2.md#github Style Alert) 与 [站点](https://a.b/x y)。<code>[c](d e)</code> ![i](p q.png) <a href="#k">[x](y z)</a></p>');
    const n=M.restoreSpacedLinks(root);
    assert.equal(n,2);
    const links=[...root.querySelectorAll('a')].map(a=>[a.getAttribute('href'),a.textContent]);
    assert.deepEqual(links.slice(0,2),[['guide2.md#github Style Alert','GitHub Style Alert'],['https://a.b/x y','站点']]);
    assert.match(root.querySelector('code').textContent,/\[c\]\(d e\)/);
    assert.match(root.textContent,/!\[i\]\(p q\.png\)/);
});

test('Typora DOM 将单元格 align 转为 text-align 样式，标签链接还原为文字',()=>{
    const root=html('<table><thead><tr><th align="right">数值</th></tr></thead><tbody><tr><td align="right">1</td></tr></tbody></table><p><a class="tag" href="#icon">#icon</a></p>');
    M.toTyporaDom(root,false);
    assert.equal(root.querySelector('th').style.textAlign,'right');assert.equal(root.querySelector('td').hasAttribute('align'),false);
    assert.equal(root.querySelector('a.tag'),null);assert.match(root.textContent,/#icon/);
});

test('行内 #icon 图标不加内容助手，普通图片仍加',()=>{
    const root=html('<ul><li>按 <img src="pic/a.svg?darksrc=invert#icon"> 开启</li></ul><p><img src="pic/b.png#logo#icon"><img src="pic/c.png"></p>');
    M.processContentViewers(root);
    assert.equal(root.querySelectorAll('.vlook-content-tools').length,1);
    assert.equal(root.querySelector('img[src="pic/c.png"]').dataset.vlookViewer,'1');
});

test('视图与操作：题注容器内表格与外层显示方式共用一个菜单，分组按顺序排列',()=>{
    const root=html('<figure class="v-cap-cntr"><table><tr><td>1</td></tr></table></figure>');
    M.processTableTools(root);M.processContentViewers(root);
    const menus=root.querySelectorAll('.vlook-view-menu');assert.equal(menus.length,1);
    assert.equal(menus[0].nextElementSibling.tagName,'FIGURE');
    const panel=menus[0].querySelector('.vlook-view-panel');assert.ok(panel);assert.equal(menus[0].querySelector('.vlook-view-trigger'),null);
    const sections=[...panel.querySelectorAll('.vlook-view-section')].map(s=>s.getAttribute('aria-label'));
    assert.deepEqual(sections,['显示方式','表格操作']);
    assert.ok([...panel.querySelectorAll('.vlook-view-item')].some(b=>b.title==='冻结首列'));
});

test('导出多主题：公共样式只内嵌一次，切换时与主题独有部分拼接',async()=>{
    const embedded=M.embeddedThemesHtml('blue',[{name:'blue',label:'Blue',color:'#00f',css:''},{name:'geek',label:'Geek',color:'#0f0',css:':root{--thm-cs-vars:--bg;--name:geek}',common:'c0'},{name:'hope',label:'Hope',color:'#0a0',css:':root{--name:hope}',common:'c0'}],new Map([['c0','p{color:red}']]));
    assert.equal((embedded.match(/text\/vlook-common/g)||[]).length,1);
    const frame=document.createElement('iframe');document.body.append(frame);const host=frame.contentDocument;
    host.head.innerHTML=`<style id="style-theme_css">:root{--thm-cs-vars:--bg;--name:blue}</style>`+embedded;
    host.defaultView.matchMedia=()=>({matches:false,addEventListener(){}});
    M.installExportThemeSwitcher(host);
    host.querySelector('.vlook-export-theme [data-value="geek"]').click();
    const shown=[...host.querySelectorAll('style')].find(el=>el.media==='all'&&/--name:geek/.test(el.textContent));
    assert.ok(shown);assert.match(shown.textContent,/p\{color:red\}/);
    frame.remove();
});

test('导出多主题：惰性内嵌其余主题，切换替换主题样式并按明暗重算颜色变量',async()=>{
    const css=(name,lg,dk)=>`:root{--thm-cs-vars:--bg;--bg-lg:${lg};--bg-dk:${dk};--name:${name}}`;
    const embedded=M.embeddedThemesHtml('blue',[{name:'blue',label:'Blue',color:'#00f',css:css('blue','white','black')},{name:'geek',label:'Geek',color:'#0f0',css:css('geek','ivory','navy')+'</script>'}]);
    assert.ok(!/<\/script><\/script>/.test(embedded.replace(/<\/script>$/,'')));
    const frame=document.createElement('iframe');document.body.append(frame);const host=frame.contentDocument;
    host.head.innerHTML=`<style id="style-theme_css">${css('blue','white','black')}</style>`+embedded;
    // jsdom 没有 matchMedia
    host.defaultView.matchMedia=()=>({matches:false,addEventListener(){}});
    M.installExportThemeSwitcher(host);
    const box=host.querySelector('.vlook-export-theme');assert.ok(box);
    const items=()=>[...box.querySelectorAll('[role="option"]')];
    const current=()=>items().find(o=>o.getAttribute('aria-selected')==='true').dataset.value;
    assert.deepEqual(items().map(o=>o.dataset.value),['blue','geek']);assert.equal(current(),'blue');
    assert.equal(box.querySelector('button').textContent,'Blue');
    const active=()=>[...host.querySelectorAll('style')].find(el=>el.media==='all'&&/--thm-cs-vars/.test(el.textContent)||el.id==='style-theme_css'&&el.media!=='not all');
    items()[1].click();
    assert.match(active().textContent,/--name:geek/);
    assert.equal(host.getElementById('style-theme_css').media,'not all');
    assert.equal(current(),'geek');assert.equal(box.querySelector('button').textContent,'Geek');
    items()[0].click();
    assert.match(active().textContent,/--name:blue/);
    frame.remove();
});

test('库内 HTML：在 head 首部注入资源基准与存储兼容脚本，无 head 时置于开头',()=>{
    const out=M.prepareHtmlDocument('<!doctype html><html><head><title>t</title></head><body><img src="pic/a.png"></body></html>','app://x/vault/samples/guide.html');
    assert.match(out,/<head><base href="app:\/\/x\/vault\/samples\/guide\.html"><script>/);
    assert.ok(out.indexOf('<base')<out.indexOf('<title>'));
    assert.match(M.prepareHtmlDocument('<p>x</p>','app://x/a "b".html'),/^<base href="app:\/\/x\/a &quot;b&quot;\.html"><script>/);
});

test('文件树类型图标：按扩展名映射图标与明暗配色，Excalidraw 笔记归入画板，让位 Ignorance 图标',()=>{
    const css=M.fileIconCss(M.FILE_KINDS,name=>`url(${name})`);
    assert.match(css,/\.nav-file-title:not\(:has\(> \.ib-file-icon\)\) > \.nav-file-title-content::before\{/);
    assert.match(css,/\.nav-file-title\{--vlook-file-icon:url\(file\)\}/);
    assert.match(css,/\[data-path\$="\.html" i\],\[data-path\$="\.htm" i\]\)\{--vlook-file-icon:url\(file-code-2\);--vlook-file-color:var\(--vlook-file-html\)\}/);
    assert.match(css,/\[data-path\$="\.excalidraw\.md" i\]\)\{--vlook-file-icon:url\(layout-dashboard\)/);
    assert.match(css,/body\{[^}]*--vlook-file-pdf:#D9484B/);assert.match(css,/body\.theme-dark\{[^}]*--vlook-file-pdf:#EE7B7D/);
    // .md 规则在画板规则之前，后者覆盖 .excalidraw.md
    assert.ok(css.indexOf('"\.md" i]')<css.indexOf('excalidraw.md'));
});

test('公式内含 $：被截断的三段按大括号配平重新拼成一条', () => {
    const piece = tex => `<mjx-container class="MathJax"><mjx-math><mjx-merror data-mjx-error="Missing close brace">${tex}</mjx-merror></mjx-math></mjx-container>`;
    const root = html(`<p>化学公式${piece('\\boxed{\\ce{CH4 + 2 ')}\\left( \\ce{O2 + 79/21 N2} \\right)${piece('}}')}。</p>`);
    assert.equal(M.repairNestedMath(root), 1);
    const maths = root.querySelectorAll('mjx-container');
    assert.equal(maths.length, 1);
    assert.equal(maths[0].dataset.tex, '\\boxed{\\ce{CH4 + 2 $\\left( \\ce{O2 + 79/21 N2} \\right)$}}');
    assert.equal(root.textContent, '化学公式。');
});

test('公式内含 $：已配平的公式与含标记的中间节点保持不动', () => {
    const piece = tex => `<mjx-container class="MathJax"><mjx-math><mjx-merror data-mjx-error="x">${tex}</mjx-merror></mjx-math></mjx-container>`;
    const balanced = html(`<p>${piece('a+b')}文本${piece('c')}</p>`);
    assert.equal(M.repairNestedMath(balanced), 0);
    const marked = html(`<p>${piece('\\ce{A ')}<em>x</em>${piece('}')}</p>`);
    assert.equal(M.repairNestedMath(marked), 0);
    assert.equal(marked.querySelectorAll('mjx-container').length, 2);
});

test('公式内含 $：宿主在第二个内部 $ 结束时，剩余的 }}$ 并回公式', () => {
    const piece = tex => `<mjx-container class="MathJax"><mjx-math><mjx-merror data-mjx-error="Missing close brace">${tex}</mjx-merror></mjx-math></mjx-container>`;
    const root = html(`<p>化学公式${piece('\\boxed{\\ce{CH4 + 2 $\\left( \\ce{O2 + 79/21 N2} \\right)')}}}$ 之后</p>`);
    assert.equal(M.repairNestedMath(root), 1);
    const maths = root.querySelectorAll('mjx-container');
    assert.equal(maths.length, 1);
    assert.equal(maths[0].dataset.tex, '\\boxed{\\ce{CH4 + 2 $\\left( \\ce{O2 + 79/21 N2} \\right)$}}');
    assert.equal(root.textContent, '化学公式 之后');
});

test('公式内含 $：宿主以 span.math 包裹行内公式时同样并回', () => {
    const wrapped = tex => `<span class="math math-inline is-loaded"><mjx-container class="MathJax"><mjx-math><mjx-merror data-mjx-error="Missing close brace">${tex}</mjx-merror></mjx-math></mjx-container></span>`;
    const root = html(`<p>化学${wrapped('\\boxed{\\ce{CH4 + 2 $\\left( \\ce{O2 + 79/21 N2} \\right)')}}}$ 之后</p>`);
    assert.equal(M.repairNestedMath(root), 1);
    const span = root.querySelector('span.math');
    assert.equal(root.querySelectorAll('mjx-container').length, 1);
    assert.equal(span.querySelector('mjx-container').dataset.tex, '\\boxed{\\ce{CH4 + 2 $\\left( \\ce{O2 + 79/21 N2} \\right)$}}');
    assert.equal(root.textContent, '化学 之后');
});

test('引用式图片定义的标题可跨多行',()=>{
    const refs=M.sourceImages('![图][a]\n\n[a]: pic.png "第一行\n第二行"\n');
    assert.equal(refs.length,1);assert.equal(refs[0].raw,'pic.png');assert.equal(refs[0].title,'第一行 第二行');
});

test('主题目录：读取文件头列出主题，用户目录同 id 覆盖内置主题，公共样式在前、@import 提到最前',async()=>{
    const files={
        'p/themes/common.css':'/*@vlook-part obsidian*/\np{margin:0}\n/*@vlook-part export*/\nq{margin:1px}\n',
        'p/themes/blue.css':'/*@vlook-theme {"name":"Ignorance","color":"#4d81ef"}*/\n/*@vlook-part obsidian*/\n@import url("a.css");a{}\n/*@vlook-part export*/\nb{}\n',
        'p/themes/hope.css':'/*@vlook-theme {"name":"Hope","color":"#709b57"}*/\n/*@vlook-part obsidian*/\nhope{}\n/*@vlook-part export*/\nhope-x{}\n',
        'p/themes/notes.css':'body{}',
        'mine/hope.css':'/*@vlook-theme {"name":"Hope 定制","color":"#000","standalone":true}*/\n/*@vlook-part obsidian*/\nmine{}\n/*@vlook-part export*/\nmine-x{}\n',
        // 文件头里的 id 不起作用，文件名才是主题 id；没有文件头但有段标记的文件同样算主题
        'mine/rose.css':'/*@vlook-theme {"id":"other","name":"Rose","color":"#f0a"}*/\n/*@vlook-part obsidian*/\nrose{}\n/*@vlook-part export*/\nrose-x{}\n',
        'mine/Plain.css':'/*@vlook-part obsidian*/\nplain{}\n/*@vlook-part export*/\nplain-x{}\n',
    };
    const writes=[];
    const adapter={
        exists:async p=>p in files||Object.keys(files).some(f=>f.startsWith(p+'/')),
        list:async dir=>({files:Object.keys(files).filter(f=>f.slice(0,f.lastIndexOf('/'))===dir),folders:[]}),
        stat:async p=>({mtime:1,size:files[p].length}),
        read:async p=>{if(!(p in files))throw Error('missing');return files[p];},
        write:async(p,t)=>{writes.push(p);files[p]=t;},
        mkdir:async()=>{},
    };
    const saved=[...M.THEMES];
    try{
        const store=new M.ThemeStore(adapter,'p',()=> 'mine');
        const list=await store.scan();
        assert.deepEqual(list.map(t=>t.id),['blue','hope','plain','rose']);
        assert.deepEqual([...M.THEMES],['blue','hope','plain','rose']);
        assert.equal(M.themeLabel('plain'),'plain');assert.equal(M.themeLabel('rose'),'Rose');
        assert.equal(M.themeLabel('hope'),'Hope 定制');
        const squash=t=>t.replace(/\n+/g,'\n').trim();
        assert.equal(squash(await store.css('blue','obsidian')),'@import url("a.css");\np{margin:0}\na{}');
        assert.equal(squash(await store.css('blue','export')),'q{margin:1px}\nb{}');
        assert.equal((await store.layers('blue','export')).common.trim(),'q{margin:1px}');
        // 定制主题同 id 覆盖内置主题；standalone 不拼公共样式，其余定制主题仍接内置 common.css
        assert.equal((await store.css('hope','export')).trim(),'mine-x{}');
        assert.match(await store.css('rose','obsidian'),/p\{margin:0\}[\s\S]*rose\{\}/);
        assert.ok(writes.includes('p/themes-index.json'));
    }finally{M.THEMES.splice(0,M.THEMES.length,...saved);}
});

test('主题目录：内置默认主题首次写入插件目录，升级后刷新，已下载主题按版本判断是否过期',async()=>{
    const files={};
    const adapter={
        exists:async p=>p in files||Object.keys(files).some(f=>f.startsWith(p+'/')),
        list:async dir=>({files:Object.keys(files).filter(f=>f.slice(0,f.lastIndexOf('/'))===dir),folders:[]}),
        stat:async p=>({mtime:1,size:files[p].length}),
        read:async p=>{if(!(p in files))throw Error('missing');return files[p];},
        write:async(p,t)=>{files[p]=t;},
        mkdir:async()=>{},
    };
    const theme=(id,body)=>`/*@vlook-theme {"id":"${id}","name":"${id}","color":"#000"}*/\n/*@vlook-part obsidian*/\n${body}\n/*@vlook-part export*/\n${body}\n`;
    const seed=version=>({version,files:{'common.css':'/*@vlook-part obsidian*/\np{}\n/*@vlook-part export*/\np{}\n','blue.css':theme('blue','a'+version)}});
    const saved=[...M.THEMES];
    try{
        const first=new M.ThemeStore(adapter,'plug',()=> '',seed('1.0.0'));
        assert.deepEqual((await first.scan()).map(t=>t.id),['blue']);
        assert.match(files['plug/themes/blue.css'],/a1\.0\.0/);
        // 同版本不覆盖已有文件，缺失时补回
        files['plug/themes/blue.css']='edited';
        await new M.ThemeStore(adapter,'plug',()=> '',seed('1.0.0')).scan();
        assert.equal(files['plug/themes/blue.css'],'edited');
        delete files['plug/themes/blue.css'];
        await new M.ThemeStore(adapter,'plug',()=> '',seed('1.0.0')).scan();
        assert.equal(files['plug/themes/blue.css'],theme('blue','a1.0.0'));
        const next=new M.ThemeStore(adapter,'plug',()=> '',seed('1.1.0'));
        await next.scan();
        assert.match(files['plug/themes/blue.css'],/a1\.1\.0/);
        // 下载的主题记录版本；插件升级后过期，手动放入的主题没有记录，不会被刷新
        await next.install('hope',theme('hope','h'));
        files['plug/themes/note.css']=theme('note','n');
        await next.scan();
        assert.equal(next.isStale('hope'),false);assert.equal(next.isStale('note'),false);
        const upgraded=new M.ThemeStore(adapter,'plug',()=> '',seed('1.2.0'));
        await upgraded.scan();
        assert.equal(upgraded.isStale('hope'),true);assert.equal(upgraded.isStale('note'),false);
        assert.equal(upgraded.isBuiltin('hope'),true);
    }finally{M.THEMES.splice(0,M.THEMES.length,...saved);}
});

test('主题目录：放入、替换或删除主题文件后能被发现，扫描后恢复为无变化',async()=>{
    const files={'plug/themes/blue.css':'/*@vlook-theme {"id":"blue","name":"Ignorance","color":"#000"}*/\n/*@vlook-part obsidian*/\na{}\n/*@vlook-part export*/\na{}\n'};
    let time=1;const times={};
    const adapter={
        exists:async p=>p in files||Object.keys(files).some(f=>f.startsWith(p+'/')),
        list:async dir=>({files:Object.keys(files).filter(f=>f.slice(0,f.lastIndexOf('/'))===dir),folders:[]}),
        stat:async p=>({mtime:times[p]??=1,size:files[p].length}),
        read:async p=>{if(!(p in files))throw Error('missing');return files[p];},
        write:async()=>{},mkdir:async()=>{},
    };
    const saved=[...M.THEMES];
    try{
        const store=new M.ThemeStore(adapter,'plug',()=> '');
        await store.scan();
        assert.equal(await store.changed(),false);
        files['plug/themes/hope.css']=files['plug/themes/blue.css'].replace(/blue/,'hope');
        assert.equal(await store.changed(),true);
        await store.scan();assert.equal(await store.changed(),false);
        files['plug/themes/hope.css']+=' ';
        assert.equal(await store.changed(),true);
        await store.scan();
        delete files['plug/themes/hope.css'];
        assert.equal(await store.changed(),true);
    }finally{M.THEMES.splice(0,M.THEMES.length,...saved);}
});

test('发布页清单中的主题未下载也可选，已安装的以目录内容为准；shared 段排在所属部分之前',async()=>{
    const files={
        'p/themes/blue.css':'/*@vlook-part shared*/\n:root{--img:url(data:x)}\n/*@vlook-part obsidian*/\na{}\n/*@vlook-part export*/\nb{}\n',
        'p/themes-remote.json':JSON.stringify([{id:'fancy',name:'Fancy',color:'#d7785b',file:'theme-fancy.css'},{id:'blue',name:'Ignorance 远程',color:'#000'}]),
    };
    const adapter={
        exists:async p=>p in files||Object.keys(files).some(f=>f.startsWith(p+'/')),
        list:async dir=>({files:Object.keys(files).filter(f=>f.slice(0,f.lastIndexOf('/'))===dir),folders:[]}),
        stat:async p=>({mtime:1,size:files[p].length}),
        read:async p=>{if(!(p in files))throw Error('missing');return files[p];},
        write:async(p,t)=>{files[p]=t;},mkdir:async()=>{},
    };
    try{
        const store=new M.ThemeStore(adapter,'p',()=> '');
        await store.scan();
        assert.deepEqual([...M.THEMES],['blue','fancy']);
        assert.equal(M.themeLabel('blue'),'Ignorance 远程');assert.equal(M.themeLabel('fancy'),'Fancy');
        assert.equal(M.isRemoteTheme('fancy'),true);assert.equal(store.remoteEntry('fancy').file,'theme-fancy.css');
        assert.equal(store.get('fancy'),undefined);
        assert.equal((await store.layers('blue','export')).theme.replace(/\n/g,''),':root{--img:url(data:x)}b{}');
    }finally{M.setThemes([]);}
});
