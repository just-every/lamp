import type { ComponentState } from "../../shared/domain";
import type { AiProvider, AiSuggestion, AiSuggestionContext, SuggestedField } from "./provider";

const condition: Record<ComponentState, string> = {
  Operational: "working normally",
  "Degraded performance": "slower than usual",
  "Partially unavailable": "partly unavailable",
  "Major outage": "unavailable",
  "Under maintenance": "under planned maintenance",
};

/** Under RER_DEMO, Base's demoEffect answers with a suggestion built from the
 * brief instead of calling a model; outside a demo the real provider answers. */
export function createDemoAiProvider(real: AiProvider | null): AiProvider {
  return {
    async suggestUpdate(context) {
      const { demoEffect } = await import("../../../../modules/demo/index.mjs");
      return demoEffect(
        () => real ? real.suggestUpdate(context) : Promise.reject(new Error("No AI provider is configured.")),
        () => demoSuggestion(context),
      );
    },
  };
}

const field = (text: string, sources: string[], max: number): SuggestedField => ({ text: text.slice(0, max), sources });
const list = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** Like a provider answer, every sentence rests on a cited fact of the brief and
 * nothing promises a next update or a resolution. */
export function demoSuggestion({ incident, whatWeKnow: { alerts, updates, components } }: AiSuggestionContext): AiSuggestion {
  const latest = updates.at(-1);
  const affected = components.filter((component) => component.state !== "Operational");
  const working = components.filter((component) => component.state === "Operational");
  const latestRef = latest ? [latest.ref] : [];
  const audience = latest
    ? field(latest.affectedAudience, latestRef, 250)
    : field(affected.length ? `Customers using ${list(affected.map((component) => component.name))}` : "", affected.map((component) => component.ref), 250);
  const impact = affected.length
    ? field(affected.map((component) => `${component.name} is ${condition[component.state]}.`).join(" "), affected.map((component) => component.ref), 250)
    : field(latest?.customerImpact ?? "", latestRef, 250);
  const stillWorks = working.length
    ? field(`${list(working.map((component) => component.name))} ${working.length > 1 ? "are" : "is"} working normally.`, working.map((component) => component.ref), 250)
    : field(latest?.whatStillWorks ?? "", latestRef, 250);
  const signal = alerts.at(-1);
  const details = latest
    ? field(`We are still working on ${incident.title.toLowerCase()}. ${latest.details}`, latestRef, 500)
    : field(signal ? `Monitoring reported ${signal.title ?? "an alert"}. We are investigating ${incident.title.toLowerCase()}.` : "", signal ? [signal.ref] : [], 500);
  return { affectedAudience: audience, customerImpact: impact, whatStillWorks: stillWorks, details };
}
