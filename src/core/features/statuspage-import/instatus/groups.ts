import { componentSchema, type InstatusComponent } from "./schema";

/** A visual parent is a Component with isParent, never an audience group. */
export function resolveInstatusGroups(rows: InstatusComponent[]) {
  const groups = new Map<string, InstatusComponent>();
  const children = new Map<string, InstatusComponent>();
  const parentOf = new Map<string, string>();
  const signature = (row: InstatusComponent) => JSON.stringify([row.name, row.description ?? "", row.order ?? 0, row.groupId ?? null, row.createdAt ?? null, row.updatedAt ?? null, row.archivedAt ?? null, row.siteId ?? null]);
  function visit(row: InstatusComponent, ancestors: Set<string>) {
    if (ancestors.has(row.id) || ancestors.size > 32) throw new Error("Instatus component grouping contains a cycle or exceeds 32 levels.");
    if (row.archivedAt || row.private === true || row.useAllowList === true || row.secureLink || (Array.isArray(row.allowList) && row.allowList.length) || (Array.isArray(row.audienceGroups) && row.audienceGroups.length) || row.shouldPublish === false || row.published === false || row.isPublished === false || row.draft === true) throw new Error("Archived, unpublished or restricted Instatus components and visual groups cannot be made public.");
    const next = new Set([...ancestors, row.id]);
    const parsed = row.group == null ? null : componentSchema.safeParse(row.group);
    if (parsed && !parsed.success) throw new Error("Instatus visual group has an invalid parent component shape.");
    const parent = parsed?.success ? parsed.data : null;
    if (parent && parent.isParent !== true) throw new Error("Instatus embedded visual groups must identify their parent component.");
    if (parent && row.groupId !== undefined && row.groupId !== parent.id) throw new Error("Instatus component group and groupId disagree.");
    const parentId = row.groupId ?? parent?.id;
    if (parentId) parentOf.set(row.id, parentId);
    const target = row.isParent ? groups : children;
    const prior = target.get(row.id);
    if (prior && signature(prior) !== signature(row)) throw new Error("Instatus contains conflicting component or group records.");
    target.set(row.id, row);
    if (parent) visit(parent, next);
  }
  rows.forEach((row) => visit(row, new Set()));
  for (const [id, parent] of parentOf) {
    if (!groups.has(parent)) throw new Error("Instatus component refers to a visual group missing from the saved responses.");
    const visited = new Set([id]);
    let cursor: string | undefined = parent;
    while (cursor) {
      if (visited.has(cursor)) throw new Error("Instatus component grouping contains a cycle.");
      visited.add(cursor); cursor = parentOf.get(cursor);
    }
    if (groups.has(id)) throw new Error("Instatus nested visual groups cannot be represented by Lamp's single group level.");
  }
  for (const id of groups.keys()) if (children.has(id)) throw new Error("Instatus component is inconsistently marked as a visual parent.");
  return { groups: [...groups.values()], components: [...children.values()], parentOf };
}
