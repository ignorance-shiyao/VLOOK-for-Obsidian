/** Strip YAML/CSS formatting whitespace before URL decoding; encoded data stays intact. */
export function normalizeVlookQuery(value:string):string {
    return value.trim().replace(/^["']|["']$/g,'').trim().split('&').map(part=>{
        const equal=part.indexOf('=');
        return equal<0?part.trim():part.slice(0,equal).trim()+'='+part.slice(equal+1).trim();
    }).join('&');
}

/** Match V_query_init: each later occurrence replaces the previous value. */
export function vlookQueryParams(value:string):URLSearchParams {
    const result=new URLSearchParams();
    for(const [key,entry] of new URLSearchParams(normalizeVlookQuery(value)))result.set(key,entry);
    return result;
}
