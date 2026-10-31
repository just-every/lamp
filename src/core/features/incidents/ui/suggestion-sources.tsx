import type { IncidentBrief } from "../../brief/build";
import { Icon } from "../../../app/client/ui/icon";
import { useOperatorTime } from "../../../app/client/ui/states";
import { revealInPanel } from "./incident-panel";

export type SuggestedFieldName = "affectedAudience" | "customerImpact" | "whatStillWorks" | "details";
/** What the last suggestion wrote, by field, with the brief references each field rests on. */
export interface AppliedSuggestion { brief: IncidentBrief; fields: Partial<Record<SuggestedFieldName, string[]>> }

function describe(ref: string, brief: IncidentBrief, formatTime: (iso: string | null) => string) {
  const { alerts, updates, components } = brief.whatWeKnow;
  const alert = alerts.find((item) => item.ref === ref);
  if (alert) return `${alert.state === "recovered" ? "Recovery" : "Alert"} from ${alert.source} at ${formatTime(alert.receivedAt)}`;
  const update = updates.find((item) => item.ref === ref);
  if (update) return `${update.lifecycle} update published ${formatTime(update.publishedAt)}`;
  const component = components.find((item) => item.ref === ref);
  if (component) return `${component.name}: ${component.state}`;
  return brief.whatWeDoNotKnowYet.find((item) => item.ref === ref)?.question ?? ref;
}

// The brief keeps each item at #brief-<ref>; opening a source opens the brief's row and the item there.
const openSource = (ref: string) => revealInPanel(`brief-${ref}`);

export function SuggestionSources({ field, applied }: { field: SuggestedFieldName; applied: AppliedSuggestion | null }) {
  const formatTime = useOperatorTime();
  const refs = applied?.fields[field];
  if (!applied || !refs) return null;
  if (!refs.length) return <p className="field-sources is-unsourced"><Icon name="warning" width={16} height={16} />No source: written by the assistant, check it.</p>;
  return <p className="field-sources">From {refs.map((ref, index) => <span key={ref}>{index ? ", " : ""}<a href={`#brief-${ref}`} onClick={(event) => { event.preventDefault(); openSource(ref); }}><b>{ref}</b> {describe(ref, applied.brief, formatTime)}</a></span>)}</p>;
}
