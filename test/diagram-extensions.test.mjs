import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

const compiled=await build({entryPoints:[new URL('../src/core/diagram-extensions.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',packages:'external'});
const {installZenUml}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('共享宿主引擎并发注册一次 ZenUML，保留原图表类型',async()=>{
    const definition={id:'zenuml'};let loads=0,registrations=0;
    const engine={getRegisteredDiagramsMetadata:()=>[{id:'flowchart'}],async registerExternalDiagrams(defs){registrations++;assert.deepEqual(defs,[definition]);}};
    const load=async()=>{loads++;return {default:definition};};
    const first=installZenUml(engine,load),second=installZenUml(engine,load);
    assert.equal(first,second);await Promise.all([first,second]);
    await installZenUml(engine,load);
    assert.equal(loads,1);assert.equal(registrations,1);
});

test('宿主已有 ZenUML 时不重复加载；不同引擎独立注册',async()=>{
    let calls=0;const load=async()=>{calls++;return {default:{id:'zenuml'}};};
    await installZenUml({getRegisteredDiagramsMetadata:()=>[{id:'zenuml'}],registerExternalDiagrams(){assert.fail('重复注册');}},load);
    assert.equal(calls,0);
    await installZenUml({registerExternalDiagrams(){}},load);
    await installZenUml({registerExternalDiagrams(){}},load);
    assert.equal(calls,2);
});

test('加载或注册失败会暴露错误并允许下次重试',async()=>{
    let calls=0;const engine={registerExternalDiagrams(){if(++calls===1)throw Error('register failed');}};
    await assert.rejects(installZenUml(engine,async()=>{throw Error('load failed');}),/load failed/);
    await assert.rejects(installZenUml(engine,async()=>({default:{}})),/register failed/);
    await installZenUml(engine,async()=>({default:{}}));assert.equal(calls,2);
});

test('官方延迟加载渲染器保留参数、返回值和原始图形，并加入动态配色',async()=>{
    const dom=new JSDOM('<svg xmlns="http://www.w3.org/2000/svg" id="zen-test"><text class="participant-label">Alice</text></svg>');
    const previous=globalThis.document;globalThis.document=dom.window.document;globalThis.activeDocument=dom.window.document;
    let definition;const calls=[];
    try{
        await installZenUml({registerExternalDiagrams(defs){[definition]=defs;}},async()=>({default:{id:'zenuml',async loader(){return {id:'zenuml',diagram:{parser:{parse(){}},renderer:{async draw(...args){calls.push(args);return 'rendered';}}}};}}}));
        const loaded=await definition.loader();
        assert.equal(await loaded.diagram.renderer.draw('zenuml Alice->Bob','zen-test',3),'rendered');
        assert.deepEqual(calls,[['zenuml Alice->Bob','zen-test',3]]);
        const svg=document.querySelector('svg');assert.equal(svg.querySelector('text').textContent,'Alice');
        assert.ok(svg.classList.contains('vlook-zenuml'));
        const styles=svg.querySelectorAll('style[data-vlook-zenuml-palette]');assert.equal(styles.length,1);
        assert.match(styles[0].textContent,/var\(--df,var\(--text-normal,#222\)\)/);
        assert.match(styles[0].textContent,/svg\.vlook-zenuml \.participant-label/);
        assert.match(styles[0].textContent,/@media print\{svg\.vlook-zenuml\{--vlook-zen-bg:#fff;--vlook-zen-fg:#222;/);
        assert.match(styles[0].textContent,/fill:var\(--vlook-zen-fg\)/);
        await loaded.diagram.renderer.draw('zenuml Alice->Bob','zen-test');
        assert.equal(svg.querySelectorAll('style[data-vlook-zenuml-palette]').length,1);
    }finally{globalThis.document=previous;globalThis.activeDocument=previous;dom.window.close();}
});

test('包装不改变渲染器接收者，原渲染错误原样抛出且不会把失败图标记为完成',async()=>{
    const dom=new JSDOM('<svg xmlns="http://www.w3.org/2000/svg" id="failure"></svg>');
    const previous=globalThis.document;globalThis.document=dom.window.document;globalThis.activeDocument=dom.window.document;
    let definition;const failure=Error('original render failure');let failed=true;
    const renderer={state:'original state',async draw(){assert.equal(this,renderer);assert.equal(this.state,'original state');if(failed)throw failure;return 42;}};
    try{
        await installZenUml({registerExternalDiagrams(defs){[definition]=defs;}},async()=>({default:{async loader(){return {diagram:{renderer}};}}}));
        const loaded=await definition.loader();
        await assert.rejects(loaded.diagram.renderer.draw('zenuml','failure'),error=>error===failure);
        assert.equal(document.querySelector('[data-vlook-zenuml-palette]'),null);
        failed=false;assert.equal(await loaded.diagram.renderer.draw('zenuml','failure'),42);
        assert.equal(document.querySelectorAll('[data-vlook-zenuml-palette]').length,1);
    }finally{globalThis.document=previous;globalThis.activeDocument=previous;dom.window.close();}
});

test('sandbox 图表只在其 iframe 内追加配色，不修改父页面的同名节点',async()=>{
    const dom=new JSDOM('<svg xmlns="http://www.w3.org/2000/svg" id="sandbox-chart"></svg><iframe id="isandbox-chart"></iframe>');
    const previous=globalThis.document;globalThis.document=dom.window.document;globalThis.activeDocument=dom.window.document;
    let definition;
    try{
        const frame=document.querySelector('iframe');frame.contentDocument.body.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" id="sandbox-chart"><text>Alice</text></svg>';
        await installZenUml({registerExternalDiagrams(defs){[definition]=defs;}},async()=>({default:{async loader(){return {diagram:{renderer:{async draw(){}}}};}}}));
        const loaded=await definition.loader();await loaded.diagram.renderer.draw('zenuml','sandbox-chart');
        assert.equal(document.querySelector('svg').classList.contains('vlook-zenuml'),false);
        assert.equal(frame.contentDocument.querySelectorAll('[data-vlook-zenuml-palette]').length,1);
    }finally{globalThis.document=previous;globalThis.activeDocument=previous;dom.window.close();}
});

test('Pele 兼容宿主不具备扩展注册接口，启动前必须走独立 ZenUML 路径',async()=>{
    const {supportsMermaidExtensions}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
    assert.equal(supportsMermaidExtensions({render(){},parse(){},mermaidAPI:{getConfig(){}}}),false);
    assert.equal(supportsMermaidExtensions({registerExternalDiagrams(){}}),true);
    assert.equal(supportsMermaidExtensions(null),false);
});
