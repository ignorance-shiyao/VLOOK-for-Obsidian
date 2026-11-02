// Fixed fixture + production scratch-card implementation, no vault access.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url);
const bundle=await build({stdin:{contents:`import {processCodeMagic} from './src/features/code-magic';processCodeMagic(document.querySelector('#fixture'),{query:{get:()=>null},settings:{coatingDefault:'gy'}});`,resolveDir:root.pathname,loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'});
const css=await readFile(new URL('styles/plugin.css',root),'utf8'),blue=await readFile(new URL('dist/css/blue.css',root),'utf8');
const page=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>刮刮卡键盘操作验证</title><style>${blue}${css}body{margin:32px;font:18px system-ui;color:#17355f}#fixture{padding:24px;border:1px solid #b8cae8;border-radius:12px;max-width:640px}</style><h1>刮刮卡键盘操作验证</h1><p>Enter 展开，空格收起；固定内容使用生产刮刮卡实现。</p><div class="markdown-rendered" id="fixture"><p>答案：<em>按键查看<strong>隐藏答案 42</strong></em></p></div><script src="/bundle.js"></script></html>`;
createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].contents)}if(req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');return res.end(page)}res.statusCode=404;res.end('missing');}).listen(18759,'127.0.0.1',()=>console.log('Scratch keyboard: http://127.0.0.1:18759/'));
