// Public fixed code sample, production code tools, no vault access.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url);
const bundle=await build({stdin:{contents:`import {processCodeBlocks} from './src/features/code-block';const cleanups=[];processCodeBlocks(document.querySelector('#fixture'),{registerCleanup:fn=>cleanups.push(fn)});const pre=document.querySelector('pre');new MutationObserver(()=>{document.querySelector('#state').textContent='当前逻辑行：'+(pre.dataset.vlookActiveLine||'无');}).observe(pre,{attributes:true,attributeFilter:['data-vlook-active-line']});document.querySelector('#cleanup').onclick=()=>{cleanups.forEach(fn=>fn());};`,resolveDir:root.pathname,loader:'ts'},bundle:true,format:'iife',write:false});
const css=await readFile(new URL('styles/plugin.css',root),'utf8');
const page=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>代码逻辑行高亮回归</title><style>${css}body{font:16px system-ui;margin:24px;--text-selection:#80b5ff}pre{box-sizing:border-box;width:360px;border:1px solid #aaa;padding:12px;background:#f4f7fb}code{font:16px/24px monospace}pre code .token{color:#1452a4}.vlook-code-tools{font:12px system-ui}button{margin:4px}</style><h1>代码逻辑行高亮</h1><p>固定源码，生产代码工具；真实浏览器布局验证，不是 Obsidian 实机验收。</p><p id="state">当前逻辑行：无</p><button id="cleanup">卸载工具监听</button><div id="fixture"><pre><code class="language-js"><span class="token">const</span> <span>longMessage = "This is a long source line that wraps across several visual lines, preserving all syntax token elements.";</span>
<span class="token">console</span><span>.log(longMessage);</span>
<span class="token">return</span><span> longMessage;</span></code></pre></div><script src="/bundle.js"></script></html>`;
createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].contents)}if(req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');return res.end(page)}res.statusCode=404;res.end();}).listen(18752,'127.0.0.1',()=>console.log('Code line regression: http://127.0.0.1:18752/'));
