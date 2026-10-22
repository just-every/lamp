import { GroupedForm } from "./grouped-form";
import { PagerDutyForm } from "./pagerduty-form";
import { PresetForm } from "./preset-form";
import { UptimeForm } from "./uptime-form";
import { WebhookForm } from "./webhook-form";
import { freeName, toolLabel, type ComponentOption, type Source, type ToolId } from "./tools";

/** The one open form: a tool being connected (no source yet) or a connected tool being edited. */
export function ToolForm({ tool, source, components, names, onConnected, onSaved, onClose }: { tool: ToolId; source: Source | null; components: ComponentOption[]; names: string[]; onConnected: (created?: Source) => void; onSaved: () => void; onClose: () => void }) {
  const common = { source, components, onSaved, onClose, name: freeName(toolLabel(tool), names) };
  switch (tool) {
    case "uptime": return <UptimeForm {...common} onConnected={() => onConnected()} />;
    case "pagerduty": return <PagerDutyForm {...common} onConnected={created => onConnected(created)} />;
    case "alertmanager": case "grafana": return <GroupedForm {...common} tool={tool} onConnected={() => onConnected()} />;
    case "webhook": return <WebhookForm source={source} onSaved={onSaved} onClose={onClose} onConnected={() => onConnected()} />;
    default: return <PresetForm {...common} tool={tool} onConnected={() => onConnected()} />;
  }
}
