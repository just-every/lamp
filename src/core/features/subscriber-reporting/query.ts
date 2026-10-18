import { z } from "zod";
import type { ReportingRange } from "./types";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const year = Number(value.slice(0, 4));
  return year >= 1000 && year <= 9998 && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}, "Choose a real date (YYYY-MM-DD).");
export const reportingQuery = z.object({
  month: z.string().regex(/^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/).refine(value => Number(value.slice(0, 4)) <= 9998).optional(),
  from: day.optional(), to: day.optional(),
  channel: z.enum(["email", "webhook", "teams"]).optional(),
  format: z.enum(["json", "csv"]).optional(),
}).strict().superRefine((value, context) => {
  if (value.month && (value.from || value.to)) context.addIssue({ code: "custom", message: "Choose a month or a date range." });
  if (Boolean(value.from) !== Boolean(value.to)) context.addIssue({ code: "custom", message: "Supply both from and to dates." });
  if (value.from && value.to) {
    const days = (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000;
    if (days < 1 || days > 366) context.addIssue({ code: "custom", message: "Choose a range of 1 to 366 days; to is exclusive." });
  }
});

export function reportingRange(input: z.infer<typeof reportingQuery>, now = new Date().toISOString()): ReportingRange {
  if (input.from && input.to) return { from: input.from, to: input.to, channel: input.channel };
  const month = input.month ?? now.slice(0, 7);
  const from = `${month}-01`, next = new Date(`${from}T00:00:00.000Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: next.toISOString().slice(0, 10), channel: input.channel };
}
