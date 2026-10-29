import { z } from "zod";
import { COMPONENT_STATES, type ComponentState } from "../../shared/domain";
import { ulidSchema } from "../../shared/ids";

export const alertRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mode: z.enum(["draft", "claim", "claim-and-publish"]),
  state: z.enum(COMPONENT_STATES),
  templateId: ulidSchema.nullable().optional(),
  firingDelaySeconds: z.number().int().min(0).max(86400).default(120),
  recoveryHoldSeconds: z.number().int().min(0).max(86400).default(300),
}).strict();
export type AlertRuleInput = z.infer<typeof alertRuleSchema>;
export interface RuleView {
  id: string; sourceId: string; componentId: string; name: string;
  mode: AlertRuleInput["mode"]; state: ComponentState; templateId: string | null;
  approvedByOperatorId: string; approvedByName: string; degradationReason: string | null;
  firingDelaySeconds: number; recoveryHoldSeconds: number;
  createdAt: string; updatedAt: string;
}
export interface RuleRun {
  id: string; ruleId: string | null; sourceIncidentId: string; incidentId: string;
  mode: "claim" | "claim-and-publish"; firingUpdateId: string | null; recoveryUpdateId: string | null;
  releasedAt: string | null; undoneAt: string | null; undoneByOperatorId: string | null; createdAt: string; updatedAt: string;
}
export interface RuleAutomationPublication {
  sourceId: string; sourceVersion: string;
  runId: string; ruleId: string; phase: "firing" | "recovery"; receiptId: string;
  ruleVersion: string; templateId: string; templateVersion: string; attribution: string;
}
