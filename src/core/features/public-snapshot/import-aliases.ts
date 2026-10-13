import { aliasArtifactKey, isLampPermalink, sourceFeedPaths, resolvePublicAddresses } from "../statuspage-import/public-addresses";
import type { PublicSnapshotSource } from "./repository";
import type { SnapshotArtifact } from "./renderer";

/** Only records included in this generation can be alias destinations. An undo
 * removes the native record or keeps it intact; its aliases follow that decision. */
export function renderImportAliases(source: PublicSnapshotSource, incidents: Array<{ id: string; reference: string }>, maintenance: Array<{ id: string; reference: string }>, feed: string): SnapshotArtifact[] {
  const candidates = (source.importedPublicRecords ?? []).flatMap((record) => {
    const native = (record.targetKind === "incident" ? incidents : maintenance).find((item) => item.id === record.targetId);
    if (!native) return [];
    const target = `/${record.targetKind === "incident" ? "incidents" : "maintenance"}/${native.reference}`;
    if (!isLampPermalink(target)) throw new Error(`Invalid imported public permalink: ${target}`);
    return [{ ...record, target }];
  });
  const { aliases } = resolvePublicAddresses(candidates);
  const namespaces = new Set(source.importedNamespaces ?? candidates.map((record) => record.namespace));
  return [
    ...[...aliases].sort(([a], [b]) => a.localeCompare(b)).map(([path, { target }]) => ({ key: aliasArtifactKey(path), body: JSON.stringify({ target }), contentType: "application/vnd.lamp.redirect+json" })),
    ...[...namespaces].flatMap((namespace) => (sourceFeedPaths[namespace] ?? []).map((path) => ({ key: aliasArtifactKey(path), body: feed, contentType: "application/atom+xml; charset=utf-8" }))),
  ];
}
