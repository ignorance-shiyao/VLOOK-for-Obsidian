import {parser} from '@lezer/markdown';

/** SourceIndex groups quotes/lists as whole blocks; inspect nested literal blocks too. */
export function literalRanges(source:string):{blocks:{from:number;to:number}[];inline:{from:number;to:number}[]}{
    const ranges:{from:number;to:number}[]=[],inline:{from:number;to:number}[]=[];
    parser.parse(source).iterate({enter(node){
        if(node.name==='InlineCode'){inline.push({from:node.from,to:node.to});return false;}
        if(!['FencedCode','CodeBlock','HTMLBlock'].includes(node.name))return;
        ranges.push({from:node.from,to:node.to});
        return false;
    }});
    return {blocks:ranges,inline};
}
