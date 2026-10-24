import { z } from "zod";
const timing=z.object({monitorId:z.string().min(1),observedAt:z.number().int().nonnegative(),webhookContext:z.object({responseTimeMs:z.number().finite().min(0).max(1e12)})});
/** Called only after the real authenticated Uptime intake accepts the envelope.
 * A firing/recovery event is not a continuous series: never invent healthy
 * observations between events, or derive timings from an incident duration. */
export function readUptimeTiming(payload:unknown) {
  const parsed=timing.safeParse(payload);
  return parsed.success?{monitorId:parsed.data.monitorId,point:{at:Math.floor(parsed.data.observedAt/60_000)*60_000,value:parsed.data.webhookContext.responseTimeMs}}:null;
}
