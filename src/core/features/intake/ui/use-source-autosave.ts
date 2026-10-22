import { useEffect, useRef, useState } from "react";

import { appApi } from "../../../app/client/ui/api";
import { useLeaveGuard } from "../../../app/client/ui/leave-guard";

export type SavePhase = "saved" | "waiting" | "saving" | "error";

/** A connected tool's choices save as they change: typing after a short pause, choices at once.
 * One write at a time, always the newest choices; closing the form or leaving the page sends them at once. */
export function useSourceAutosave(sourceId: string, onSaved: () => void) {
  const [phase, setPhase] = useState<SavePhase>("saved");
  const [error, setError] = useState<string | null>(null);
  const queue = useRef({ body: "", revision: 0, completed: 0, stopped: -1, sending: false, mounted: true, unloadSent: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined, answered: new Set<() => void>() });
  const notify = useRef(onSaved);
  notify.current = onSaved;
  const pending = () => { const q = queue.current; return q.revision !== q.completed && q.revision !== q.stopped; };

  async function flush(keepalive = false) {
    const q = queue.current;
    clearTimeout(q.timer);
    if (q.sending || !pending()) return;
    const revision = q.revision;
    q.sending = true;
    if (q.mounted) setPhase("saving");
    try {
      await appApi(`/api/app/intake/sources/${sourceId}`, { method: "PUT", body: q.body, keepalive });
      q.completed = revision;
      // A closed form's last write still refreshes the tool's row.
      notify.current();
      if (q.mounted) { setError(null); setPhase(q.revision === revision ? "saved" : "waiting"); }
    } catch (cause) {
      // The newest choices stay on screen; Retry, or the next change, writes them in full.
      q.stopped = revision;
      if (q.mounted) { setError(cause instanceof Error ? cause.message : "The change could not be saved."); setPhase(q.revision === revision ? "error" : "waiting"); }
    } finally {
      q.sending = false;
      for (const check of [...q.answered]) check();
      if (pending()) q.timer = setTimeout(() => void flush(), 0);
    }
  }

  useEffect(() => {
    const q = queue.current;
    q.mounted = true;
    // The page is going: send the newest choices even past a write still waiting for its answer.
    const unload = () => {
      if (!q.sending) { void flush(true); return; }
      if (q.unloadSent === q.revision || !pending()) return;
      q.unloadSent = q.revision;
      void appApi(`/api/app/intake/sources/${sourceId}`, { method: "PUT", body: q.body, keepalive: true }).catch(() => undefined);
    };
    window.addEventListener("pagehide", unload);
    return () => { window.removeEventListener("pagehide", unload); q.mounted = false; void flush(); };
  }, [sourceId]);

  // Signing out waits for a pending write; a refused one keeps the owner here with its reason and Retry.
  useLeaveGuard(async () => {
    const q = queue.current;
    if (pending() || q.sending) {
      void flush();
      await new Promise<void>(resolve => {
        const check = () => { if (!q.sending && !pending()) { q.answered.delete(check); resolve(); } };
        q.answered.add(check); check();
      });
    }
    return q.stopped !== q.revision;
  });

  function save(body: object, immediate = false) {
    const q = queue.current;
    q.body = JSON.stringify(body); q.revision++;
    setError(null); setPhase(q.sending ? "saving" : "waiting");
    clearTimeout(q.timer);
    if (!q.sending) q.timer = setTimeout(() => void flush(), immediate ? 0 : 600);
  }

  function retry() {
    const q = queue.current;
    q.stopped = -1;
    void flush();
  }

  return { phase, error, save, retry };
}
