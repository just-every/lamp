import { env } from "cloudflare:workers";

import type { AppBindings } from "../app/types";

// Start server functions obtain bindings from the Worker environment rather
// than accepting caller-controlled values over their generated transport.
export function requestBindings(): AppBindings {
  return env as unknown as AppBindings;
}
