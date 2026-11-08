interface MermaidExtensions {
    registerExternalDiagrams(definitions: unknown[]): unknown;
}
export function supportsMermaidExtensions(engine:unknown):engine is MermaidExtensions {
    return !!engine&&typeof (engine as MermaidExtensions).registerExternalDiagrams==='function';
}
