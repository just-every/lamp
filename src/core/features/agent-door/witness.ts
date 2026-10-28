import type { AppBindings } from "../../app/types";
import type { AppServices } from "../../app/services";
import { ToolRefusal } from "../../../base/modules/agent-door/index.ts";
import type { ToolDefinition } from "../../../base/modules/agent-door/types.ts";
import { createAgentResourceRepository } from "./resources/repository";

const canonical = (value: unknown): string => value === null || typeof value !== "object" ? JSON.stringify(value) ?? "null"
  : Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(canonical(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** A passive witness of durable native state, not a status/recovery probe.
 * Product payloads and credentials never appear in the returned fingerprints. */
export function nativeWitness(bindings: AppBindings, _services: AppServices): ToolDefinition {
  const repository = createAgentResourceRepository(bindings.DB);
  return {
    name: "lamp.evidence.read", title: "Read native change evidence", description: "Read retained native object counts and redacted state fingerprints without running work or contacting a provider.",
    scope: "lamp:read", readOnly: true, classes: ["standard"], clauses: ["AGENT-008"],
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object", properties: { tables: { type: "object" }, publicSnapshot: { type: ["object", "null"] } }, required: ["tables", "publicSnapshot"], additionalProperties: false },
    classify: () => [{ class: "standard", facts: { measure: 1 } }],
    async run(_args, ctx) {
      if (!await repository.admitted(ctx, "evidence")) throw new ToolRefusal("resource_unavailable");
      const rows = await repository.nativeRows();
      const tables: Record<string, { count: number; sha256: string }> = {};
      for (const [name, values] of Object.entries(rows)) {
        const ordered = values.map(canonical).sort();
        tables[name] = { count: values.length, sha256: await digest(ordered) };
      }
      // Read the retained R2 pointer directly. Reading via the public HTTP route
      // would itself count traffic; using the service can touch derived caches.
      const pointer = await bindings.SNAPSHOTS.get("snapshots/current.json");
      const publicSnapshot = pointer ? { sha256: await digest(await pointer.text()) } : null;
      return { result: { tables, publicSnapshot } };
    },
  };
}
