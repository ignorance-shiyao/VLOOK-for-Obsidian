import {fenceParser as parser} from './fenced-source';

interface SrcRef { raw: string; alt: string; title?: string; pos: number; end: number }

/** 保留原始偏移，屏蔽代码中的示例，避免导出时图片引用数量失配。 */
function maskCode(text:string):string {
    const ranges:{from:number;to:number}[]=[];
    parser.parse(text).iterate({enter(node){
        if(['InlineCode','FencedCode','CodeBlock'].includes(node.name)){
            ranges.push({from:node.from,to:node.to});return false;
        }
    }});
    let masked=text;
    for(const range of ranges.reverse())masked=masked.slice(0,range.from)
        +masked.slice(range.from,range.to).replace(/[^\n]/g,' ')+masked.slice(range.to);
    return masked;
}

const unescapeImageText=(value:string)=>value.replace(/\\([\\[\]()"'<>])/g,'$1');

interface ImageDefinition {raw:string;title?:string;source:string}
const referenceLabel=(label:string)=>unescapeImageText(label).trim().replace(/\s+/g,' ').toLowerCase();

let cachedDefinitionText:string|undefined;
let cachedDefinitions=new Map<string,ImageDefinition>();
export function imageReferenceDefinitions(text:string):Map<string,ImageDefinition> {
    if(text===cachedDefinitionText)return cachedDefinitions;
    const definitions=new Map<string,ImageDefinition>();
    const original=text.split('\n');
    maskCode(text).split('\n').forEach((line,i)=>{
        if(!/^ {0,3}\[[^\]\n]+\]:/.test(line))return;
        let source=original[i], candidate=source;
        let next=i+1;
        if(/^ {0,3}\[[^\]\n]+\]:[ \t]*$/.test(candidate)&&original[next]?.trim()){
            source+='\n'+original[next];candidate+=' '+original[next].trim();next++;
        }
        if(/^[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^\n]*\))[ \t]*$/.test(original[next]||'')){
            source+='\n'+original[next];candidate+=' '+original[next].trim();
        }
        const open=candidate.match(/^ {0,3}\[[^\]\n]+\]:[ \t]*(?:<[^>\n]+>|\S+?)[ \t]+(["'])(?:(?!\1).)*$/);
        if(open){
            for(let at=next,lines=0;lines<4&&original[at]?.trim();at++,lines++){
                source+='\n'+original[at];candidate+=' '+original[at].trim();
                if(original[at].includes(open[1]))break;
            }
        }
        const match=candidate.match(/^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^>\n]+)>|(\S+?))(?:[ \t]+(?:"([^"\n]*)"|'([^'\n]*)'|\(([^\n]*)\)))?[ \t]*$/);
        if(!match)return;
        const label=referenceLabel(match[1]);
        if(!definitions.has(label))definitions.set(label,{raw:unescapeImageText(match[2]||match[3]),title:match[4]??match[5]??match[6],source});
    });
    cachedDefinitionText=text;cachedDefinitions=definitions;
    return definitions;
}

export function sourceImages(text: string, definitionsText = text): SrcRef[] {
    const refs:SrcRef[]=[];
    const masked=maskCode(text);
    const definitions=imageReferenceDefinitions(definitionsText);
    for(let pos=0;pos<masked.length;pos++){
        if(masked.slice(pos,pos+2)!=='![')continue;
        let escapes=0;for(let k=pos-1;k>=0&&masked[k]==='\\';k--)escapes++;
        if(escapes%2)continue;
        if(masked[pos+2]==='['){
            const end=masked.indexOf(']]',pos+3);if(end<0)continue;
            const parts=text.slice(pos+3,end).split('|');
            refs.push({raw:parts[0],alt:parts.slice(1).join('|'),pos,end:end+2});pos=end+1;continue;
        }
        let at=pos+2,depth=1;
        for(;at<masked.length;at++){
            if(masked[at]==='\\'){at++;continue;}
            if(masked[at]==='[')depth++;
            if(masked[at]===']'&&!--depth)break;
        }
        if(depth)continue;
        const alt=unescapeImageText(text.slice(pos+2,at));
        if(masked[at+1]!=='('){
            let end=at+1,label=alt;
            if(masked[end]==='['){
                const close=masked.indexOf(']',end+1);if(close<0)continue;
                label=text.slice(end+1,close)||alt;end=close+1;
            }
            const definition=definitions.get(referenceLabel(label));
            if(definition){refs.push({raw:definition.raw,alt,title:definition.title,pos,end});pos=end-1;}
            continue;
        }
        at+=2;
        while(/\s/.test(masked[at]||'x'))at++;
        let raw='';
        if(masked[at]==='<'){
            const end=masked.indexOf('>',at+1);if(end<0||masked.slice(at,end).includes('\n'))continue;
            raw=unescapeImageText(text.slice(at+1,end));at=end+1;
        }else{
            const from=at;let nesting=0;
            for(;at<masked.length;at++){
                const ch=masked[at];
                if(ch==='\\'){at++;continue;}
                if(ch==='(')nesting++;
                else if(ch===')'){if(!nesting)break;nesting--;}
                if(/\s/.test(ch))break;
            }
            if(nesting)continue;
            raw=unescapeImageText(text.slice(from,at));
        }
        if(!raw)continue;
        const space=at;while(/\s/.test(masked[at]||'x'))at++;
        let title:string|undefined;
        if(at>space&&['"',"'",'('].includes(masked[at])){
            const closing=masked[at]==='('?')':masked[at],from=++at;
            for(;at<masked.length;at++){if(masked[at]==='\\'){at++;continue;}if(masked[at]===closing)break;}
            if(at>=masked.length)continue;
            title=unescapeImageText(text.slice(from,at++));
            while(/\s/.test(masked[at]||'x'))at++;
        }
        if(masked[at]!==')')continue;
        refs.push({raw,alt,title,pos,end:at+1});pos=at;
    }
    return refs;
}


export function referenceDefinitionsSource(text:string):string {
    return Array.from(imageReferenceDefinitions(text).values(),entry=>entry.source).join("\n");
}
