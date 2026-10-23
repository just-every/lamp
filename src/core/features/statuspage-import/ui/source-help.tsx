import { useState } from "react";

import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import type { SourcePage } from "../page-finder";

type Source = "statuspage" | "betterstack" | "instatus" | "sorry" | "statusio";

const external = { target: "_blank", rel: "noreferrer" } as const;

/** Where each source's key and page ID live, in the order the owner fills the fields. */
export function AccountHelp({ source }: { source: Source }) {
  if (source === "statusio") return <ol className="setup-guide"><li>In your Status.io dashboard, open API settings and copy the API ID and API key. The status page ID is separate from the API ID.</li><li>Enter all three below and confirm that the page and history are public and unrestricted.</li><li>Run the dry run. The documented legacy incident response is accepted only below its 100-record cap. Subscriber exports, postmortems, templates and old incident addresses are unavailable in this reader.</li></ol>;
  if (source === "betterstack") return <ol className="setup-guide">
    <li>Open <a href="https://betterstack.com/settings/api-tokens/0" {...external}>Better Stack API tokens</a>. Under <strong>Team-based tokens</strong>, select your team and copy a token from <strong>Uptime API tokens</strong> (or create one).</li>
    <li>Paste it below and choose <strong>Find my pages</strong>, then <strong>Use this page</strong> beside your status page. That fills the page ID.</li>
    <li>Confirm the page is public, then choose <strong>Run dry run</strong>. Nothing is imported until you review it.</li>
  </ol>;
  if (source === "instatus") return <ol className="setup-guide">
    <li>Open <a href="https://dashboard.instatus.com/developer" {...external}>Instatus developer settings</a> (User settings → Developer settings) and copy your API key.</li>
    <li>Paste it below and choose <strong>Find my pages</strong>, then <strong>Use this page</strong> beside your status page. You can also right-click the project name at the top left of your Instatus dashboard and choose <strong>Copy Project ID</strong>.</li>
    <li>Confirm the page is public, then choose <strong>Run dry run</strong>. Nothing is imported until you review it.</li>
  </ol>;
  if (source === "sorry") return <ol className="setup-guide">
    <li>Sign in to <a href="https://app.sorryapp.com" {...external}>Sorry</a>, open <strong>My Account → API Tokens</strong> and copy a token (create one if the list is empty). Tokens belong to your user, so use an account that can see the status page.</li>
    <li>Paste it below and choose <strong>Find my pages</strong>, then <strong>Use this page</strong> beside your status page. That fills the page ID.</li>
    <li>Choose <strong>Run dry run</strong>. Nothing is imported until you review it. No token? Use your public status page address in the next section instead; it moves everything except subscribers.</li>
  </ol>;
  return <p className="setup-guide">On Statuspage, open your avatar menu, then <strong>API info</strong>. Copy the page ID and API key into the fields below, then choose <strong>Run dry run</strong>.</p>;
}

/** Better Stack, Instatus and Sorry: list the pages the key can read and fill the chosen page ID. */
export function PageFinder({ source, apiKey, onChoose }: { source: "betterstack" | "instatus" | "sorry" | "statusio"; apiKey: string; onChoose: (id: string) => void }) {
  const [pages, setPages] = useState<SourcePage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function find() {
    setBusy(true); setError(null); setPages(null);
    try { setPages((await appApi<{ pages: SourcePage[] }>("/api/app/statuspage-import/pages", { method: "POST", body: JSON.stringify({ source, apiKey }) })).pages); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Your status pages could not be listed."); }
    finally { setBusy(false); }
  }
  return <div className="setup-guide">
    <Button type="button" variant="secondary" disabled={busy || !apiKey} onClick={() => void find()}>{busy ? "Finding pages…" : "Find my pages"}</Button>
    {error && <p className="setup-result" data-ok="false" role="alert">{error}</p>}
    {pages && (pages.length
      ? <ul className="channel-list" aria-label="Your status pages">{pages.map((page) => <li key={page.id}><span><strong>{page.name}</strong>{page.address ? ` · ${page.address}` : ""} · ID {page.id}</span><Button type="button" variant="secondary" className="table-action" onClick={() => onChoose(page.id)}>Use this page</Button></li>)}</ul>
      : <p className="setup-result" data-ok="false" role="status">This key can read no status pages. Check you copied it from the team that owns your page.</p>)}
  </div>;
}

export function SavedResponsesHelp({ source }: { source: Source }) {
  return <div className="setup-guide">
    <p>Only if you already have them: unchanged JSON files saved from the {source === "statusio" ? "Status.io" : source === "betterstack" ? "Better Stack" : source === "instatus" ? "Instatus" : source === "sorry" ? "Sorry" : "Statuspage"} API. Most people use the account option above instead. Select all the files together, then choose <strong>Run dry run</strong>.{source === "instatus" && " Enter your Instatus page ID above as well."}</p>
    <details><summary>See required files</summary><p>{source === "statusio"
      ? "statusio-components.json, statusio-summary.json, statusio-incidents.json (the legacy list), statusio-maintenances.json, statusio-acl.json and statusio-maintenance-ID.json for every enumerated maintenance. Enter the status page ID above."
      : source === "sorry"
      ? "sorry-status.json (public) or sorry-page.json (with a key), sorry-components.json, sorry-notices.json and each notice's detail file. Only files saved with a key may include sorry-subscribers.json."
      : source === "instatus"
        ? "instatus-pages.json, instatus-components.json, instatus-incidents.json, instatus-maintenances.json, instatus-subscribers.json, instatus-audience-groups.json, and instatus-maintenance-ID.json for each maintenance. Name later pages -2, -3 and so on."
        : source === "betterstack"
          ? "status-page.json, sections.json, resources.json, status-reports.json, subscribers.json, and status-updates-REPORTID.json for each report. Name later pages -2, -3 and so on."
          : "page.json and page-access-groups.json are required to check visibility, along with components.json. Optional: component-groups.json, incidents.json, incidents-scheduled.json, subscribers.json and incident-templates.json; optional incident-template-groups.json supplies folder names. Name later pages incidents-2.json and so on."} The <a href={`/docs/moving-in#${source === "betterstack" ? "better-stack" : source}`} {...external}>moving-in guide</a> shows how to save them. The dry run lists anything missing before you import.</p></details>
  </div>;
}
