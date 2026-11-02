// Controlled conflicting theme defaults + production HTML builder/full official runtime.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {setup} from '../test/harness.mjs';
const M=await setup(),root=new URL('../',import.meta.url);
document.body.style.setProperty('--vlook-query','unpub=OFF&xmd=MD&uico=solid');
M.MarkdownRenderer.render=async(_app,_source,el)=>{el.innerHTML='<h1>公开章节</h1><p>公开正文</p><h2><del>内部章节</del></h2><p>保留的内部正文</p><p><a href="target.md">后续 Markdown 文档</a></p><h1>公开末章</h1><p>公开结尾</p>'};
const source='---\ntitle: 结构参数运行时验证\nvlook-query: ws=0\n---\n\n# 公开章节\n\n公开正文\n\n## ~~内部章节~~\n\n保留的内部正文\n\n[后续 Markdown 文档](target.md)\n\n# 公开末章\n\n公开结尾';
const plugin={app:{vault:{cachedRead:async()=>source,adapter:{basePath:'/fixture'}},metadataCache:{getFirstLinkpathDest:path=>path==='target.md'?{path:'target.md',extension:'md'}:null}},settings:{...M.DEFAULT_SETTINGS},rawRenderDepth:0,resolvePreviewTheme:()=> 'blue',readAsset:async rel=>{try{const css=await readFile(new URL('dist/'+rel,root),'utf8');return css+'\n:root{--vlook-query:"unpub=on&xmd=html&uico=flat"}'}catch{return null}}};
const {html}=await M.buildVlookHtml(plugin,{path:'fixture.md',basename:'fixture',parent:{path:'/'}},{mode:'export',theme:'fancy'});
createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html)}else{res.statusCode=404;res.end('fixed fixture only')}}).listen(18768,'127.0.0.1',()=>console.log('http://127.0.0.1:18768/'));
