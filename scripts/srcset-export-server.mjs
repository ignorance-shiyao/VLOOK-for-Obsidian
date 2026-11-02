// Fixed local resources only. Verify production path conversion and browser image selection.
import {createServer} from 'node:http';
import {setup,html} from '../test/harness.mjs';
const modules=await setup();
const root=html('<h1>srcset 导出资源加载回归</h1><p>普通 img 的密度候选</p><img id="density" width="320" height="120" alt="密度候选图" src="app://local/vault/pic/one.svg?123" srcset="app://local/vault/pic/one.svg?123 1x, app://local/vault/pic/two.svg?456 2x"><p>picture source 的宽度候选</p><picture><source srcset="app://local/vault/pic/a,b.svg?123 320w, app://local/vault/pic/wide.svg?456 640w" sizes="320px"><img id="width" width="320" height="120" alt="宽度候选图" src="app://local/vault/pic/one.svg"></picture>');
modules.appUrlsToRelative(root,'/vault','');
const page='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>srcset 导出资源加载回归</title><style>body{font:18px system-ui;margin:32px;color:#17355f}img{display:block;border:1px solid #b8cae8;border-radius:12px}</style><body>'+root.innerHTML+'</body></html>';
const assets=new Set(['/pic/one.svg','/pic/two.svg','/pic/a,b.svg','/pic/wide.svg']);
createServer((req,res)=>{const path=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);if(path==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');return res.end(page)}if(assets.has(path)){res.setHeader('Content-Type','image/svg+xml');return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="#e4eeff"/><text x="30" y="135" font-family="sans-serif" font-size="32" fill="#2457a7">${path.slice(5)}</text></svg>`)}res.statusCode=404;res.end('missing');}).listen(18756,'127.0.0.1',()=>console.log('Srcset export: http://127.0.0.1:18756/'));
