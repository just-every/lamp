import { useEffect, useRef } from "react";
import { createBrowserHistory, useBlocker, type RouterHistory } from "@tanstack/react-router";

// A page holding unsaved work answers before the operator leaves it or signs out; false keeps them where they are.
const guards = new Set<{ current: () => Promise<boolean> }>();

/** Links and Back away from this page, signing out and closing what holds the work (`mayLeave`) wait for `leave`;
 * reloading or closing the tab warns while `unsaved()`. */
export function useLeaveGuard(leave: () => Promise<boolean>, unsaved: () => boolean) {
  const latest = useRef(leave);
  latest.current = leave;
  useEffect(() => {
    guards.add(latest);
    return () => { guards.delete(latest); };
  }, []);
  useBlocker({ shouldBlockFn: async ({ current, next }) => next.pathname !== current.pathname && !await leave(), enableBeforeUnload: unsaved });
}

/** The browser history the router hears, told only when the page moves to another entry. A Back held by the guard above
 * is undone by TanStack's history, which still notifies with the same entry; hearing it, the router would reload /app
 * over the held page (offline, its error page in place of the form) and restore an older scroll over the refusal. */
export function leaveGuardHistory(): RouterHistory {
  const history = createBrowserHistory();
  const subscribe = history.subscribe;
  history.subscribe = listener => {
    let heard = history.location;
    return subscribe(change => {
      const moved = change.location.href !== heard.href || change.location.state.__TSR_key !== heard.state.__TSR_key;
      heard = change.location;
      if (moved) listener(change);
    });
  };
  return history;
}

export async function mayLeave() {
  for (const guard of guards) if (!await guard.current()) return false;
  return true;
}

/** An autosave queue as leaving reads it: numbered edits, the newest saved, the newest refused, and who waits for answers. */
export type SaveQueue = { revision: number; completed: number; stopped: number; leaving: number; released: boolean; answered: Set<() => void> };

/** Whether the operator may leave now. The newest edits save first (`send` skips the pause); a refused save keeps them
 * here with its reason and Retry, and leaving it behind afterwards takes one confirm, as does any `question` asked first. */
export async function leaveWhenSaved(q: SaveQueue, send: () => void, refused: string, question: () => string | null = () => null) {
  const revision = q.revision, attempt = ++q.leaving;
  if (q.completed !== revision && q.stopped !== revision) {
    send();
    await new Promise<void>(resolve => {
      const check = () => { if (q.completed >= revision || q.stopped >= revision) { q.answered.delete(check); resolve(); } };
      q.answered.add(check); check();
    });
    // A newer edit or a later leave decides instead; a refused save stays in view with its reason and Retry.
    if (attempt !== q.leaving || revision !== q.revision || q.stopped === revision) return false;
  }
  const ask = question() ?? (q.stopped === revision ? refused : null);
  q.released = ask === null || window.confirm(ask);
  return q.released;
}
