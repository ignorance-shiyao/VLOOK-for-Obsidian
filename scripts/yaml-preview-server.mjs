// Production HTML builder with controlled source/rendering plus full bundled runtime.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {setup} from '../test/harness.mjs';
const M=await setup(),root=new URL('../',import.meta.url);
M.MarkdownRenderer.render=async(_app,_source,el)=>{el.innerHTML='<h1>公开章节</h1><p>公开正文示例</p><h2>内部章节</h2><p>内部正文样例</p><h2>Draft One</h2><p>草稿正文样例</p><h1>公开末章</h1><p>公开结尾</p>'};
const source='---\ntitle: YAML 章节列表验证\nvlook-query: ws=0\nvlook-unpub:\n  - 内部章节\n  - "/^draft/i"\n  - "/[/"\n---\n\n# 公开章节\n\n公开正文示例\n\n## 内部章节\n\n内部正文样例\n\n## Draft One\n\n草稿正文样例\n\n# 公开末章\n\n公开结尾';
const plugin={app:{vault:{cachedRead:async()=>source,adapter:{basePath:'/fixture'}},metadataCache:{}},settings:{...M.DEFAULT_SETTINGS},rawRenderDepth:0,resolvePreviewTheme:()=> 'blue',readAsset:async rel=>{try{return await readFile(new URL('dist/'+rel,root),'utf8')}catch{return null}}};
const {html}=await M.buildVlookHtml(plugin,{path:'fixture.md',basename:'fixture',parent:{path:'/'}},{mode:'preview'});
createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html)}else{res.statusCode=404;res.end('missing')}}).listen(18766,'127.0.0.1',()=>console.log('http://127.0.0.1:18766/'));
