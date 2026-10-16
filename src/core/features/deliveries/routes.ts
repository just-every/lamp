import type { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../../app/types";
import { handleSendGridEvents } from "./sendgrid-events";
import { verifyResendWebhook } from "../../platform/mail";
import { DELIVERY_CHANNELS, DELIVERY_OUTCOMES } from "../../shared/domain";
import { ulidSchema } from "../../shared/ids";
import type { DeliveriesService } from "./service";

const deliveriesQuerySchema = z.object({
  channel: z.enum(DELIVERY_CHANNELS).optional(),
  outcome: z.enum(DELIVERY_OUTCOMES).optional(),
  incidentUpdateId: ulidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
}).strict();

function csvCell(value: string | null) {
  const protectedValue = value && /^[=+\-@]/.test(value) ? `'${value}` : value ?? "";
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function isHardResendBounce(bounceType: string | undefined) {
  // Resend names non-recoverable bounces "Permanent". Retain "hard" for
  // previously recorded providers during an adapter transition.
  const normalized = bounceType?.trim().toLowerCase();
  return normalized === "permanent" || normalized === "hard";
}

export function registerDeliveryRoutes(app: Hono<AppEnv>, service: DeliveriesService, options: { resendWebhookSecret?: string; sendGridWebhookPublicKey?: string; relaySecret?: string; mailProvider?: "rer" | "resend" | "sendgrid"; localMail?: boolean } = {}) {
  const mailProvider = options.mailProvider ?? "resend";
  const receiptsConfigured = mailProvider === "sendgrid"
    ? Boolean(options.sendGridWebhookPublicKey?.trim() || options.relaySecret?.trim())
    : mailProvider === "resend" && Boolean(options.resendWebhookSecret?.trim());
  app.get("/api/app/deliveries", async (context) => {
    const parsed = deliveriesQuerySchema.safeParse(context.req.query());
    if (!parsed.success) return context.json({ error: "Invalid delivery query.", issues: parsed.error.issues }, 400);
    const rows = await service.list({ ...parsed.data, limit: parsed.data.limit + 1 });
    return context.json({
      deliveries: rows.slice(0, parsed.data.limit),
      mail: { provider: mailProvider, local: options.localMail === true, receiptsConfigured: !options.localMail && receiptsConfigured },
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      hasMore: rows.length > parsed.data.limit,
    });
  });
  app.get("/api/app/deliveries.csv", async (context) => {
    const parsed = deliveriesQuerySchema.safeParse(context.req.query());
    if (!parsed.success) return context.json({ error: "Invalid subscriber query.", issues: parsed.error.issues }, 400);
    const rows = await service.export(parsed.data);
    const csv = ["destination,channel,outcome,incidentUpdateId,queuedAt,outcomeAt,providerAcceptedAt,maintenanceReference,maintenanceTitle,maintenanceNoticeKind", ...rows.map((row) => [row.destination, row.channel, row.outcome, row.incidentUpdateId ?? null, row.queuedAt, row.outcomeAt, row.providerAcceptedAt, row.maintenanceReference, row.maintenanceTitle, row.maintenanceNoticeKind].map(csvCell).join(","))].join("\n");
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=lamp-deliveries.csv", "Cache-Control": "no-store" } });
  });
  app.post("/api/intake/mail-events", async (context) => {
    if (mailProvider === "rer") return context.text("Mail delivery webhooks are not configured.", 503);
    if (options.mailProvider === "sendgrid") return handleSendGridEvents(context.req.raw, options.sendGridWebhookPublicKey, service, options.relaySecret);
    if (!options.resendWebhookSecret) return context.text("Mail delivery webhooks are not configured.", 503);
    const raw = await context.req.text();
    const verified = await verifyResendWebhook({ secret: options.resendWebhookSecret, id: context.req.header("svix-id"), timestamp: context.req.header("svix-timestamp"), signature: context.req.header("svix-signature"), rawBody: raw });
    if (!verified) return context.text("Invalid mail provider signature.", 401);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return context.text("Malformed mail provider event.", 400);
    }
    const event = z.object({ type: z.string(), data: z.object({ email_id: z.string().optional(), bounce: z.object({ type: z.string().optional() }).optional() }).passthrough() }).passthrough().safeParse(payload);
    if (!event.success) return context.text("Malformed mail provider event.", 400);
    const type = event.data.type === "email.delivered" ? "delivered" : event.data.type === "email.complained" ? "complained" : event.data.type === "email.bounced" ? "bounced" : null;
    if (type) await service.handleProviderEvent({ id: context.req.header("svix-id")!, providerMessageId: event.data.data.email_id ?? null, type, hardBounce: isHardResendBounce(event.data.data.bounce?.type) });
    return context.body(null, 200);
  });
}
