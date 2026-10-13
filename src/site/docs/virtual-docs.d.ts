// The modules src/site/docs/build/plugin.ts generates from docs/site.json and the Markdown it names.
declare module 'virtual:lamp-docs' {
  export const repository: import('./types').DocsRepository;
  export const sections: import('./types').DocsSection[];
}
declare module 'virtual:lamp-docs/bodies' {
  export const bodies: Record<string, import('./types').DocsBody>;
}
