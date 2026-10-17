import { z } from "zod";
import { renderUpdateHtml } from "../../shared/update-links";

export const maintenanceWordingSchema = z.object({
  affectedAudience: z.string().trim().max(250), customerImpact: z.string().trim().max(250),
  whatStillWorks: z.string().trim().max(250).default(""), details: z.string().trim().max(500).default(""),
});
export type MaintenanceWording = z.infer<typeof maintenanceWordingSchema>;
export const maintenanceUpdateSchema = maintenanceWordingSchema.extend({
  state: z.enum(["Scheduled", "In progress", "Verifying", "Completed"]),
  channels: z.array(z.enum(["email", "webhook", "chat"])).max(3).default(["email", "webhook", "chat"]),
  correctsNoticeId: z.string().nullable().default(null),
  autoStart: z.boolean().optional(), autoComplete: z.boolean().optional(), remindPrior: z.boolean().optional(),
}).strict();
export type MaintenanceUpdateInput = z.infer<typeof maintenanceUpdateSchema>;
export interface NoticeSnapshot extends MaintenanceWording {
  title: string; reference: string; state: string; startsAt: string; endsAt: string; calendarSequence: number;
}
export function wordingText(wording: Partial<MaintenanceWording>) {
  return [["Affected audience", wording.affectedAudience], ["Customer impact", wording.customerImpact], ["What still works", wording.whatStillWorks], ["Details", wording.details]]
    .flatMap(([label, value]) => value ? [`${label}: ${value}`] : []).join("\n\n");
}
export function renderMaintenanceNotice(input: NoticeSnapshot, kind: string) {
  const plainText = [`${input.reference}: ${input.title}`, `Status: ${input.state}`, `Notice: ${kind}`, `Start: ${input.startsAt}`, `End: ${input.endsAt}`, wordingText(input)].filter(Boolean).join("\n\n");
  return { plainText, html: `<pre>${renderUpdateHtml(plainText)}</pre>` };
}
export function assertWording(input: MaintenanceWording, required: boolean) {
  const parsed = maintenanceWordingSchema.safeParse(input);
  if (!parsed.success || (required && (!input.affectedAudience.trim() || !input.customerImpact.trim()))) throw new Error("Affected audience and customer impact are required (250 characters each); what still works allows 250 and details 500.");
}
