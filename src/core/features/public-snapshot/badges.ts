import type { ComponentState } from "../../shared/domain";
import type { PublicSnapshotModel, SnapshotArtifact } from "./renderer";
import { publicComponentResources } from "./component-address";
import { escapeXml, REPORTING_DAYS } from "./format";

const STATE_COLORS: Record<ComponentState, string> = {
  Operational: "#19865a",
  "Degraded performance": "#c98a12",
  "Partially unavailable": "#b44432",
  "Major outage": "#b44432",
  "Under maintenance": "#4f6fa8",
};

function badge(label: string, message: string, color: string): string {
  const left = Math.max(42, Array.from(label).length * 7 + 12);
  const right = Math.max(42, Array.from(message).length * 7 + 12);
  const width = left + right;
  // Visible text also supplies the accessible name without duplicating prose.
  const body = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" viewBox="0 0 ${width} 20" role="img" aria-labelledby="label value"><rect width="${width}" height="20" rx="3" fill="#44544c"/><path d="M${left} 0h${right - 3}q3 0 3 3v14q0 3-3 3H${left}z" fill="${color}"/><g fill="#fff" text-anchor="middle" font-family="Verdana,Arial,sans-serif" font-size="11"><text id="label" x="${left / 2}" y="14">${escapeXml(label)}</text><text id="value" x="${left + right / 2}" y="14">${escapeXml(message)}</text></g></svg>`;
  if (new TextEncoder().encode(body).byteLength > 2048) throw new Error("A public status badge exceeds the 2 KiB limit.");
  return body;
}

export function renderBadges(model: PublicSnapshotModel): SnapshotArtifact[] {
  const svg = (key: string, label: string, message: string, color: string): SnapshotArtifact => ({ key, body: badge(label, message, color), contentType: "image/svg+xml; charset=utf-8" });
  const artifacts: SnapshotArtifact[] = [
    svg("badge.svg", "status", model.overall, STATE_COLORS[model.overall]),
    { key: "badge.json", body: JSON.stringify({ schemaVersion: 1, label: "status", message: model.overall, color: STATE_COLORS[model.overall], isError: false }), contentType: "application/json; charset=utf-8" },
  ];
  for (const component of model.visibleComponents) {
    const paths = publicComponentResources(component);
    artifacts.push(
      svg(paths.badge.slice(1), component.name, component.state, STATE_COLORS[component.state]),
      svg(paths.uptime.slice(1), `${REPORTING_DAYS}-day uptime`, component.uptime.percentage ?? "No data", component.uptime.percentage === null ? "#5f6d66" : STATE_COLORS[component.state]),
    );
  }
  return artifacts;
}
