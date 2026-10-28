import { z } from "zod";
import { ulidSchema } from "../../shared/ids";
export const credentialsSchema = z.object({ key: z.string().trim().min(1).max(2000), applicationKey: z.string().trim().min(1).max(2000).optional() }).strict();
const fields = {
  name: z.string().trim().min(1).max(80), unit: z.string().trim().min(1).max(24),
  query: z.string().trim().max(1000).default(""), endpoint: z.string().url().max(1000).nullable().default(null),
  accountId: z.string().regex(/^\d+$/).max(20).nullable().default(null), region: z.string().max(32).nullable().default(null),
};
export const metricSchema = z.object({ componentId: ulidSchema, sourceId: ulidSchema.nullable().default(null), provider: z.enum(["push","uptime","datadog","newrelic","pingdom","prometheus"]), ...fields, credentials: credentialsSchema.optional() }).strict();
export const metricPatchSchema = z.object({
  name: fields.name.optional(), unit: fields.unit.optional(), query: z.string().trim().max(1000).optional(),
  endpoint: z.string().url().max(1000).nullable().optional(), accountId: z.string().regex(/^\d+$/).max(20).nullable().optional(),
  region: z.string().max(32).nullable().optional(), credentials: credentialsSchema.nullable().optional(),
}).strict();
export const pointsSchema = z.object({ points: z.array(z.object({
  at: z.number().int().min(0).max(8640000000000000).refine(value => value % 60_000 === 0, "Use the UTC minute start."),
  value: z.number().finite().min(-1e12).max(1e12),
}).strict()).min(1).max(1440) }).strict();
export type MetricInput = z.infer<typeof metricSchema>;
export type MetricPatch = z.infer<typeof metricPatchSchema>;
