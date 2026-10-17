import type { ImportPlan } from '../../../../modules/import-kit/src/d1/index';
import type { NativeValue } from './rows';
import { heldDeadline } from './held-sorry';
import { isLampPermalink, resolvePublicAddresses, sourceFeedPaths, type PublicAddressCandidate } from './public-addresses';

export interface CutoverPreview {
  source?: string;
  afterCutover?: boolean;
  readerGaps?: string[];
  rows: Array<{ address: string; path: string; target: string }>;
  total: number;
  unavailable: string[];
  feeds: string[];
  invitations: { eligible: number; claimed: number; expired: number; deadline: string | null; heldUntil?: string | null };
}
export function sourceReaderGaps(namespace: string) {
  if (namespace === 'sorry') return ["Sorry public JSON readers under /api/v1/ are not served by Lamp. Update them to /api/public/status. Sorry feeds are not a complete history export; use Lamp’s /feed.atom after moving."];
  if (namespace === 'instatus') return ["Instatus RSS /history.rss is not served by Lamp; change readers to /feed.atom.", "Instatus public JSON /summary.json, /v3/summary.json and /v3/components.json are not served by Lamp. Update API readers to Lamp's native /api/public/status format."];
  return namespace === 'betterstack' ? ["Better Stack RSS /feed.rss and public JSON /index.json are not served by Lamp. Update readers to /feed.atom and the native /api/public/status format."] : ["Statuspage JSON API readers under /api/v2/ receive 404; Lamp does not implement that compatibility API. Update those readers to Lamp's native /api/public/status format.", "Statuspage RSS readers at /history.rss receive 404; change their subscription to /feed.atom."];
}
export const pendingDeadline = (createdAt: string) => new Date(Date.parse(createdAt) + 72 * 60 * 60 * 1000).toISOString();
export function cutoverAddresses(records: PublicAddressCandidate[]) {
  const { aliases, unavailable } = resolvePublicAddresses(records);
  const rows = [...aliases].map(([path, row]) => ({ path, address: row.address, target: row.target }));
  return { rows: rows.slice(0, 25), total: rows.length, unavailable };
}
export function cutoverFromPlan(plan: ImportPlan, asOf: string): CutoverPreview {
  const records = plan.entries.filter(entry => !entry.erased).flatMap(entry => entry.effects.flatMap(effect => {
    if (!['incident', 'maintenance'].includes(effect.targetKind)) return [];
    const tables = (effect.value as unknown as NativeValue).tables;
    const native = tables[effect.targetKind === 'incident' ? 'incidents' : 'maintenance']?.[0];
    const target = `/${effect.targetKind === 'incident' ? 'incidents' : 'maintenance'}/${native?.reference}`;
    if (!isLampPermalink(target)) return [];
    return [{ namespace: entry.source.namespace, sourceId: entry.source.sourceId, targetId: effect.targetId, targetKind: effect.targetKind, target, publicAddresses: (entry.source.payload as { publicAddresses?: string[] }).publicAddresses, shortlink: (entry.source.payload as { raw?: { shortlink?: unknown } }).raw?.shortlink }];
  }));
  const eligible = plan.entries.filter(entry => !entry.erased).flatMap(entry => entry.effects).filter(effect => effect.targetKind === 'subscriber').length;
  return { source: plan.namespace, afterCutover: plan.namespace === "sorry", readerGaps: sourceReaderGaps(plan.namespace), ...cutoverAddresses(records), feeds: [...new Set(plan.entries.flatMap(entry => sourceFeedPaths[entry.source.namespace] ?? []))], invitations: { eligible, claimed: 0, expired: 0, deadline: plan.namespace !== "sorry" && eligible && asOf ? pendingDeadline(asOf) : null, heldUntil: plan.namespace === "sorry" && eligible && asOf ? heldDeadline(asOf) : null } };
}
