import { withVisualEdits } from '../editor/VisualEditBoundary';
import { createFileRoute } from "@tanstack/react-router";

import { loadSignInConfig } from "../core/app/loaders";
import { SignInPage } from "../core/app/client/ui/app-shell";

export const Route = createFileRoute("/signin")({
  loader: () => loadSignInConfig(),
  component: withVisualEdits(SignIn),
});

function SignIn() {
  return <SignInPage publicPageOrigin={Route.useLoaderData().publicPageOrigin} />;
}
