import { appApi } from "../../../app/client/ui/api";
import { moveInDoor } from "../../statuspage-import/ui/door-client";
import type { FoundExisting, FoundPage } from "./found-card";

/** The existing page's components the owner kept, by the page's own IDs, with the names they gave them, in their
 * order. A line that still reads as the page named a component is that component; a renamed line keeps the
 * component that stood in its place; any other line is a new component of the owner's own. */
export function keptComponents(page: FoundPage, existing: FoundExisting) {
  const sections = [...page.groups.map((group) => ({ group: group.id as string | null, names: group.components })), { group: null, names: page.components }];
  return sections.flatMap(({ group, names }) => {
    const lines = names.map((name) => name.trim()).filter(Boolean);
    const source = existing.components.filter((component) => component.groupId === group);
    const used = new Set<string>();
    const matched = lines.map((name) => {
      const same = source.find((component) => !used.has(component.id) && component.name === name);
      if (same) used.add(same.id);
      return same ?? null;
    });
    lines.forEach((_, index) => {
      const original = source[index];
      if (!matched[index] && original && !used.has(original.id)) { used.add(original.id); matched[index] = original; }
    });
    return lines.flatMap((name, index) => matched[index] ? [{ id: matched[index].id, name }] : []);
  });
}

/** "Bring its incident history too": Lamp reads the page's public feeds once more, keyless, and Move in imports its
 * past incidents as resolved history, with the components kept here and their groups. Nothing is sent to anyone;
 * Settings → Move in lists the import and can undo it. */
export async function bringHistory(page: FoundPage, existing: FoundExisting) {
  const { files } = await appApi<{ files: Array<{ name: string; text: string }> }>("/api/app/statuspage-import/fetch", { method: "POST", body: JSON.stringify({ source: existing.source, publicUrl: existing.url }) });
  const door = moveInDoor(existing.source);
  const planned = await door.plan<{ planId?: string; fingerprint?: string; report: { state: string } }>({ source: existing.source, files, publicUrl: existing.url, components: keptComponents(page, existing) });
  if (planned.report.state === "already imported") return;
  if (!planned.planId || !planned.fingerprint) throw new Error("Its history could not be read for import.");
  const job = await door.apply(planned.planId, planned.fingerprint);
  if (job.state !== "completed") throw new Error("Its history is still coming across. Continue it from Settings → Move in.");
}
