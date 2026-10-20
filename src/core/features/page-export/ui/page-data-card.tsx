import { useCallback, useEffect, useState } from "react";

import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { FormError, useOperatorTime } from "../../../app/client/ui/states";
import type { HeldConfirmations, PageDataCheck, SubscriberConsent } from "../service";

const COUNT_LABELS: Record<string, string> = {
  componentGroups: "component groups",
  components: "components",
  incidents: "incidents",
  incidentUpdates: "incident updates",
  maintenance: "maintenance windows",
  subscribers: "subscribers",
  scheduledUpdates: "scheduled updates",
  openMaintenance: "upcoming or running maintenance",
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function Counts({ check }: { check: PageDataCheck }) {
  return <ul className="page-data-counts">{Object.entries(check.counts).map(([key, count]) => <li key={key}><strong>{count}</strong> {COUNT_LABELS[key] ?? key}</li>)}</ul>;
}

function Consent({ consent }: { consent: SubscriberConsent }) {
  if (!consent.emailSubscribers) return null;
  const subscribers = plural(consent.emailSubscribers, "email subscriber");
  if (consent.kept) return <p>{subscribers} keep their state: the file’s subscriber consent was verified.</p>;
  const why = consent.provenance === "unsigned"
    ? "this older file has no verifiable subscriber consent"
    : "subscriber consent could not be verified for this file";
  return <p className="page-data-held">{subscribers} will be held, and receive nothing, until you send each of them one confirmation email: {why}.</p>;
}

function HeldSubscribers({ held, onChange }: { held: HeldConfirmations; onChange: (next: HeldConfirmations) => void }) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const formatOperatorTime = useOperatorTime();

  async function send() {
    setSending(true); setMessage(null);
    let sent = 0;
    try {
      // Each request sends one batch; keep going while batches send.
      for (;;) {
        const { confirmations } = await appApi<{ confirmations: HeldConfirmations & { sent: number } }>("/api/app/page-data/confirmations", { method: "POST" });
        sent += confirmations.sent;
        onChange(confirmations);
        if (!confirmations.held || !confirmations.sent) break;
      }
      setMessage(`Sent ${plural(sent, "confirmation email")}. Each link works for 72 hours.`);
    } catch (cause) {
      setMessage(`${sent ? `Sent ${plural(sent, "confirmation email")}, then stopped: ` : ""}${cause instanceof Error ? cause.message : "The confirmations could not be sent."}`);
    } finally { setSending(false); }
  }

  return <div className="page-data-check" role="status">
    {held.held > 0 && <p><strong>{plural(held.held, "restored email subscriber")}</strong> {held.held === 1 ? "is" : "are"} held for a confirmation email. Held subscribers receive nothing. Each one you send a confirmation stays subscribed only if they follow its link within 72 hours. Anyone you have not sent one is deleted{held.deleteAfter ? ` from ${formatOperatorTime(held.deleteAfter)}` : ""}.</p>}
    {message && <p className="save-message">{message}</p>}
    {held.held > 0 && <div className="form-actions"><Button type="button" onClick={send} disabled={sending}>{sending ? "Sending…" : "Send confirmation emails"}</Button></div>}
  </div>;
}

export function PageDataCard() {
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<PageDataCheck | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [held, setHeld] = useState<HeldConfirmations | null>(null);

  const loadHeld = useCallback(async () => {
    try { setHeld((await appApi<{ confirmations: HeldConfirmations }>("/api/app/page-data/confirmations")).confirmations); }
    catch { setHeld(null); }
  }, []);
  useEffect(() => { void loadHeld(); }, [loadHeld]);

  async function send(path: "check" | "restore") {
    if (!file) return;
    setWorking(true); setStatus(null);
    try {
      let body: string;
      try { body = JSON.stringify(JSON.parse(await file.text())); }
      catch { throw new Error("This file is not JSON. Choose the lamp-page-data file you downloaded."); }
      const response = await fetch(`/api/app/page-data/${path}`, { method: "POST", body, headers: { Accept: "application/json", "Content-Type": "application/json" } });
      const result = await response.json().catch(() => null) as { check?: PageDataCheck; error?: string } | null;
      if (!result?.check) throw new Error(result?.error ?? `The page returned ${response.status}.`);
      setCheck(result.check);
      if (path === "restore" && result.check.ok) {
        setStatus("Restored. Your data is live.");
        setFile(null);
        await loadHeld();
      }
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "The file could not be read.");
    } finally { setWorking(false); }
  }

  return <section className="data-card page-data-card" aria-labelledby="page-data-title">
    <p className="card-kicker">Your data</p>
    <h2 id="page-data-title">Export page data</h2>
    <p>Download your page, history and subscribers as one JSON file. Keep it private.</p>
    <details><summary>What’s in the file</summary>
    <ul>
      <li>page settings and logo;</li>
      <li>component groups and components, with their status history;</li>
      <li>incidents with every update, draft, internal note and post-incident report;</li>
      <li>maintenance windows with their notices;</li>
      <li>subscribers with their email address or webhook, chosen components and consent state: when they subscribed, when they confirmed, or when and why they left.</li>
    </ul>
    <p>It leaves out operator sign-in and sessions, delivery logs, alert sources, Slack and Teams channels, incident attachments, move-in history, and mail and AI settings. Authors are named by email. The file holds your subscribers' addresses: keep it private.</p>
    </details>
    <a className="text-link" href="/api/app/page-data" download>Download page data <Icon name="arrow" width={16} height={16} /></a>

    <h3>Restore page data</h3>
    <p>Choose a page data file, check it, then restore it into an empty Lamp installation.</p>
    <label className="form-label">Page data file<input type="file" accept="application/json,.json" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setCheck(null); setStatus(null); }} /></label>
    {check && <div className="page-data-check" role="status">
      {check.pageName && <p>{check.pageName}, exported {check.exportedAt?.slice(0, 10)}:</p>}
      <Counts check={check} />
      {check.consent && <Consent consent={check.consent} />}
      {check.problems.map((problem) => <FormError key={problem}>{problem}</FormError>)}
      {check.ok && !status && <>
        <p>This page can take this file. Nothing has been written yet. Restoring sends no emails.</p>
        {check.counts.subscribers > 0 && <p>Old email links stop working. Future emails include new links.</p>}
        {(check.counts.scheduledUpdates > 0 || check.counts.openMaintenance > 0) && <p>Scheduled updates and maintenance resume here. Overdue work runs within a minute and may notify subscribers whose consent was verified.</p>}
        <p>Authors without access here are listed as former operators.</p>
      </>}
    </div>}
    {status && <p className="save-message" role="status">{status}</p>}
    <div className="form-actions">
      <Button variant="secondary" type="button" onClick={() => send("check")} disabled={working || !file}>{working ? "Checking…" : "Check file"}</Button>
      <Button type="button" onClick={() => send("restore")} disabled={working || !file || !check?.ok}>Restore page data</Button>
    </div>
    {held && held.held > 0 && <HeldSubscribers held={held} onChange={setHeld} />}
  </section>;
}
