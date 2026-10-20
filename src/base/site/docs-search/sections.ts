import type { SearchSection } from './types';

// Run on the renderer's tree after it assigns ids. Search can only link to
// headings the published page actually has, including duplicate heading ids.
type Node = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: Node[] };
const textOf = (node: Node): string => node.value ?? (node.children ?? []).map(textOf).join('');
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

export function headingSections(nodes: Node[], title: string, titleId: string): SearchSection[] {
  const sections: SearchSection[] = [];
  let parent = '';
  let current: SearchSection = { anchor: titleId, titlePath: [title], text: '' };
  const finish = () => { if (current.text.trim()) sections.push({ ...current, text: current.text.trim() }); };
  for (const node of nodes) {
    if (node.tagName === 'h2' || node.tagName === 'h3') {
      finish();
      const heading = collapse(textOf(node));
      if (node.tagName === 'h2') parent = heading;
      current = { anchor: String(node.properties?.id), titlePath: [title, ...(node.tagName === 'h3' && parent ? [parent] : []), heading], text: '' };
    } else current.text += `${collapse(textOf(node))}\n\n`;
  }
  finish();
  return sections;
}
