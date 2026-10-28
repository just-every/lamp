import { z } from 'zod';
import type { JsonSchemaObject, ToolContext, ClassAndFacts } from '../../../base/modules/agent-door/types.ts';
import { ToolRefusal } from '../../../base/modules/agent-door/index.ts';

export const idInput = z.object({ id: z.string().min(1).max(200) }).strict();
export const emptyInput = z.object({}).strict();
export const jsonInput = (schema: z.ZodType): JsonSchemaObject => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchemaObject;
export const recordOutput = (key: string) => ({ type: 'object', properties: { [key]: { type: 'object' } }, required: [key], additionalProperties: false });
export const arrayOutput = (key: string) => ({ type: 'object', properties: { [key]: { type: 'array', items: { type: 'object' } } }, required: [key], additionalProperties: false });
export const standard = (): ClassAndFacts => ({ class: 'standard', facts: { measure: 1 } });
export const live = (service: string): ClassAndFacts => ({ class: 'live', facts: { measure: 1, service } });
export const publicDisclosure = (measure = 1): ClassAndFacts => ({ class: 'external', facts: { measure, counterparty: 'public' } });
export function required<T>(record: T | null | undefined): T {
  if (record == null) throw new ToolRefusal('not_found');
  return record;
}
export function nativeFailure(error: unknown): never {
  if (error instanceof ToolRefusal) throw error;
  if (error instanceof z.ZodError) throw new ToolRefusal('invalid_arguments');
  // Unknown failures may follow a committed native write. Preserve the door's
  // uncertain execution receipt instead of making this operation retryable.
  throw error;
}
export function changed(ctx: ToolContext, type: string, uri: string, data?: Record<string, unknown>) {
  ctx.emit(type, uri, data);
}
