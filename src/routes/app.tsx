import { createFileRoute } from "@tanstack/react-router";

import { loadOperatorSession } from "../core/app/loaders";
import { OperatorShell } from "../core/app/client/ui/app-shell";
import { appIconLinks } from "../core/app/client/ui/app-head";

export const Route = createFileRoute("/app")({
  head: () => ({ links: appIconLinks }),
  loader: ({ location }) => loadOperatorSession({ data: { path: location.pathname } }),
  staleTime: 0,
  preloadStaleTime: 0,
  shouldReload: true,
  component: OperatorApp,
});

function OperatorApp() {
  return <OperatorShell initialSession={Route.useLoaderData()} />;
}
