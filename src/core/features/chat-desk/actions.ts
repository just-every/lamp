import { z } from 'zod';
import { ulidSchema } from '../../shared/ids';
import { INCIDENT_CLAIM_STATES } from '../../shared/incident-component-changes';
import { incidentDraftSchema, incidentFirstUpdateSchema } from '../../shared/schemas';
const version = z.string().regex(/^(?:[0-9A-HJKMNP-TV-Z]{26}|-):\d+$/);
const component = z.object({ componentId: ulidSchema, state: z.enum(INCIDENT_CLAIM_STATES), relationship: z.enum(['Primary', 'Dependent']).default('Primary') }).strict();
const at = { incidentId: ulidSchema, version };
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('edit'), incidentId: ulidSchema }).strict(),
  z.object({ action: z.literal('open'), title: z.string().trim().min(1).max(250), components: z.array(component).min(1).max(100), update: incidentFirstUpdateSchema.optional() }).strict(),
  z.object({ action: z.literal('attach'), ...at, components: z.array(component).min(1).max(100) }).strict(),
  z.object({ action: z.literal('save'), ...at, update: incidentDraftSchema }).strict(),
  z.object({ action: z.literal('preview'), ...at }).strict(),
  z.object({ action: z.literal('review'), ...at }).strict(),
  z.object({ action: z.literal('publish'), ...at, previewCode: z.string().regex(/^[a-f0-9]{48}$/) }).strict(),
]);
export type DeskAction = z.infer<typeof actionSchema>;
