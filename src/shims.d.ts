// markdown-it-footnote ships no type declarations.
declare module 'markdown-it-footnote' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}
