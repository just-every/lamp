import { z } from "zod";
import { readFileSource } from "../../../../modules/import-kit/src/readers/index.ts";
import type { SavedFile } from "./source";

export const visibilityFiles = new Set(["page.json", "page-access-groups.json"]);
const pageSchema = z.object({
  id: z.string().min(1),
  viewers_must_be_team_members: z.boolean(),
  ip_restrictions: z.string().nullable(),
}).passthrough();

/** MOVE-012: no public import until unchanged management responses establish
 * that neither member/IP restrictions nor audience access groups apply. */
export async function readVisibility(files: SavedFile[]) {
  const page = files.find(file => file.name === "page.json");
  const groups = files.find(file => file.name === "page-access-groups.json");
  if (!page || !groups) throw new Error("Statuspage visibility is unknown. Include page.json and page-access-groups.json; private or audience pages cannot be imported into a public page.");
  let read;
  try {
    read = await readFileSource({ namespace: "statuspage", name: page.name, bytes: new TextEncoder().encode(page.text), format: "json", parse(raw) {
      const value = pageSchema.parse(raw);
      if (value.viewers_must_be_team_members || value.ip_restrictions?.trim()) throw new Error("restricted");
      return { kind: "page", sourceId: value.id, payload: raw };
    } });
    if (read.records.length !== 1 || page.text.trimStart().startsWith("[")) throw new Error("shape");
    // An empty documented access-group list is required, even if the page's
    // team-members flag is false: audience pages can have their own access rules.
    if (!z.array(z.never()).safeParse(JSON.parse(groups.text)).success) throw new Error("audience");
    const groupRead = await readFileSource({ namespace: "statuspage", name: groups.name, bytes: new TextEncoder().encode(groups.text), format: "json", parse() { throw new Error("audience"); } });
    return [...read.artifacts, ...groupRead.artifacts];
  } catch {
    throw new Error("Statuspage visibility is private, restricted, audience-scoped or unknown. Lamp cannot preserve that access, so this import was refused.");
  }
}
