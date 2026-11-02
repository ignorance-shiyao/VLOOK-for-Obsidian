/** Test-only extraction of ordinary delimited YAML; not a claim of host parser equivalence. */
export function getFrontMatterInfo(source:string) {
    const match=/^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
    return match?{exists:true,contentStart:match[0].length,frontmatter:match[1]}:{exists:false,contentStart:0,frontmatter:''};
}
