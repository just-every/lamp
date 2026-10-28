import { z } from 'zod';
import { ToolRefusal } from '../../../../modules/agent-door/errors.ts';
import type { JsonSchemaObject, ToolContext, ToolDefinition } from '../../../../modules/agent-door/types.ts';

/** Discovery uses the native editor's schema. The validator still runs before
 * touching the native service, including its refinements and transforms. */
export function nativeSchema(input: z.ZodType): JsonSchemaObject {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(input, { io: 'input', unrepresentable: 'any' });
  return schema as JsonSchemaObject;
}
export const idField = z.string().min(1).max(100);
export const objectResult = { type: 'object' } as const;
export function nativeValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new ToolRefusal('not_found');
  return value;
}
export function parseNative<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ToolRefusal('invalid_arguments');
  return result.data;
}
export function catalogueTool(tool: ToolDefinition): ToolDefinition {
  return { ...tool, scope: tool.name, untrusted: tool.untrusted ?? true };
}
export async function nativeEffect<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (cause) {
    if (cause instanceof ToolRefusal) throw cause;
    if (cause instanceof z.ZodError) throw new ToolRefusal('invalid_arguments');
    throw new ToolRefusal('native_refused', cause instanceof Error ? cause.message : 'The native operation refused.');
  }
}
export const nativeResource = (uri: string, name: string) => [{ uri, name }];
export function emitNative(ctx: ToolContext, type: string, uri: string) {
  ctx.emit(type, uri, { prepared_by: ctx.actor, approvers: ctx.approvers });
}
