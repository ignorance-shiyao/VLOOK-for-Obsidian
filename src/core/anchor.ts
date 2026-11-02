/** 对齐原版 LinkTool_transSpecHash；仅用于标题/题注，不改写显式 HTML id。 */
export function vlookAnchor(value: string): string {
    return value.trim().replace(/\s/g, '-').toLowerCase()
        .replace(/^~~(.+)~~$/g, '$1')
        .replace(/\p{P}|\+/gu, punctuation => punctuation === '-' ? '-' : punctuation === '–' ? '--' : punctuation === '—' ? '---' : '');
}
