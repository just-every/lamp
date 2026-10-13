import type { CutoverPreview } from '../cutover';
const key = 'lamp:cutover-preview';
/** Only public paths/counts, never source files, keys or subscriber addresses. */
export function rememberCutover(preview: CutoverPreview) { sessionStorage.setItem(key, JSON.stringify(preview)); }
export function readCutoverDraft(): CutoverPreview | null {
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { return null; }
}

export function clearCutover() { sessionStorage.removeItem(key); }
