import type { ToolDefinition } from '../../../../modules/agent-door/types.ts';
import { createAgentWitnessRepository } from './witness.repository';

export function createWitnessTool(db: D1Database): ToolDefinition {
  const repository = createAgentWitnessRepository(db);
  return {
    name: 'lamp.workspace.snapshot', title: 'Read native change evidence',
    description: 'Read deterministic native record digests without running checks, dispatching, or revealing private fields.',
    scope: 'lamp.workspace.snapshot', readOnly: true, classes: ['standard'], clauses: ['AGENT-008', 'TEAM-007'],
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    outputSchema: {type: 'object', properties: {records: {type: 'object'}}, required: ['records']},
    classify: () => [{class: 'standard', facts: {measure: 1}}],
    async run() { return {result: await repository.snapshot()}; },
  };
}
