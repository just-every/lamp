import { createFileRoute } from "@tanstack/react-router";

import { loadOperatorSession } from "../core/app/loaders";
import { OperatorShell } from "../core/app/client/ui/app-shell";

export const Route = createFileRoute("/app")({
  loader: () => loadOperatorSession(),
  component: OperatorApp,
});

function OperatorApp() {
  return <OperatorShell initialSession={Route.useLoaderData()} />;
}
