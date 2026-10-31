import { useEffect, useRef, useState } from "react";

import { appApi } from "../../../app/client/ui/api";
import { leaveWhenSaved, type Move } from "../../../app/client/ui/leave-guard";
import { pageSettingsSchema } from "../../../shared/schemas";
import type { PageSettingsView } from "../service";
import { toSettingsForm, type ConfirmedField, type SettingsForm } from "./settings-form";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const unconfirmed = (q: { draft: SettingsForm | null; target: SettingsForm | null }) =>
  !same(q.draft?.mailFromAddress, q.target?.mailFromAddress) || !same(q.draft?.widgetAllowedOrigins, q.target?.widgetAllowedOrigins);
const fieldNames: Record<string, string> = {
  pageName: "Page name", tagline: "Tagline", accentColor: "Accent colour", timezone: "Time zone",
  mailFromAddress: "From email", widgetAllowedOrigins: "Allowed websites", widgetAppearance: "Embed appearance",
  emailBranding: "Notification email", aiToneInstructions: "Writing instructions",
  wordingBlockedTerms: "Terms to flag", wordingFriendlyLength: "Preferred field length",
  theme: "Theme",
};
// Browsers finish keepalive requests after the page has gone, for up to 64 KiB of bodies at once.
const KEEPALIVE_BYTES = 64 * 1024;

