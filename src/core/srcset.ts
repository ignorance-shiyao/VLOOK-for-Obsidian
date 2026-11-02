/** Rewrite only URL spans, preserving descriptors and separators byte for byte.
 * Token boundaries follow https://html.spec.whatwg.org/multipage/images.html#parsing-a-srcset-attribute
 * Descriptor validity and image selection remain the browser's responsibility.
 */
export function rewriteSrcset(value:string,resolve:(url:string)=>string):string {
    const space=(char:string)=>/[\t\n\f\r ]/.test(char);
    let position=0,last=0,result='';
    while(position<value.length){
        while(position<value.length&&(space(value[position])||value[position]===','))position++;
        if(position===value.length)break;
        const start=position;
        while(position<value.length&&!space(value[position]))position++;
        let end=position;
        while(end>start&&value[end-1]===',')end--;
        if(end>start){result+=value.slice(last,start)+resolve(value.slice(start,end));last=end;}
        if(end<position)continue;
        let parens=false;
        while(position<value.length){
            const char=value[position++];
            if(parens){if(char===')')parens=false;}
            else if(char==='(')parens=true;
            else if(char===',')break;
        }
    }
    return result+value.slice(last);
}
