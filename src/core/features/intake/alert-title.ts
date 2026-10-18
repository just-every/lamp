import { isGroupedPreset, readGroupedAlerts } from "./grouped-alerts";
import { readPreset, type AlertPreset } from "./presets";

export function readPath(payload: unknown, path: string): unknown {
  const clean = path.replace(/^\$\.?/, "");
  if (!clean) return payload;
  return clean.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean).reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object") return undefined;
    if (Array.isArray(value)) return /^\d+$/.test(segment) ? value[Number(segment)] : undefined;
    return (value as Record<string, unknown>)[segment];
  }, payload);
}

/** The title a source's own mapping reads from an accepted alert, or null. */
export function alertTitle(source: { preset: AlertPreset | null; titlePath: string }, payload: unknown): string | null {
  if (isGroupedPreset(source.preset)) { const reading = readGroupedAlerts(source.preset, payload, []); return "refused" in reading ? null : reading.title; }
  if (source.preset) {
    const reading = readPreset(source.preset, payload);
    return "refused" in reading ? null : reading.title;
  }
  const title = readPath(payload, source.titlePath);
  return typeof title === "string" && title.trim() ? title.trim().slice(0, 250) : null;
}
