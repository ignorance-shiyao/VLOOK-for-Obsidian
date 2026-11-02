// Public rendered formulas + production DOM adapter + official runtime, no vault access.
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {setup,html as fixtureHtml} from '../test/harness.mjs';
import {adaptRuntime} from './runtime-transform.mjs';
const root=new URL('../',import.meta.url),modules=await setup();
const evidence=JSON.parse(await readFile(new URL('test/fixtures/host-mathjax-results.json',root),'utf8'));
const host=fixtureHtml('<h1>原版公式完整运行时验证</h1>'+evidence.results.map(item=>`<h2>${item.name}</h2><div class="math">${item.html}</div>`).join(''));
const baseEl=document.createElement('base');baseEl.href='http://127.0.0.1:18753/';document.head.append(baseEl);
for(const item of evidence.styles){const style=document.createElement('style');style.id=item.id;style.textContent=item.css;document.head.append(style);}
const manifest=JSON.parse(await readFile('/tmp/vlook-host-mathjax/manifest.json','utf8'));
const allowed=new Set(manifest.assets.map(item=>'/mathjax/'+item.path));
const mathCss=await modules.collectMathStyles(host,async url=>{const path=new URL(url).pathname;if(!allowed.has(path))throw Error('未提取字体 '+path);return new Uint8Array(await readFile('/tmp/vlook-host-mathjax/'+path.slice('/mathjax/'.length)));});
if(host.querySelectorAll('mjx-container').length!==23)throw Error('输入公式不完整');
host.querySelectorAll('.result').forEach(el=>el.remove());
host.querySelectorAll('.math').forEach(el=>el.className=el.querySelector('mjx-container[display="true"]')?'math math-block':'math math-inline');
modules.toTyporaDom(host,true);
if(host.querySelectorAll('mjx-container').length!==23)throw Error('DOM 转换丢失公式');
const runtime=adaptRuntime(await readFile(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8'));
const css=await readFile(new URL('dist/css-typora/blue.css',root),'utf8'),base=await readFile(new URL('src/generated/typora-base.txt',root),'utf8');
const page=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="vlook-query" content="ws=0&capnum=on&capgroup=off"><title>数学完整运行时验证</title><style>${base}</style><style>${css}</style><style id="vlook-mathjax-styles">${mathCss}</style>${runtime}</head><body class="typora-export"><div class="typora-export-content"><div id="write">${host.innerHTML}</div></div></body></html>`;
await writeFile('/tmp/vlook-math-fullruntime.html',page);
createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(page)}else{res.statusCode=404;res.end('missing');}}).listen(18754,'127.0.0.1',()=>console.log('Math full runtime: http://127.0.0.1:18754/'));
