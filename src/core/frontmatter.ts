import {parseYaml} from 'obsidian';

// Typora 宽松读取 YAML：形如 `- [文字](链接 "说明")` 的 Markdown 链接值在严格 YAML 中会被当成流式数组而整体解析失败。
// 先按严格 YAML 解析；失败时把这类链接值加引号重试，仍失败则视为无配置。
const MARKDOWN_LINK_VALUE=/^(\s*(?:-\s+|[^\s:#][^:]*:\s+))(\[[^\n]*\]\([^\n]*\)[^\n]*?)\s*$/;

export function quoteMarkdownLinkValues(yaml:string):string {
    return yaml.split('\n').map(line=>line.replace(MARKDOWN_LINK_VALUE,(_m,lead:string,value:string)=>`${lead}'${value.replace(/'/g,"''")}'`)).join('\n');
}

export function parseFrontmatterYaml(yaml:string):Record<string,unknown> {
    for(const text of [yaml,quoteMarkdownLinkValues(yaml)]){
        try {
            const parsed:unknown=parseYaml(text);
            if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return parsed as Record<string,unknown>;
            if(parsed==null)return {};
        } catch { /* 下一种写法 */ }
    }
    return {};
}
