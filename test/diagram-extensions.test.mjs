import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

const compiled=await build({entryPoints:[new URL('../src/core/diagram-extensions.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',packages:'external'});
const {supportsMermaidExtensions}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('Pele 兼容宿主不具备扩展注册接口，启动前必须走独立 ZenUML 路径',async()=>{
    assert.equal(supportsMermaidExtensions({render(){},parse(){},mermaidAPI:{getConfig(){}}}),false);
    assert.equal(supportsMermaidExtensions({registerExternalDiagrams(){}}),true);
    assert.equal(supportsMermaidExtensions(null),false);
});
