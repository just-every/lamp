import type { ComponentState, IncidentLifecycle } from "../../shared/domain";
import { alertTitle } from "../intake/alert-title";
import type { BriefFacts } from "./repository";

export interface BriefAlert { ref: string; receivedAt: string; source: string; state: "firing" | "recovered"; title: string | null; payload: unknown }
export interface BriefUpdate { ref: string; publishedAt: string; lifecycle: IncidentLifecycle; affectedAudience: string; customerImpact: string; whatStillWorks: string; details: string; nextUpdateAt: string | null }
export interface BriefComponent { ref: string; name: string; state: ComponentState; relationship: string }
export interface BriefQuestion { ref: string; question: string; at?: string }

/** What the operator reads and, unchanged, what an assistant is sent. */
export interface IncidentBrief {
  incident: { reference: string; title: string; lifecycle: IncidentLifecycle; openedAt: string };
  whatWeKnow: { alerts: BriefAlert[]; updates: BriefUpdate[]; components: BriefComponent[] };
  whatWeDoNotKnowYet: BriefQuestion[];
  toneInstructions: string;
}

function parsePayload(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

export function buildIncidentBrief(facts: BriefFacts, now: Date): IncidentBrief {
  const alerts = facts.alerts.map((alert, index): BriefAlert => {
    const payload = parsePayload(alert.payloadJson);
    return { ref: `A${index + 1}`, receivedAt: alert.receivedAt, source: alert.source, state: alert.state, title: alertTitle(alert, payload), payload };
  });
  const updates = facts.updates.map((update, index): BriefUpdate => ({ ref: `U${index + 1}`, ...update }));
  const components = facts.components.map((component, index): BriefComponent => ({ ref: `C${index + 1}`, ...component }));
  const open = facts.incident.lifecycle !== "Resolved";
  const latest = updates.at(-1);
  const latestAlert = alerts.at(-1);
  const questions: BriefQuestion[] = [];
  if (!facts.attachedComponents) questions.push({ ref: "Q-components", question: "Which components are affected? None is attached, so this incident cannot be published." });
  if (!updates.length && !facts.draft?.hasAffectedAudience) questions.push({ ref: "Q-audience", question: "Who is affected? No affected-audience statement is written yet." });
  if (!updates.length && !facts.draft?.hasCustomerImpact) questions.push({ ref: "Q-impact", question: "What is the customer impact? No customer-impact statement is written yet." });
  if (open && facts.draft && facts.draft.lifecycle !== "Resolved" && !facts.draft.nextUpdateAt) questions.push({ ref: "Q-next-update", question: "When will you update next? The draft has no next-update time." });
  if (open && !updates.length && alerts.length) questions.push({ ref: "Q-unpublished-alert", question: "This draft came from an alert and has never been published. Customers see nothing about it yet." });
  if (open && latestAlert?.state === "recovered" && latest?.lifecycle !== "Resolved") questions.push({ ref: "Q-recovery", question: "The monitor reports recovery; confirm, then publish Resolved.", at: latestAlert.receivedAt });
  if (open && latest?.nextUpdateAt && Date.parse(latest.nextUpdateAt) < now.getTime()) questions.push({ ref: "Q-overdue", question: "The next update this incident promised is overdue.", at: latest.nextUpdateAt });
  return { incident: facts.incident, whatWeKnow: { alerts, updates, components }, whatWeDoNotKnowYet: questions, toneInstructions: facts.toneInstructions };
}

/** The references a citation may name: only what we know. An open question (Q-) is not a source, so text resting on
 * one counts as written by the assistant. */
export function briefReferences(brief: IncidentBrief): Set<string> {
  return new Set([...brief.whatWeKnow.alerts, ...brief.whatWeKnow.updates, ...brief.whatWeKnow.components].map((item) => item.ref));
}
