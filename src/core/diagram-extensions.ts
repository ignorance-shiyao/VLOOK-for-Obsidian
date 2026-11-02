import {withZenUmlPalette} from './zenuml-palette';
import {lazyZenUmlDefinition} from './zenuml-loader';
interface MermaidExtensions {
    registerExternalDiagrams(definitions: unknown[]): Promise<unknown> | unknown;
    getRegisteredDiagramsMetadata?: () => {id: string}[];
}
export function supportsMermaidExtensions(engine:unknown):engine is MermaidExtensions {
    return !!engine&&typeof (engine as MermaidExtensions).registerExternalDiagrams==='function';
}

const registrations=new WeakMap<object,Promise<void>>();

/** Extend the host's engine; do not replace it or alter its configuration. */
export function installZenUml(mermaid:MermaidExtensions,load:()=>Promise<{default:unknown}>=async()=>lazyZenUmlDefinition()):Promise<void> {
    if(mermaid.getRegisteredDiagramsMetadata?.().some(item=>item.id==='zenuml'))return Promise.resolve();
    const existing=registrations.get(mermaid);if(existing)return existing;
    const task=(async()=>{const extension=await load();await mermaid.registerExternalDiagrams([withZenUmlPalette(extension.default)]);})();
    registrations.set(mermaid,task);
    void task.catch(()=>{if(registrations.get(mermaid)===task)registrations.delete(mermaid);});
    return task;
}
