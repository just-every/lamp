import type { ImportPlan } from '../../../../modules/import-kit/src/d1/index';
import type { NativeValue } from './rows';
import { isLampPermalink, resolvePublicAddresses, sourceFeedPaths, type PublicAddressCandidate } from './public-addresses';

export interface CutoverPreview {
  rows: Array<{ address: string; path: string; target: string }>;
  total: number;
  unavailable: string[];
  feeds: string[];
  invitations: { eligible: number; claimed: number; expired: number; deadline: string | null };
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
    return [{ namespace: entry.source.namespace, sourceId: entry.source.sourceId, targetId: effect.targetId, targetKind: effect.targetKind, target, shortlink: (entry.source.payload as { raw?: { shortlink?: unknown } }).raw?.shortlink }];
  }));
  const eligible = plan.entries.filter(entry => !entry.erased).flatMap(entry => entry.effects).filter(effect => effect.targetKind === 'subscriber').length;
  return { ...cutoverAddresses(records), feeds: [...new Set(plan.entries.flatMap(entry => sourceFeedPaths[entry.source.namespace] ?? []))], invitations: { eligible, claimed: 0, expired: 0, deadline: eligible && asOf ? pendingDeadline(asOf) : null } };
}
