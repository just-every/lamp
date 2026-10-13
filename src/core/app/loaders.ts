import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";

import { publicPageOrigin } from "./public-origin";

export type OperatorSessionView = {
  operator: {
    id: string;
    email: string;
    displayName: string;
  };
  publicPageOrigin: string;
  timezone: string;
};

// This wrapper is imported by route modules. The implementation imports only
// inside the handler so client bundles receive the generated RPC stub instead
// of Worker bindings, repositories, or feature services.
function redirectToSignIn(requestUrl: URL): never {
  const signIn = new URL("/signin", requestUrl);
  signIn.searchParams.set("returnTo", `${requestUrl.pathname}${requestUrl.search}`);
  throw redirect({ href: signIn.toString(), statusCode: 302 });
}

export const loadOperatorSession = createServerFn({ method: "GET" }).handler(async (): Promise<OperatorSessionView> => {
  const [{ getRequest, getRequestUrl }, { requestBindings }, { createApp }, { prepareAppMailBindings }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("../platform/bindings.server"),
    import("./server"),
    import("./mail"),
  ]);
  const bindings = requestBindings();
  const requestUrl = getRequestUrl();

  const request = getRequest();
  const runtime = createApp(await prepareAppMailBindings(bindings, request), request);
  const session = await runtime.services.auth().getSession(request);
  if (!session) redirectToSignIn(requestUrl);
  const operator = await runtime.services.operators.view(session.operator);

  const settings = await runtime.services.pageSettings.get();
  if (!settings) throw new Error("Page settings are not configured.");
  return { operator, publicPageOrigin: publicPageOrigin(requestUrl, bindings.LAMP_PAGE_HOST), timezone: settings.timezone };
});
