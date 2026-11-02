import {parser} from '@lezer/markdown';

/** Public top-level examples; quoted tutorial copies are not separate acceptance cases. */
export function publicChartCases(source){
 const cases=[];let title='图表';
 parser.parse(source).iterate({enter(node){
  if(node.node.parent?.name!=='Document')return;
  if(/^ATXHeading/.test(node.name)){title=source.slice(node.from,node.to).replace(/^#+\s*/,'').replace(/\s+#+\s*$/,'').trim();return false;}
  if(node.name!=='FencedCode')return;
  const info=node.node.getChild('CodeInfo');
  if(!info||source.slice(info.from,info.to).trim().split(/\s/)[0].toLowerCase()!=='mermaid')return false;
  const text=node.node.getChild('CodeText');
  cases.push({id:cases.length+1,title,line:source.slice(0,node.from).split('\n').length,endLine:source.slice(0,node.to).split('\n').length,markdown:source.slice(node.from,node.to),code:text?source.slice(text.from,text.to):''});
  return false;
 }});
 return cases;
}
