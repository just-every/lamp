import { z } from "zod";
export const webhookFormatSchema=z.enum(["lamp","statuspage"]);
export type WebhookFormat=z.infer<typeof webhookFormatSchema>;
