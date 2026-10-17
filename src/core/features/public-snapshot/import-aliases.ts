import { aliasArtifactKey, isImportAliasPath, isLampPermalink, resolvePublicAddresses } from "../statuspage-import/public-addresses";
import type { PublicSnapshotSource } from "./repository";
import type { SnapshotArtifact } from "./renderer";

/** Only records included in this generation can be alias destinations. An undo
 * removes the native record or keeps it intact; its aliases follow that decision. */
export function renderImportAliases(source: PublicSnapshotSource, incidents: Array<{ id: string; reference: string }>, maintenance: Array<{ id: string; reference: string }>, history: string): SnapshotArtifact[] {
  const candidates = (source.importedPublicRecords ?? []).flatMap((record) => {
    const native = (record.targetKind === "incident" ? incidents : maintenance).find((item) => item.id === record.targetId);
    if (!native) return [];
    const target = `/${record.targetKind === "incident" ? "incidents" : "maintenance"}/${native.reference}`;
    if (!isLampPermalink(target)) throw new Error(`Invalid imported public permalink: ${target}`);
    return [{ ...record, target }];
  });
  const { aliases } = resolvePublicAddresses(candidates);
  const namespaces = new Set(source.importedNamespaces ?? candidates.map((record) => record.namespace));
  // Sorry owns /history as an old address. Keep its redirect and the final
  // history document together in this generation, with no serving-time DB read.
  const historyArtifacts: SnapshotArtifact[] = namespaces.has("sorry") ? [
    { key: "history.html", body: JSON.stringify({ target: "/history/" }), contentType: "application/vnd.lamp.redirect+json" },
    { key: aliasArtifactKey("/history/"), body: history, contentType: "text/html; charset=utf-8" },
    { key: aliasArtifactKey("/notices"), body: JSON.stringify({ target: "/history/" }), contentType: "application/vnd.lamp.redirect+json" },
  ] : [{ key: "history.html", body: history, contentType: "text/html; charset=utf-8" }, { key: aliasArtifactKey("/history/"), body: history, contentType: "text/html; charset=utf-8" }];
  return [
    ...historyArtifacts,
    ...[...aliases].sort(([a], [b]) => a.localeCompare(b)).map(([path, { target }]) => ({ key: aliasArtifactKey(path), body: JSON.stringify({ target }), contentType: "application/vnd.lamp.redirect+json" })),
  ];
}
