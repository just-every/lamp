import { createRouter } from "@tanstack/react-router";

import { leaveGuardHistory } from "./core/app/client/ui/leave-guard";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // On the server Start brings its own history.
  return createRouter({ routeTree, scrollRestoration: true, history: typeof document === "undefined" ? undefined : leaveGuardHistory() });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
