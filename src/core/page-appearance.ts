export const FONT_OPTIONS:Record<string,string>={theme:'跟随主题',sans:'无衬线',serif:'衬线',mono:'等宽',system:'系统字体'};
const FONTS:Record<string,string>={sans:'Arial,"PingFang SC","Microsoft YaHei",sans-serif',serif:'Georgia,"Songti SC",serif',mono:'ui-monospace,"SFMono-Regular",monospace',system:'system-ui,sans-serif'};
export function typographyCss(font:unknown,size:unknown,pageWidth?:unknown):string {
    const family=typeof font==='string'&&Object.prototype.hasOwnProperty.call(FONTS,font)?FONTS[font]:undefined;
    const n=typeof size==='number'&&Number.isFinite(size)&&size>0?Math.round(Math.min(32,Math.max(12,size))):0;
    const w=typeof pageWidth==='number'&&Number.isFinite(pageWidth)&&pageWidth>0?Math.round(Math.min(2400,Math.max(480,pageWidth))):0;
    if(!family&&!n&&!w)return '';
    const width=w?`body{--file-line-width:${w}px!important}.markdown-preview-sizer.markdown-preview-sizer{max-width:${w}px!important}`:'';
    return width+`body{${family?`--v-fm-text:${family}!important;--font-text-theme:${family}!important;`:''}}.markdown-rendered,#write,.markdown-source-view .cm-content{${family?`font-family:${family}!important;`:''}${n?`font-size:${n}px!important;`:''}}`;
}

export function compactPath(path:string):string {
    const parts=path.split('/').filter(Boolean);parts.pop();
    return parts.length?(parts.length>1?'… / ':'')+parts[parts.length-1]+' /':'';
}

/** 去掉引用 http(s) 字体文件的 @font-face；默认不联网加载字体，改用系统字体。 */
export function stripRemoteFonts(css:string):string {
    return css.replace(/@font-face\s*\{[^{}]*url\(\s*["']?https?:[^{}]*\}/gi,'');
}
