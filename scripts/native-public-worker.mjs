import { readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Both native workers.dev endpoints run the same verified host dispatcher. The
// page Worker shares storage and the app Worker's snapshot object, never its
// scheduled jobs or queue consumer.
export function publicWorkerConfig(config, names) {
  if (config.name !== names.worker) throw new Error('Public Worker must derive from the configured application Worker.');
  const result = structuredClone(config);
  result.name = names.publicWorker;
  result.workers_dev = true;
  delete result.routes;
  delete result.triggers;
  delete result.migrations;
  if (result.queues) delete result.queues.consumers;
  result.durable_objects = { bindings: (result.durable_objects?.bindings ?? []).map(binding => ({ ...binding, script_name: names.worker })) };
  return result;
}

export async function withPublicWorkerConfig(builtPath, names, action) {
  const path = join(dirname(builtPath), 'wrangler.page.json');
  try {
    await writeFile(path, JSON.stringify(publicWorkerConfig(JSON.parse(await readFile(builtPath, 'utf8')), names)), { flag: 'wx' });
    return await action(path);
  } finally { await rm(path, { force: true }); }
}
