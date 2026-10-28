import { z } from 'zod';
import type { ToolDefinition, ToolContext, JsonSchemaObject, ClassAndFacts } from '../../../base/modules/agent-door/types.ts';
import { ToolRefusal } from '../../../base/modules/agent-door/errors.ts';
import { DraftConflictError } from '../incidents/repository';
import { RecoveryCheckError } from '../brief/recovery-check';
import type { IncidentView } from '../incidents/service';
import type { AppServices } from '../../app/services';
import { ulidSchema } from '../../shared/ids';

export const incidentIdInput = z.object({ id: ulidSchema }).strict();
export const draftVersionSchema = z.string().regex(/^(?:[0-9A-HJKMNP-TV-Z]{26}|-):\d+$/);
export const draftIdInput = incidentIdInput.extend({ draft_version: draftVersionSchema }).strict();
export const standard = (): ClassAndFacts[] => [{ class: 'standard', facts: { measure: 1 } }];

export function inputSchema(schema: z.ZodType): JsonSchemaObject {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchemaObject;
}

export function nativeTool(schema: z.ZodType, definition: Omit<ToolDefinition, 'inputSchema' | 'outputSchema' | 'run'> & {
  run(args: Record<string, unknown>, ctx: ToolContext): ReturnType<ToolDefinition['run']>;
}): ToolDefinition {
  return {
    ...definition,
    inputSchema: inputSchema(schema), outputSchema: { type: 'object' },
    async run(args, ctx) {
      try { return await definition.run(schema.parse(args) as Record<string, unknown>, ctx); }
      catch (cause) {
        if (cause instanceof ToolRefusal) throw cause;
        if (cause instanceof RecoveryCheckError) throw new ToolRefusal('recovery_required', cause.message, { recovery: cause.recovery });
        if (cause instanceof DraftConflictError) throw new ToolRefusal('revision_conflict', cause.message);
        if (cause instanceof z.ZodError) throw new ToolRefusal('invalid_arguments');
        if (cause instanceof Error && /requires review by another operator/.test(cause.message)) throw new ToolRefusal('native_review_required', cause.message);
        // An unknown failure may follow a committed publication. Preserve the
        // door's uncertain-execution custody instead of releasing its key.
        throw cause;
      }
    },
  };
}

export async function incident(services: AppServices, id: unknown): Promise<IncidentView> {
  const value = await services.incidents.get(ulidSchema.parse(id));
  if (!value) throw new ToolRefusal('not_found');
  return value;
}
export function version(value: IncidentView): string { return `${value.draft?.id ?? '-'}:${value.updates.length}`; }
export function requireVersion(value: IncidentView, expected: unknown): string {
  if (typeof expected !== 'string') throw new ToolRefusal('draft_version_required');
  if (version(value) !== expected) throw new ToolRefusal('revision_conflict', 'The saved native draft changed.', { current_revision: version(value) });
  return expected;
}
export function incidentLink(id: string) { return [{ uri: `lamp://incidents/${id}`, name: 'Incident' }]; }
