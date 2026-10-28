import type { AgentDoor, PeopleAdapter } from '../../../../modules/agent-door/types.ts';
import { createAgentWitnessRepository } from './witness.repository';

/** Actual person API writes share the retained event vocabulary with tools. */
export async function withNativePersonEvents(request: Request, db: D1Database, people: PeopleAdapter,
  door: AgentDoor, action: () => Promise<Response>) {
  const path = new URL(request.url).pathname;
  if (['GET','HEAD','OPTIONS'].includes(request.method) || !(path.startsWith('/api/app/') || path.startsWith('/api/operator/import/'))) return action();
  const person = await people.session(request);
  if (!person?.active) return action();
  const repository = createAgentWitnessRepository(db), before = await repository.snapshot();
  const response = await action();
  if (!response.ok) return response;
  const after = await repository.snapshot(), changes = new Map<string,string>();
  for (const table of new Set([...Object.keys(before.records), ...Object.keys(after.records)])) {
    const prior = new Map((before.records[table] ?? []).map(row => [row.id,row]));
    const next = new Map((after.records[table] ?? []).map(row => [row.id,row]));
    for (const id of new Set([...prior.keys(), ...next.keys()])) {
      const a = prior.get(id), b = next.get(id);
      if (a?.digest === b?.digest) continue;
      const event = b?.event ?? a?.event;
      if (event) changes.set(event.uri,event.type);
    }
  }
  for (const [uri,type] of changes) await door.emit({uri,type,person});
  return response;
}
