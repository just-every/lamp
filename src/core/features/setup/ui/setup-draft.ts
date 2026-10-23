import { useEffect, useState } from "react";
import { z } from "zod";

const foundSchema = z.object({
  pageName: z.string(), tagline: z.string(), accentColor: z.string(), timezone: z.string(),
  mark: z.object({ src: z.string(), vector: z.boolean(), from: z.string().nullable() }).nullable(),
  components: z.array(z.string()), statusPage: z.string().nullable(),
  groups: z.array(z.object({ id: z.string(), name: z.string(), components: z.array(z.string()) })).default([]),
  existing: z.object({
    url: z.string(), host: z.string(), source: z.enum(["statuspage", "instatus", "betterstack"]),
    components: z.array(z.object({ id: z.string(), name: z.string(), groupId: z.string().nullable() })), pastIncidents: z.number(),
  }).nullable().default(null),
  history: z.boolean().default(false),
});
const draftSchema = z.object({
  website: z.string(), found: foundSchema.nullable(),
  review: z.object({ kind: z.enum(["read", "failed", "skipped"]), note: z.string() }).nullable(),
});
type SetupDraft = z.infer<typeof draftSchema>;
const empty: SetupDraft = { website: "", found: null, review: null };

/** A browser draft belongs to this signed-in owner, and ends when they open Lamp. */
export function useSetupDraft(ownerId: string) {
  const key = `lamp:setup:${ownerId}`;
  const [draft, setDraft] = useState<SetupDraft>(empty);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      const parsed = saved ? draftSchema.safeParse(JSON.parse(saved)) : null;
      if (parsed?.success) setDraft(parsed.data);
    } catch {
      setStorageError("This browser couldn't keep your draft. Keep this tab open until you open Lamp.");
    }
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(key, JSON.stringify(draft)); }
    catch { setStorageError("This browser couldn't keep your draft. Keep this tab open until you open Lamp."); }
  }, [draft, key, ready]);
  return { draft, setDraft, ready, storageError, clear: () => localStorage.removeItem(key) };
}