/** One write at a time, with the next write built from the latest edits, never an old response. */
export function useSettingsAutosave(initial: PageSettingsView | undefined, onSaved: () => void) {
  const [settings, setSettings] = useState<SettingsForm | null>(() => initial ? toSettingsForm(initial) : null);
  const [saved, setSaved] = useState(initial ?? null);
  const [phase, setPhase] = useState<"saved" | "waiting" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const queue = useRef({
    draft: settings, target: settings, revision: 0, completed: 0, stopped: -1,
    storedTheme: initial?.theme,
    sending: false, mounted: true, dueAt: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined,
    inflight: { revision: 0, keepalive: false }, keepaliveBytes: 0, sentOnUnload: 0,
    leaving: 0, released: false, answered: new Set<() => void>(),
  });
  const notify = useRef(onSaved);
  notify.current = onSaved;

  useEffect(() => {
    if (initial && !queue.current.draft) {
      const form = toSettingsForm(initial);
      queue.current.draft = form; queue.current.target = form;
      queue.current.storedTheme = initial.theme;
      setSettings(form); setSaved(initial);
    }
  }, [initial]);
  useEffect(() => {
    queue.current.mounted = true;
    window.addEventListener("beforeunload", flushOnUnload);
    window.addEventListener("pagehide", flushOnUnload);
    return () => {
      window.removeEventListener("beforeunload", flushOnUnload);
      window.removeEventListener("pagehide", flushOnUnload);
      queue.current.mounted = false;
      clearTimeout(queue.current.timer);
      queue.current.dueAt = 0; void flush();
    };
  }, []);

  function schedule() {
    const q = queue.current;
    clearTimeout(q.timer);
    if (!q.sending && q.revision !== q.completed && q.revision !== q.stopped) {
      q.timer = setTimeout(() => void flush(), q.mounted ? Math.max(0, q.dueAt - Date.now()) : 0);
    }
  }

  const answer = () => { for (const check of [...queue.current.answered]) check(); };

  /** Reserves the body's bytes within the keepalive allowance; 0 when it must go as an ordinary request. */
  function keepaliveShare(body: string) {
    const q = queue.current;
    const bytes = new TextEncoder().encode(body).length;
    if (q.keepaliveBytes + bytes > KEEPALIVE_BYTES) return 0;
    q.keepaliveBytes += bytes;
    return bytes;
  }

  async function flush(unloading = false) {
    const q = queue.current;
    if (q.sending || !q.target || q.completed === q.revision || q.stopped === q.revision) return;
    const revision = q.revision;
    const request = q.target;
    const parsed = pageSettingsSchema.safeParse(request);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      q.stopped = revision;
      if (q.mounted) {
        setError(`${fieldNames[String(issue.path[0])] ?? "Settings"} could not be saved: ${issue.message}`);
        setPhase("error");
      }
      answer();
      return;
    }
    const body = JSON.stringify(parsed.data);
    // Only a write sent as the page unloads needs keepalive; ordinary writes and Retry are plain requests.
    const share = unloading ? keepaliveShare(body) : 0;
    q.sending = true; q.inflight = { revision, keepalive: share > 0 };
    if (q.mounted) { setPhase("saving"); setError(null); }
    try {
      const response = await appApi<{ settings: PageSettingsView }>("/api/app/page-settings", { method: "PUT", body, keepalive: share > 0 });
      if (!response.settings) throw new Error("The server did not return the saved settings.");
      q.completed = revision;
      if (q.mounted) {
        const normalized = toSettingsForm(response.settings);
        // Keep the editable bytes (and caret) in place, including a trailing space while typing.
        const target = { ...q.target };
        for (const key of Object.keys(request) as Array<keyof SettingsForm>) {
          if (same(target[key], request[key])) Object.assign(target, { [key]: normalized[key] });
        }
        q.target = target;
        q.storedTheme = normalized.theme;
        setSaved(response.settings);
        setPhase(q.revision === revision ? "saved" : "waiting");
        notify.current();
      }
    } catch (cause) {
      // A lost response may already have written. The next edit (even a revert) writes the full latest value.
      q.stopped = revision;
      if (q.mounted) {
        setError(`Settings could not be saved and published: ${cause instanceof Error ? cause.message : "The server could not be reached."} Your changes are kept here.`);
        setPhase(q.revision === revision ? "error" : "waiting");
      }
    } finally {
      q.keepaliveBytes -= share; q.sending = false;
      answer(); schedule();
    }
  }

  /** The page is unloading: send the newest edits now, even past a write still waiting for its answer. */
  function flushOnUnload() {
    const q = queue.current;
    q.dueAt = 0;
    if (!q.sending) { void flush(true); return; }
    if (q.sentOnUnload === q.revision || (q.inflight.revision === q.revision && q.inflight.keepalive)) return;
    const parsed = pageSettingsSchema.safeParse(q.target);
    if (!parsed.success) return;
    const body = JSON.stringify(parsed.data);
    const share = keepaliveShare(body);
    // An ordinary request is cancelled with the page, so it only helps past an older unanswered write.
    if (!share && q.inflight.revision === q.revision) return;
    q.sentOnUnload = q.revision;
    // Sent after the unanswered write, it normally reaches the server last; if the page stays, the queue sends it again in order.
    void appApi("/api/app/page-settings", { method: "PUT", body, keepalive: share > 0 }).catch(() => undefined).finally(() => { q.keepaliveBytes -= share; });
  }

  function enqueue(immediate: boolean) {
    const q = queue.current;
    q.revision++; q.dueAt = Date.now() + (immediate ? 0 : 600); q.released = false;
    setError(null); setPhase(q.sending ? "saving" : "waiting"); schedule();
  }

  function update<K extends keyof SettingsForm>(field: K, value: SettingsForm[K], immediate = false) {
    const q = queue.current;
    if (!q.draft || !q.target) return;
    q.draft = { ...q.draft, [field]: value }; q.released = false; setSettings(q.draft);
    if (field === "mailFromAddress" || field === "widgetAllowedOrigins") return;
    q.target = { ...q.target, [field]: value }; enqueue(immediate);
  }

  function confirm(field: ConfirmedField) {
    const q = queue.current;
    if (!q.target || !q.draft) return;
    q.target = { ...q.target, [field]: q.draft[field] }; enqueue(true);
  }

  /** Whether the owner may leave Settings, or move to another pane of it, now. Leaving waits for pending edits to save; a
   * refused save keeps them here. The question names Settings only when the owner is leaving it. */
  function leave(move: Move) {
    const q = queue.current;
    const pane = move === "pane";
    return leaveWhenSaved(q, () => { q.dueAt = 0; schedule(); }, pane ? "Some changes could not be saved. Switch panes and leave them behind?" : "Some changes could not be saved. Leave Settings?",
      () => unconfirmed(q) ? pane ? "Unconfirmed changes are not live. Switch panes and leave them behind?" : "Unconfirmed changes are not live. Leave Settings?" : null);
  }

  const pending = (field: ConfirmedField) => !same(settings?.[field], queue.current.target?.[field]);
  return {
    settings, saved, phase, error, update, confirm, pending, leave,
    // Read as the page unloads: finished saves, or a leave the owner already agreed to, ask nothing more.
    unsaved: () => { const q = queue.current; return !q.released && (q.completed !== q.revision || unconfirmed(q)); },
    retry: () => enqueue(true),
    // Asset operations publish separately. Merge just the asset flag into pending
    // drafts, then serialize it after any older settings request still in flight.
    adoptSaved: (next: PageSettingsView, asset?: "font" | "header") => {
      const q = queue.current;
      if (asset && q.draft && q.target) {
        const field = asset === "font" ? "font" : "headerImage";
        q.draft = { ...q.draft, theme: { ...q.draft.theme, [field]: next.theme[field] } };
        q.target = { ...q.target, theme: { ...q.target.theme, [field]: next.theme[field] } };
        if (asset === "header") {
          // Removing a header also removes references to that image from HTML.
          for (const key of ["headerHtml", "footerHtml"] as const) {
            if (same(q.draft.theme[key], q.storedTheme?.[key])) q.draft.theme[key] = next.theme[key];
            if (same(q.target.theme[key], q.storedTheme?.[key])) q.target.theme[key] = next.theme[key];
          }
        }
        setSettings(q.draft); enqueue(true);
      }
      q.storedTheme = next.theme;
      setSaved(next); notify.current();
    },
  };
}
