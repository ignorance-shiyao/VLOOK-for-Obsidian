import { headingParser, headingPlain } from './heading';

export interface QuoteSourceTitle {title:string;line:number;kind:'subtitle'|'fold'}
/** 对齐首 / 相邻次段 strong/mark 小标题与首个 h6 折叠标题，不扫描后续正文。 */
export function quoteSourceTitles(source:string):QuoteSourceTitle[]{
    const result:QuoteSourceTitle[]=[];
    headingParser.parse(source).iterate({enter(node){
        if(node.name!=='Blockquote')return;
        const children=[];
        for(let child=node.node.firstChild;child;child=child.nextSibling)if(child.name!=='QuoteMark')children.push(child);
        const add=(from:number,to:number,kind:'subtitle'|'fold')=>{
            const raw=source.slice(from,to).replace(/^ {0,3}(?:> ?)+/gm,'');
            const title=headingPlain(kind==='fold'?raw:'# '+raw);
            if(title)result.push({title,line:source.slice(0,from).split('\n').length-1,kind});
        };
        if(children[0]?.name==='ATXHeading6')add(children[0].from,children[0].to,'fold');
        if(children[0]?.name==='Paragraph'){
            for(const paragraph of children.slice(0,2)){
                if(paragraph.name!=='Paragraph')break;
                const inline=[];
                for(let child=paragraph.firstChild;child;child=child.nextSibling)if(child.name!=='QuoteMark')inline.push(child);
                if(inline.length===1&&['StrongEmphasis','Highlight'].includes(inline[0].name))add(inline[0].from,inline[0].to,'subtitle');
            }
        }
    }});
    return result.sort((a,b)=>a.line-b.line);
}
