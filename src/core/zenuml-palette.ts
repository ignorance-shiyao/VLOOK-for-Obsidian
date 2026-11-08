/** Keep ZenUML's SVG palette readable in both Obsidian and standalone VLOOK. */
export function applyZenUmlPalette(svg:SVGElement):void {
    svg.classList.add('vlook-zenuml');
    if(svg.querySelector('style[data-vlook-zenuml-palette]'))return;
    const style=svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg','style');
    style.setAttribute('data-vlook-zenuml-palette','1');
    const scope='svg.vlook-zenuml';
    const rules:[string,string][]=[
        ['','background:var(--db,var(--background-primary,#fff))'],
        ['.frame-border-outer','fill:var(--df-a,var(--text-muted,#666))'],
        ['.frame-border-inner,.frame-header-bg,.group-title-bg','fill:var(--db,var(--background-primary,#fff))'],
        ['.frame-title,.participant-label,.message-label,.return-label,.fragment-label,.fragment-condition,.fragment-section-label,.group-title-text','fill:var(--df,var(--text-normal,#222))'],
        ['.participant-box','fill:var(--db,var(--background-primary,#fff));stroke:var(--df-a,var(--text-muted,#666))'],
        ['.participant-icon','color:var(--df,var(--text-normal,#222))'],
        ['.participant-icon [fill="currentColor"]:not([stroke])','stroke:var(--df-a,var(--text-muted,#666))'],
        ['.frame-header-line,.lifeline,.fragment-border,.group-outline','stroke:var(--df-a,var(--text-muted,#666))'],
        ['.message-line,.return-line,.return-arrow','stroke:var(--df,var(--text-normal,#222))'],
        ['.arrow-head','fill:var(--df,var(--text-normal,#222));stroke:var(--df,var(--text-normal,#222))'],
        ['.arrow-open','fill:none'],
        ['.return-icon','fill:var(--df,var(--text-normal,#222))'],
        ['.occurrence,.fragment-header','fill:var(--pn-c,var(--background-secondary,#dedede))'],
        ['.occurrence','stroke:var(--df-a,var(--text-muted,#666))'],
        ['.fragment-separator','stroke:var(--df-a,var(--text-muted,#999))'],
        ['.seq-number,.comment-text','fill:var(--df-a,var(--text-muted,#666))'],
    ];
    const palette:Record<string,string>={
        'var(--db,var(--background-primary,#fff))':'var(--vlook-zen-bg)',
        'var(--df,var(--text-normal,#222))':'var(--vlook-zen-fg)',
        'var(--df-a,var(--text-muted,#666))':'var(--vlook-zen-muted)',
        'var(--df-a,var(--text-muted,#999))':'var(--vlook-zen-muted)',
        'var(--pn-c,var(--background-secondary,#dedede))':'var(--vlook-zen-panel)',
    };
    const declarations=`${scope}{--vlook-zen-bg:var(--db,var(--background-primary,#fff));--vlook-zen-fg:var(--df,var(--text-normal,#222));--vlook-zen-muted:var(--df-a,var(--text-muted,#666));--vlook-zen-panel:var(--pn-c,var(--background-secondary,#dedede))}`;
    style.textContent=declarations+'\n'+rules.map(([selectors,properties])=>{
        for(const [from,to] of Object.entries(palette))properties=properties.replaceAll(from,to);
        return `${selectors?selectors.split(',').map(s=>`${scope} ${s}`).join(','):scope}{${properties}}`;
    }).join('\n')+`\n@media print{${scope}{--vlook-zen-bg:#fff;--vlook-zen-fg:#222;--vlook-zen-muted:#666;--vlook-zen-panel:#eee;print-color-adjust:exact;-webkit-print-color-adjust:exact}}`;
    svg.append(style);
}
