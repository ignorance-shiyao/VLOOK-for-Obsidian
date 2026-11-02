import postcss from 'postcss';

/** Recover public diagram rules whose LESS source lives in an optional private repo. */
export function releasedDiagramCss(source){
    const output=postcss.root();
    const copy=(from,to)=>{
        for(const node of from.nodes||[]){
            if(node.type==='rule'){
                const selectors=node.selectors.filter(selector=>/^(?:svg\[aria-roledescription|\.v-actor-(?:front|key-sys|ext-sys)$)/.test(selector.trim()));
                if(selectors.length)to.append(node.clone({selector:selectors.join(',')}));
            }else if(node.type==='atrule'&&node.nodes){
                const container=node.clone({nodes:[]});copy(node,container);if(container.nodes.length)to.append(container);
            }
        }
    };
    copy(postcss.parse(source),output);
    if(!output.nodes.length)throw Error('公开主题中未找到 Mermaid 规则，阻止静默构建缺失样式');
    return output.toString();
}
