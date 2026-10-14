// `rer demo` resolves the Worker's `cloudflare:sockets` imports here (vite.mjs):
// connect answers loopback hosts only, and a refusal is recorded like fetch's.
import { guardConnect } from './index.mjs';

// Vite would resolve a static import of it back to this file; a computed
// specifier reaches the runtime's own module.
const runtime = 'cloudflare:sockets';
const { connect: open } = await import(/* @vite-ignore */ runtime);

export function connect(address, options) {
  guardConnect(address);
  return open(address, options);
}
