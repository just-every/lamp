import { WorkerEntrypoint } from 'cloudflare:workers';
import type { InvocationIdentity } from '../../../../modules/agent-door/types.ts';
import type { AppBindings } from '../../app/types';
import { createAgentJobsRepository } from './jobs.repository';

/** Private service binding for native workers; there is no HTTP invoke route. */
export class LampAgentJobs extends WorkerEntrypoint<AppBindings> {
  async enqueue(name: string, args: Record<string, unknown>, who: InvocationIdentity) {
    const id = await createAgentJobsRepository(this.env.DB).retain({ name, args, who });
    await this.env.JOBS.send({ type: 'agent-invocation', id });
    return id;
  }
  async result(id: string) {
    return (await createAgentJobsRepository(this.env.DB).read(id))?.result ?? null;
  }
}
