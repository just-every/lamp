/** Source compatibility lives here; these are paths on the moved public host,
 * never authority to redirect or serve a source-owned hostname. */
import { sourceFeedPaths, isImportAliasPath } from "./public-paths.mjs";
export { sourceFeedPaths, isImportAliasPath, isLampPermalink } from "./public-paths.mjs";
export function sourcePublicAddresses(sourceId: string, shortlink: unknown): Array<{ address: string; path: string }> {
  if (!/^[A-Za-z0-9_-]+$/u.test(sourceId)) throw new Error(`Source incident ${sourceId}: unsafe public address.`);
  const addresses = [{ address: `/incidents/${sourceId}`, path: `/incidents/${sourceId}` }];
  if (shortlink !== undefined && shortlink !== null && shortlink !== "") {
    if (typeof shortlink !== "string") throw new Error(`Source incident ${sourceId}: invalid shortlink.`);
    let path = shortlink;
    if (!shortlink.startsWith("/")) {
      let url: URL;
      try { url = new URL(shortlink); } catch { throw new Error(`Source incident ${sourceId}: unsafe shortlink ${shortlink}.`); }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.href !== shortlink) throw new Error(`Source incident ${sourceId}: unsafe shortlink ${shortlink}.`);
      path = url.pathname;
    }
    addresses.push({ address: shortlink, path });
  }
  for (const item of addresses) if (!isImportAliasPath(item.path) || Object.values(sourceFeedPaths).some((paths) => paths.includes(item.path))) throw new Error(`Source incident ${sourceId}: public address ${item.address} is unsafe or reserved by Lamp.`);
  return addresses.filter((item, index) => addresses.findIndex((other) => other.path === item.path) === index);
}
export const aliasArtifactKey = (path: string) => `aliases/${encodeURIComponent(path)}.json`;
export interface ImportedPublicRecord { namespace: string; sourceId: string; targetKind: string; targetId: string; shortlink?: unknown }

/** Inspect old passthrough data without losing a safe canonical incident path. */
export function inspectSourcePublicAddresses(sourceId: string, shortlink: unknown) {
  let addresses: ReturnType<typeof sourcePublicAddresses> = [];
  const unavailable: string[] = [];
  try { addresses = sourcePublicAddresses(sourceId, undefined); }
  catch (cause) { return { addresses, unavailable: [cause instanceof Error ? cause.message : String(cause)] }; }
  if (shortlink === undefined || shortlink === null || shortlink === "") unavailable.push(`Source incident ${sourceId}: no shortlink retained; shortlink unavailable.`);
  try { addresses = sourcePublicAddresses(sourceId, shortlink); }
  catch (cause) { unavailable.push(cause instanceof Error ? cause.message : String(cause)); }
  return { addresses, unavailable };
}

export interface PublicAddressCandidate extends ImportedPublicRecord { target: string }
/** Legacy journals predate alias validation. Name unavailable addresses and
 * omit every side of a collision, rather than withholding the status snapshot. */
export function resolvePublicAddresses(records: PublicAddressCandidate[]) {
  const aliases = new Map<string, { target: string; address: string; sourceId: string }>();
  const conflicts = new Set<string>();
  const unavailable: string[] = [];
  for (const record of records) {
    const inspected = inspectSourcePublicAddresses(record.sourceId, record.shortlink);
    unavailable.push(...inspected.unavailable);
    const { addresses } = inspected;
    for (const item of addresses) {
      if (conflicts.has(item.path)) continue;
      const previous = aliases.get(item.path);
      if (previous && previous.target !== record.target) {
        unavailable.push(`Public address ${item.path} conflicts between ${previous.sourceId} and ${record.sourceId}; alias unavailable.`);
        conflicts.add(item.path); aliases.delete(item.path); continue;
      }
      aliases.set(item.path, { target: record.target, address: item.address, sourceId: record.sourceId });
    }
  }
  return { aliases, unavailable };
}
