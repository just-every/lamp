import { createFileRoute } from "@tanstack/react-router";

import { loadOperatorSession } from "../core/app/loaders";
import { FirstRunPage } from "../core/features/setup/ui/first-run-page";
import { appIconLinks } from "../core/app/client/ui/app-head";
import { AppDataContext } from "../core/app/client/ui/api";

export const Route = createFileRoute("/setup")({
  loader: () => loadOperatorSession({ data: { path: "/app/setup" } }),
  // Lamp's declared theme (public/rer-theme.css), the tokens Base's installer wears too, and mark 18's icon.
  head: () => ({ links: [...appIconLinks, { rel: "stylesheet", href: "/rer-theme.css" }] }),
  component: FirstRun,
});

function FirstRun() {
  const session = Route.useLoaderData();
  return <AppDataContext.Provider value={session.data}><FirstRunPage ownerId={session.operator.id} publicPageOrigin={session.publicPageOrigin} /></AppDataContext.Provider>;
}
