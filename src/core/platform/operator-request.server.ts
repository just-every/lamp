import { AsyncLocalStorage } from "node:async_hooks";
import type { Session } from "@runeditrun/rer/modules/operator-auth";
import type { createApp } from "../app/server";

// Authority and services belong only to this HTTP request. The document
// preflight and Start loader must not repeat its session reads.
const requests = new AsyncLocalStorage<{ runtime: ReturnType<typeof createApp>; session?: Session }>();
export const operatorRequest = () => requests.getStore();
export const withOperatorRequest = <T>(context: NonNullable<ReturnType<typeof operatorRequest>>, handle: () => T): T => requests.run(context, handle);
