// The real dev and auth handlers, with a server-declared owner persona.
import { withDevIdentity } from '../dev/index.mjs';
import { app, config } from './dev-worker.mjs';

const local = withDevIdentity(app, { config, personas: () => [
  { as: 'co-owner', role: 'owner', displayName: 'Local co-owner' },
  { as: 'blocked-owner', role: 'owner', displayName: 'Blocked co-owner' },
] });
export default {
  async fetch(envelope, env, execution) {
    const { url, ...init } = await envelope.json();
    return local.fetch(new Request(url, init), env, execution);
  },
};
