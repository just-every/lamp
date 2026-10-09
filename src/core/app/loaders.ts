import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";

export type OperatorSessionView = {
  operator: {
    id: string;
    email: string;
    displayName: string;
  };
  publicPageOrigin: string;
};

function publicPageOrigin(requestUrl: URL, pageHost: string) {
  const origin = new URL(requestUrl);
  origin.hostname = pageHost;
  return origin.origin;
}

export const loadSignInConfig = createServerFn({ method: "GET" }).handler(async () => {
  const [{ getRequestUrl }, { requestBindings }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("../platform/bindings.server"),
  ]);
  const bindings = requestBindings();
  return { publicPageOrigin: publicPageOrigin(getRequestUrl(), bindings.LAMP_PAGE_HOST) };
});

// This wrapper is imported by route modules. The implementation imports only
// inside the handler so client bundles receive the generated RPC stub instead
// of Worker bindings, repositories, or feature services.
function redirectToSignIn(requestUrl: URL): never {
  const signIn = new URL("/signin", requestUrl);
  signIn.searchParams.set("returnTo", `${requestUrl.pathname}${requestUrl.search}`);
  throw redirect({ href: signIn.toString(), statusCode: 302 });
}

export const loadOperatorSession = createServerFn({ method: "GET" }).handler(async (): Promise<OperatorSessionView> => {
  const [{ getRequest, getRequestHeader, getRequestUrl }, { requestBindings }, { readOperatorSessionId }, { createApp }, { prepareAppMailBindings }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("../platform/bindings.server"),
    import("../features/session"),
    import("./server"),
    import("./mail"),
  ]);
  const bindings = requestBindings();
  const requestUrl = getRequestUrl();
  const sessionId = readOperatorSessionId(getRequestHeader("cookie") ?? undefined);
  if (!sessionId) redirectToSignIn(requestUrl);

  const request = getRequest();
  const runtime = createApp(await prepareAppMailBindings(bindings, request), request);
  const operator = await runtime.services.session.getActiveOperator(sessionId);
  if (!operator) redirectToSignIn(requestUrl);

  return { operator, publicPageOrigin: publicPageOrigin(requestUrl, bindings.LAMP_PAGE_HOST) };
});
