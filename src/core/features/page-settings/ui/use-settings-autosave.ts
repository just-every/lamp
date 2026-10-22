import { useEffect, useRef, useState } from "react";

import { appApi } from "../../../app/client/ui/api";
import { pageSettingsSchema } from "../../../shared/schemas";
import type { PageSettingsView } from "../service";
import { toSettingsForm, type ConfirmedField, type SettingsForm } from "./settings-form";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fieldNames: Record<string, string> = {
  pageName: "Page name", tagline: "Tagline", accentColor: "Accent colour", timezone: "Time zone",
  mailFromAddress: "From email", widgetAllowedOrigins: "Allowed websites", widgetAppearance: "Embed appearance",
  emailBranding: "Notification email", aiToneInstructions: "Writing instructions",
  wordingBlockedTerms: "Terms to flag", wordingFriendlyLength: "Preferred field length",
};

/** One write at a time, with the next write built from the latest edits, never an old response. */
export function useSettingsAutosave(initial: PageSettingsView | undefined, onSaved: () => void) {
  const [settings, setSettings] = useState<SettingsForm | null>(() => initial ? toSettingsForm(initial) : null);
  const [saved, setSaved] = useState(initial ?? null);
  const [phase, setPhase] = useState<"saved" | "waiting" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const queue = useRef({
    draft: settings, target: settings, revision: 0, completed: 0, stopped: -1,
    sending: false, mounted: true, dueAt: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  const notify = useRef(onSaved);
  notify.current = onSaved;

  useEffect(() => {
    if (initial && !queue.current.draft) {
      const form = toSettingsForm(initial);
      queue.current.draft = form; queue.current.target = form;
      setSettings(form); setSaved(initial);
    }
  }, [initial]);
  useEffect(() => {
    queue.current.mounted = true;
    const flushBeforeLeave = () => { queue.current.dueAt = 0; void flush(); };
    window.addEventListener("beforeunload", flushBeforeLeave);
    window.addEventListener("pagehide", flushBeforeLeave);
    return () => {
      window.removeEventListener("beforeunload", flushBeforeLeave);
      window.removeEventListener("pagehide", flushBeforeLeave);
      queue.current.mounted = false;
      clearTimeout(queue.current.timer);
      flushBeforeLeave();
    };
  }, []);

  function schedule() {
    const q = queue.current;
    clearTimeout(q.timer);
    if (!q.sending && q.revision !== q.completed && q.revision !== q.stopped) {
      q.timer = setTimeout(() => void flush(), q.mounted ? Math.max(0, q.dueAt - Date.now()) : 0);
    }
  }

  async function flush() {
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
      return;
    }
    q.sending = true;
    if (q.mounted) { setPhase("saving"); setError(null); }
    try {
      const response = await appApi<{ settings: PageSettingsView }>("/api/app/page-settings", { method: "PUT", body: JSON.stringify(parsed.data), keepalive: true });
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
    } finally { q.sending = false; schedule(); }
  }

  function enqueue(immediate: boolean) {
    const q = queue.current;
    q.revision++; q.dueAt = Date.now() + (immediate ? 0 : 600);
    setError(null); setPhase(q.sending ? "saving" : "waiting"); schedule();
  }

  function update<K extends keyof SettingsForm>(field: K, value: SettingsForm[K], immediate = false) {
    const q = queue.current;
    if (!q.draft || !q.target) return;
    q.draft = { ...q.draft, [field]: value }; setSettings(q.draft);
    if (field === "mailFromAddress" || field === "widgetAllowedOrigins") return;
    q.target = { ...q.target, [field]: value }; enqueue(immediate);
  }

  function confirm(field: ConfirmedField) {
    const q = queue.current;
    if (!q.target || !q.draft) return;
    q.target = { ...q.target, [field]: q.draft[field] }; enqueue(true);
  }

  const pending = (field: ConfirmedField) => !same(settings?.[field], queue.current.target?.[field]);
  const dirty = phase !== "saved" || pending("mailFromAddress") || pending("widgetAllowedOrigins");
  return {
    settings, saved, phase, error, dirty, update, confirm, pending,
    prepareToLeave: () => {
      const q = queue.current;
      q.dueAt = 0;
      void flush();
      if (!same(q.draft?.mailFromAddress, q.target?.mailFromAddress) || !same(q.draft?.widgetAllowedOrigins, q.target?.widgetAllowedOrigins)) return "Unconfirmed changes are not live. Leave Settings?";
      if (q.stopped === q.revision) return "Some changes could not be saved. Leave Settings?";
      return q.completed !== q.revision ? "Changes are still saving. Leave Settings?" : null;
    },
    retry: () => enqueue(true),
    // Logo operations publish separately and must leave any typing in progress alone.
    adoptSaved: (next: PageSettingsView) => { setSaved(next); notify.current(); },
  };
}
