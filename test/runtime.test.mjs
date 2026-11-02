import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {adaptRuntime} from '../scripts/runtime-transform.mjs';

test('原版运行时在 srcdoc 使用有效文档地址，并不再提交文档统计', () => {
    const runtime = fs.readFileSync(new URL('../upstream/released/plugin/plugin.txt', import.meta.url), 'utf8');
    const adapted = adaptRuntime(runtime);
    assert.ok(adapted.includes('vlook-document-url'));
    assert.ok(!adapted.includes('"?p=vlook&ver="'));
    assert.ok(!adapted.includes('"stat-github."'));
    assert.ok(adapted.includes('print'));
    assert.ok(adapted.length > runtime.length * .99);
});

test('上游适配点变化时阻止构建，避免静默丢失适配', () => {
    assert.throws(() => adaptRuntime('unknown runtime'), /URL 适配点/);
});

test('运行时链接转换仅处理路径末尾，保留目录、参数、锚点和宿主结果', async () => {
    const {JSDOM}=await import('jsdom');
    const vm=await import('node:vm');
    const dom=new JSDOM('<a href="目录.md/笔记.md?source=old.md#段落.md">一</a><a href="目录.md/附件.pdf?name=x.md">二</a><a data-vlook-resolved-link="1" href="目录.md/笔记.md?xmd=off">三</a><a href="目标.MD?xmd=php#位置">四</a><a href="目标.md?xmd=off">五</a><a href="#章节.md">六</a>');
    const runtime=adaptRuntime(fs.readFileSync(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8'));
    const converter=runtime.match(/function ([\w$]+)\(\)\{\(function rewriteRuntimeLinks[\s\S]*?\)\(document,([\w$]+)\(([\w$]+)\)\)\}/);
    assert.ok(converter,'验证实际注入的运行时函数');
    const context={document:dom.window.document,URLSearchParams,[converter[2]]:()=>null,[converter[3]]:'xmd'};
    vm.runInNewContext(converter[0]+';'+converter[1]+'()',context);
    const hrefs=Array.from(dom.window.document.querySelectorAll('a'),a=>a.getAttribute('href'));
    assert.deepEqual(hrefs,['目录.md/笔记.html?source=old.md#段落.md','目录.md/附件.pdf?name=x.md','目录.md/笔记.md?xmd=off','目标.php?xmd=php#位置','目标.md?xmd=off','#章节.md']);
    context[converter[2]]=()=> 'off';
    vm.runInNewContext(converter[1]+'()',context);
    assert.equal(dom.window.document.querySelectorAll('a')[4].getAttribute('href'),'目标.md?xmd=off');
    dom.window.close();
});

test('上游链接转换实现变化时阻止静默构建', () => {
    const source=fs.readFileSync(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8');
    assert.throws(()=>adaptRuntime(source.replaceAll('".md"','".markdown"')), /链接转换适配点/);
});

test('实际运行时文库分隔器与宿主一致，链接内部逗号不拆项', async () => {
    const vm=await import('node:vm');
    const {splitDocumentLibrary}=await import('../scripts/library-split.mjs');
    const source=adaptRuntime(fs.readFileSync(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8'));
    const fn=source.match(/function ([\w$]+)\(([\w$]+)\)\{return \(function splitDocumentLibrary[\s\S]*?\}\)\(\2\)\}/);
    assert.ok(fn);
    const input='[甲,乙](a,b.md "描述,说明"),[次项](a(b,c).md),https://example.org';
    const result=vm.runInNewContext(fn[0]+';'+fn[1]+'(input)',{input});
    assert.deepEqual(Array.from(result),splitDocumentLibrary(input));assert.equal(result.length,3);
});

test('上游文库分隔实现变化时阻止静默构建', () => {
    const source=fs.readFileSync(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8');
    assert.throws(()=>adaptRuntime(source.replace('.sp(/,','.sp(/;')), /文库分隔适配点/);
});

test('实际文库链接解析支持各种说明引号，尖括号地址不进入最终 URL', async () => {
    const vm=await import('node:vm');
    const source=adaptRuntime(fs.readFileSync(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8'));
    const fn=source.match(/function ([\w$]+)\(([\w$]+)\)\{return \(function parseDocumentLibraryLink[\s\S]*?\}\)\(\2\)\}/);
    assert.ok(fn);
    const inputs=['[手册](<folder/a b.md#章节> \'查询说明\')','[标题](a.md (括号说明))','[标题](a.md "双引号说明")'];
    const result=inputs.map(input=>vm.runInNewContext(fn[0]+';'+fn[1]+'(input)',{input}));
    assert.equal(result[0].page,'folder/a b.md');assert.equal(result[0].hash,'#章节');assert.equal(result[0].title,'查询说明');
    assert.equal(result[1].title,'括号说明');assert.equal(result[2].title,'双引号说明');
    assert.equal(vm.runInNewContext(fn[0]+';'+fn[1]+'("plain.md")'),null);
});

test('上游文库解析字段变化时阻止静默构建', () => {
    const source=fs.readFileSync(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8');
    assert.throws(()=>adaptRuntime(source.replace('(?<title1>','(?<renamed>')), /文库链接解析适配点/);
});

test('当前文库预匹配复用解析器：普通 URL 不读空结果，复杂链接保留标题', async () => {
    const vm=await import('node:vm');
    const {parseDocumentLibraryLink}=await import('../scripts/library-split.mjs');
    const source=adaptRuntime(fs.readFileSync(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8'));
    const setup=source.match(/([\w$]+)=([\w$]+)\(([\w$]+)\),([\w$]+)=\1===([\w$]+)\?([\w$]+)\(\3\):\1\.page,([\w$]+)\.idx<0/);
    assert.ok(setup);
    const [,parsed,parse,item,page,nil,strip,owner]=setup;
    const title=source.match(new RegExp(owner+'\\.title='+parsed+'\\?\\.text\\|\\|'+parsed+'\\?\\.title\\|\\|'+item));assert.ok(title);
    const assign=setup[0].slice(0,-(','+owner+'.idx<0').length);
    const run=input=>vm.runInNewContext(assign+';'+title[0]+';({page:'+page+',title:'+owner+'.title})',{[parse]:parseDocumentLibraryLink,[item]:input,[nil]:null,[strip]:url=>url.split('#')[0],[owner]:{}});
    const plain=run('folder/current.html#part');assert.equal(plain.page,'folder/current.html');assert.equal(plain.title,'folder/current.html#part');
    const link=run('[复杂(标题)](<folder/a b.md#章节> \'单引号说明\')');assert.equal(link.page,'folder/a b.md');assert.equal(link.title,'复杂(标题)');
    assert.equal(run('[](a.md "默认名称")').title,'默认名称');
});

test('实际注入的章节规则支持标志及非法规则隔离，状态正则可重复匹配', async () => {
    const vm=await import('node:vm');
    const source=adaptRuntime(fs.readFileSync(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8'));
    const push=source.match(/function ([\w$]+)\(([\w$]+),([\w$]+),([\w$]+)\)\{\(function pushRuntimeRules[\s\S]*?\}\)\(\2,\3,\4\)\}/);
    const match=source.match(/function ([\w$]+)\(([\w$]+),([\w$]+)\)\{return \(function matchRuntimeRules[\s\S]*?\}\)\(\2,\3\)\}/);
    assert.ok(push);assert.ok(match);
    const context={exact:[],expressions:[],input:'公开; /^draft/i; /^(test)/g; /[/; /bad/zz'};
    vm.runInNewContext(push[0]+';'+match[0]+';'+push[1]+'(input,exact,expressions)',context);
    assert.deepEqual(Array.from(context.exact),['公开']);assert.equal(context.expressions.length,2);
    for(const title of ['DRAFT one','test one','test one'])assert.equal(vm.runInNewContext(match[1]+'('+JSON.stringify(title)+',expressions)',context),true);
});

test('上游章节规则解析变动时阻止静默构建', () => {
    const source=fs.readFileSync(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8');
    assert.throws(()=>adaptRuntime(source.replace('.x().sp(";")','.x().sp("|")')),/章节规则解析适配点/);
});

test('实际打印入口等待字体、图片解码和两帧布局，连续点击只打印一次',async()=>{
    const {JSDOM}=await import('jsdom');
    const vm=await import('node:vm');
    const dom=new JSDOM('<div id="write"><img loading="lazy"></div>');
    const win=dom.window;let fontDone,imageDone,prints=0,closed=0,frames=0;
    Object.defineProperty(win.document,'fonts',{value:{ready:new Promise(resolve=>fontDone=resolve)}});
    win.document.querySelector('img').decode=()=>new Promise(resolve=>imageDone=resolve);
    win.requestAnimationFrame=callback=>{frames++;queueMicrotask(callback);return frames};
    win.print=()=>prints++;
    const adapted=adaptRuntime(fs.readFileSync(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8'));
    const entry=adapted.match(/function ([\w$]+)\(\)\{void \(async function printRuntimeWhenReady[\s\S]*?\)\(([\w$]+),([\w$]+)\)\}/);assert.ok(entry);
    const ctx=vm.createContext({[entry[2]]:win,[entry[3]]:()=>closed++});
    vm.runInContext(entry[0]+';'+entry[1]+'();'+entry[1]+'()',ctx);
    assert.equal(closed,1);assert.equal(prints,0);assert.equal(win.document.querySelector('img').loading,'eager');
    fontDone();await new Promise(resolve=>setImmediate(resolve));assert.equal(prints,0);
    imageDone();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(prints,1);assert.equal(frames,2);assert.equal(win.document.documentElement.hasAttribute('data-vlook-print-pending'),false);
    dom.window.close();
});

test('打印等待超时不输出半成品，恢复入口供用户重试',async()=>{
    const {printRuntimeWhenReady}=await import('../scripts/runtime-transform.mjs');
    const {JSDOM}=await import('jsdom');const dom=new JSDOM('<div id="write"></div>'),win=dom.window;
    let prints=0,notice='';Object.defineProperty(win.document,'fonts',{value:{ready:new Promise(()=>{})}});
    win.print=()=>prints++;win.alert=value=>notice=value;win.console.error=()=>{};
    win.setTimeout=callback=>{queueMicrotask(callback);return 1};win.clearTimeout=()=>{};
    await printRuntimeWhenReady(win,()=>{});
    assert.equal(prints,0);assert.match(notice,/等待超时/);
    assert.equal(win.document.documentElement.hasAttribute('data-vlook-print-pending'),false);dom.window.close();
});

test('宿主提供直接写入PDF入口时不打开系统打印，返回false时回退',async()=>{
    const {printRuntimeWhenReady}=await import('../scripts/runtime-transform.mjs');
    const {JSDOM}=await import('jsdom');
    for(const [result,expected] of [[true,0],[false,1]]){
        const dom=new JSDOM('<div id="write"></div>'),win=dom.window;let prints=0,hosts=0;
        Object.defineProperty(win.document,'fonts',{value:{ready:Promise.resolve()}});
        win.requestAnimationFrame=callback=>{queueMicrotask(callback);return 1};
        win.print=()=>prints++;win.__vlookPrintToPdf=async()=>{hosts++;return result;};
        await printRuntimeWhenReady(win,()=>{});
        assert.equal(hosts,1);assert.equal(prints,expected);dom.window.close();
    }
});

test('宿主直接写入时打印按钮改为导出PDF，独立HTML保留原文案',()=>{
    const out=adaptRuntime(fs.readFileSync(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8'));
    assert.match(out,/window\.__vlookPrintToPdf\?\["导出 PDF","Export PDF"\]:\["启动打印（选择：另存为 PDF）"/);
});

test('上游打印入口变化时阻止静默丢失资源等待',()=>{
    const source=fs.readFileSync(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8');
    assert.throws(()=>adaptRuntime(source.replace('.print()','.printChanged()')),/打印入口适配点/);
});
