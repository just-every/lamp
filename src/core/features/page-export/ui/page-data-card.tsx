import { useState } from "react";

import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { FormError } from "../../../app/client/ui/states";
import type { PageDataCheck } from "../service";

const COUNT_LABELS: Record<string, string> = {
  componentGroups: "component groups",
  components: "components",
  incidents: "incidents",
  incidentUpdates: "incident updates",
  maintenance: "maintenance windows",
  subscribers: "subscribers",
};

function Counts({ check }: { check: PageDataCheck }) {
  return <ul className="page-data-counts">{Object.entries(check.counts).map(([key, count]) => <li key={key}><strong>{count}</strong> {COUNT_LABELS[key] ?? key}</li>)}</ul>;
}

export function PageDataCard() {
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<PageDataCheck | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

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
        setStatus("Restored. The public page was rebuilt with this data; reload any open page to see it.");
        setFile(null);
      }
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "The file could not be read.");
    } finally { setWorking(false); }
  }

  return <section className="data-card page-data-card" aria-labelledby="page-data-title">
    <p className="card-kicker">Your data</p>
    <h2 id="page-data-title">Export page data</h2>
    <p>Download everything this status page holds as one JSON file (format <code>lamp-page-data</code>, version 1):</p>
    <ul>
      <li>page settings and logo;</li>
      <li>component groups and components, with their status history;</li>
      <li>incidents with every update, draft, internal note and post-incident report;</li>
      <li>maintenance windows with their notices;</li>
      <li>subscribers with their email address or webhook, chosen components and consent state: when they subscribed, when they confirmed, or when and why they left.</li>
    </ul>
    <p>It leaves out operator sign-in and sessions, delivery logs, alert sources, Slack and Teams channels, incident attachments, move-in history, and mail and AI settings. Authors are named by email. The file holds your subscribers' addresses: keep it private.</p>
    <a className="text-link" href="/api/app/page-data" download>Download page data <Icon name="arrow" width={16} height={16} /></a>

    <h3>Restore page data</h3>
    <p>Restore a file into a new Lamp installation before you add components, incidents, maintenance or subscribers to it. Choose the file, check it, then restore. Subscribers keep their state and are not emailed; links in emails the old page sent stop working, and every later email carries new ones. Authors who are not operators here are listed as former operators.</p>
    <label className="form-label">Page data file<input type="file" accept="application/json,.json" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setCheck(null); setStatus(null); }} /></label>
    {check && <div className="page-data-check" role="status">
      {check.pageName && <p>{check.pageName}, exported {check.exportedAt?.slice(0, 10)}:</p>}
      <Counts check={check} />
      {check.problems.map((problem) => <FormError key={problem}>{problem}</FormError>)}
      {check.ok && !status && <p>This page can take this file. Nothing has been written yet.</p>}
    </div>}
    {status && <p className="save-message" role="status">{status}</p>}
    <div className="form-actions">
      <Button variant="secondary" type="button" onClick={() => send("check")} disabled={working || !file}>{working ? "Checking…" : "Check file"}</Button>
      <Button type="button" onClick={() => send("restore")} disabled={working || !file || !check?.ok}>Restore page data</Button>
    </div>
  </section>;
}
