import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { z } from "zod";

import { publicPageOrigin } from "./public-origin";
import { operatorPageReads, type AppDataSnapshot, type AppJson } from "./page-data";
import type { StoredOperator } from "../features/operators/repository";

export type OperatorSessionView = {
  operator: StoredOperator;
  publicPageOrigin: string;
  timezone: string;
  /** The /app path whose reads `data` holds. */
  path: string;
  data: AppDataSnapshot;
};

// This wrapper is imported by route modules. The implementation imports only
// inside the handler so client bundles receive the generated RPC stub instead
// of Worker bindings, repositories, or feature services.
function redirectToSignIn(requestUrl: URL): never {
  const signIn = new URL("/signin", requestUrl);
  signIn.searchParams.set("returnTo", `${requestUrl.pathname}${requestUrl.search}`);
  throw redirect({ href: signIn.toString(), statusCode: 302 });
}

export const loadOperatorSession = createServerFn({ method: "GET" })
.inputValidator(z.object({ path: z.string().regex(/^\/app(?:\/[^?#]*)?$/), view: z.string().max(40).optional() }))
.handler(async ({ data: input }): Promise<OperatorSessionView> => {
  const [{ getRequest, getRequestUrl, setResponseHeader }, { requestBindings }, { createApp }, { prepareAppMailBindings }, { operatorRequest }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("../platform/bindings.server"),
    import("./server"),
    import("./mail"),
    import("../platform/operator-request.server"),
  ]);
  const bindings = requestBindings();
  const requestUrl = getRequestUrl();

  const request = getRequest();
  setResponseHeader("Cache-Control", "private, no-store");
  const current = operatorRequest();
  const runtime = current?.runtime ?? createApp(await prepareAppMailBindings(bindings, request), request);
  const session = current?.session ?? await runtime.services.auth().getSession(request);
  if (!session) redirectToSignIn(requestUrl);
  const settingsPromise = runtime.services.pageSettings.get();
  const operatorPromise = runtime.services.operators.view(session.operator);
  const paths = operatorPageReads(input.path, input.view);
  const operator = await operatorPromise;
  const read = async (path: string) => {
    const response = await runtime.readOperator(path, request, { session, operator });
    const data = await response.json() as AppJson;
    const error = response.ok ? null : data && typeof data === "object" && !Array.isArray(data) && typeof data.error === "string" ? data.error : `The operator API returned ${response.status}.`;
    return [path, { data, error }] as const;
  };
  if (operator.isSetupOperator) paths.push("/api/app/editor-config");
  const [settings, entries] = await Promise.all([settingsPromise, Promise.all(paths.map(read))]);
  if (!settings) throw new Error("Page settings are not configured.");
  const data = Object.fromEntries(entries) as AppDataSnapshot;
  data["/api/app/session"] = { data: { operator: { ...operator }, publicPageHost: bindings.LAMP_PAGE_HOST }, error: null };
  data["/api/app/page-settings"] = { data: { settings }, error: null };
  return { operator, publicPageOrigin: publicPageOrigin(requestUrl, bindings.LAMP_PAGE_HOST), timezone: settings.timezone, path: input.path, data };
});
