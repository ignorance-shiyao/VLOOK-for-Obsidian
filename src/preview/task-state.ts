/** Restore non-serialized checkbox state before the official DOM-ready restyler. */
export function restoreExportTaskStates(root:ParentNode):void {
    root.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-vlook-indeterminate="1"]').forEach(input=>{
        input.indeterminate=true;
        input.removeAttribute('data-vlook-indeterminate');
    });
}
