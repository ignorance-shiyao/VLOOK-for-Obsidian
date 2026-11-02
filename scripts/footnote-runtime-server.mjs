// Fixed public-syntax fixture + production DOM adapter + official runtime; no vault files served.
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {setup,html} from '../test/harness.mjs';
import {adaptRuntime} from './runtime-transform.mjs';
const modules=await setup(),root=new URL('../',import.meta.url);
const host=html('<h1>脚注完整运行时验证</h1><p>首个引用<sup class="footnote-ref"><a id="fnref-one" href="#fn-one">1</a></sup>，重复引用<sup class="footnote-ref"><a id="fnref-one-2" href="#fn-one">1</a></sup>，第二条引用<sup class="footnote-ref"><a id="fnref-two" href="#fn-two">2</a></sup>。</p><section class="footnotes"><ol><li id="fn-one"><p>第一条脚注内容<a class="footnote-backref" href="#fnref-one">返回</a><a class="footnote-backref" href="#fnref-one-2">返回第二处</a></p><ul><li>嵌套列表内容</li></ul></li><li id="fn-two"><p>第二条脚注内容 <strong>粗体保留</strong><a class="footnote-backref" href="#fnref-two">返回</a></p></li></ol></section>');
modules.toTyporaDom(host,true);
const runtime=adaptRuntime(await readFile(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8'));
const css=await readFile(new URL('dist/css-typora/blue.css',root),'utf8'),base=await readFile(new URL('src/generated/typora-base.txt',root),'utf8');
const page=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="vlook-query" content="ws=0"><title>脚注完整运行时验证</title><style>${base}</style><style>${css}</style>${runtime}</head><body class="typora-export"><div class="typora-export-content"><div id="write">${host.innerHTML}</div></div></body></html>`;
await writeFile('/tmp/vlook-footnote-fullruntime.html',page);
createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(page)}else{res.statusCode=404;res.end('missing');}}).listen(18755,'127.0.0.1',()=>console.log('Footnote full runtime: http://127.0.0.1:18755/'));
