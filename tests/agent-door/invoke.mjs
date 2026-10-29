/** Use the production private worker boundary and its real durable queue. */
export default async function invoke({ name, args, who, worker }) {
  const jobs = await worker('LampAgentJobs');
  const id = await jobs.enqueue(name, args, who);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await jobs.result(id);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Native queued invocation did not complete');
}
