import { z } from "zod";
import { ulidSchema } from "../../shared/ids";
import { hasSafeWebhookDestination, normalizeEmail } from "./destination";

const componentIds=z.array(ulidSchema).max(200).default([]).transform(values=>[...new Set(values)]);
export const subscriberAddSchema=z.discriminatedUnion("channel",[
  z.object({channel:z.literal("email"),email:z.email().max(320).transform(normalizeEmail),componentIds}).strict(),
  z.object({channel:z.literal("webhook"),destination:z.url().max(2048).refine(hasSafeWebhookDestination,"Use a public HTTPS webhook URL without credentials or a port."),contactEmail:z.email().max(320).transform(normalizeEmail),componentIds}).strict(),
]);
export type SubscriberAddInput=z.infer<typeof subscriberAddSchema>;
export interface IntakeRow { row:number;channel:"email"|"webhook";destination:string;contactEmail:string|null;componentIds:string[] }
export interface IntakeDecision {row:number;outcome:"created"|"skipped"|"refused";reason:string|null}
export interface IntakeCounts {created:number;skipped:number;refused:number}
export interface IntakePreview {fingerprint:string;counts:IntakeCounts;rows:IntakeDecision[]}
export interface IntakeApply {batchId:string;counts:IntakeCounts;subscriberIds:string[]}
export class SubscriberIntakeError extends Error {
  constructor(message:string,readonly status:400|403|409|413|503=400) {super(message);this.name="SubscriberIntakeError";}
}
