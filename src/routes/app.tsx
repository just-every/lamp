import { createFileRoute, isNotFound, isRedirect } from "@tanstack/react-router";

import { loadOperatorSession, type OperatorSessionView } from "../core/app/loaders";
import { OperatorShell } from "../core/app/client/ui/app-shell";
import { appIconLinks } from "../core/app/client/ui/app-head";

/** The session on show while /app stays open (its staying match carries it); none when /app is entered. The load's
 * matches are read untyped: typed, they would make /app's route type refer to itself. */
function shownSession(load: unknown): { shown?: OperatorSessionView } {
  const { cause, matches } = load as { cause: string; matches: ReadonlyArray<{ routeId: string; loaderData?: unknown }> };
  return { shown: cause === "stay" ? matches.find(match => match.routeId === "/app")?.loaderData as OperatorSessionView | undefined : undefined };
}

export const Route = createFileRoute("/app")({
  head: () => ({ links: appIconLinks }),
  // While /app stays open its session is read again only for another screen, never for a move that stays on the
  // screen (a Settings tab, Back between tabs, the screen's own link). A read again that fails (offline) keeps the
  // session on show, so the open page and its typed edits stay in place of the router's error page; the new screen
  // reads its own data and says what failed.
  beforeLoad: shownSession,
  shouldReload: ({ context, location }) => context.shown?.path !== location.pathname,
  loader: ({ context, location }) => loadOperatorSession({ data: { path: location.pathname } }).catch((cause: unknown) => {
    if (!context.shown || isRedirect(cause) || isNotFound(cause)) throw cause;
    return context.shown;
  }),
  component: OperatorApp,
});

function OperatorApp() {
  return <OperatorShell initialSession={Route.useLoaderData()} />;
}
