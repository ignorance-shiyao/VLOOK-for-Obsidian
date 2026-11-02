import type {Tree} from '@lezer/common';
import { parser, TaskList } from '@lezer/markdown';
const tasks=parser.configure(TaskList);
export interface TaskMarker {offset:number;line:number;ch:number;checked:boolean}
/** 按实际任务语法定位，代码里的任务示例不参与 DOM 复选框映射。 */
export function sourceTasks(source:string):TaskMarker[]{
    const result:TaskMarker[]=[];
    tasks.parse(source).iterate({enter(node){
        if(node.name!=='TaskMarker')return;
        const offset=node.from+1,prefix=source.slice(0,offset),last=prefix.lastIndexOf('\n');
        result.push({offset,line:prefix.split('\n').length-1,ch:offset-last-1,checked:source[offset].toLowerCase()==='x'});
    }});
    return result;
}

/** Match leaf-list progress without treating fenced Markdown examples as tasks. */
export function sourceTaskPercent(source:string):number|null {
    return treeTaskPercent(tasks.parse(source),source);
}
function treeTaskPercent(tree:Tree,source:string):number|null {
    const items=new Map<number,{leaf:boolean;checked:boolean}>();
    tree.iterate({enter(node){
        if(node.name!=='ListItem')return;
        for(let parent=node.node.parent;parent;parent=parent.parent){
            if(parent.name==='ListItem'){
                const ancestor=items.get(parent.from);if(ancestor)ancestor.leaf=false;
                break;
            }
        }
        const marker=node.node.getChild('Task')?.getChild('TaskMarker');
        items.set(node.from,{leaf:true,checked:!!marker&&source.slice(marker.from,marker.to).toLowerCase()==='[x]'});
    }});
    const leaves=Array.from(items.values()).filter(item=>item.leaf);
    return leaves.length?Number((leaves.filter(item=>item.checked).length/leaves.length*100).toFixed(1)):null;
}

/** One parse per editor update; each paragraph/task owns only its next sibling list. */
export function sourceTaskProgress(source:string):Map<number,number> {
    const result=new Map<number,number>();
    tasks.parse(source).iterate({enter(node){
        if(node.name!=='Paragraph'&&node.name!=='Task'&&!/^(ATXHeading|SetextHeading)[1-6]$/.test(node.name))return;
        let list=node.node.nextSibling;
        while(list?.name==='QuoteMark')list=list.nextSibling;
        if(!list||!['BulletList','OrderedList'].includes(list.name))return;
        const percent=treeTaskPercent(list.toTree(),source.slice(list.from,list.to));
        if(percent!==null){
            const first=source.slice(0,node.from).split('\n').length-1;
            const last=first+source.slice(node.from,node.to).split('\n').length-1;
            for(let line=first;line<=last;line++)result.set(line,percent);
        }
    }});
    return result;
}
