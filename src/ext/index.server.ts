// BUYER-OWNED SERVER EXTENSIONS — edit only named v1 seams. Upstream updates
// do not modify this file. Example: replace page.status-rollup.v1 with a
// function that returns "Degraded performance" when a buyer-defined state applies.
import type { LampServerExtensions } from "../core/api/extensions";

export const lampServerExtensions = {
  policies: {},
  events: {},
  slots: {},
  adapters: {},
} satisfies LampServerExtensions;
