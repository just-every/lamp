import { normalizeLiveText, type CompiledLiveEdit } from './live-edit-contracts';
import { applyStyles } from './visual-style';
export const privateSelector = 'input,textarea,select,option,script,style,iframe,svg,[contenteditable],[data-rer-private],[data-rer-editor],[hidden],[aria-hidden="true"]';
export function visibleTextNodes(element: Element) {
  const result: Text[] = [];
  const walker = element.ownerDocument.createTreeWalker(element,4);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (parent && !parent.closest(privateSelector) && parent.getClientRects().length && getComputedStyle(parent).visibility === 'visible') result.push(node as Text);
  }
  return result;
}
export function renderedText(element: Element) { return normalizeLiveText(visibleTextNodes(element).map(n => n.nodeValue || '').join('')); }
export function applyLiveEdit(element: HTMLElement, edit: CompiledLiveEdit) {
  if (element.closest(privateSelector)) throw new Error('This element is private or cannot be edited.');
  if (element.tagName.toLowerCase() !== edit.target.tag || (element.getAttribute('role') || '') !== edit.target.role || renderedText(element) !== edit.target.beforeText) throw new Error('The element no longer matches its observed text, tag or role.');
  const nodes = visibleTextNodes(element).filter(n => normalizeLiveText(n.nodeValue || '') !== '');
  if (edit.change.text !== undefined && nodes.length !== 1) throw new Error('Text editing needs one unambiguous visible text label. Select the label itself.');
  const node = nodes[0], original = node?.nodeValue;
  const undoStyles = applyStyles(element,edit.change.styles || {});
  if (edit.change.text !== undefined) node.nodeValue = edit.change.text;
  return {element,undo(){
    undoStyles();
    if (edit.change.text !== undefined && node.isConnected && element.contains(node) && node.nodeValue === edit.change.text) node.nodeValue = original ?? null;
  }};
}
