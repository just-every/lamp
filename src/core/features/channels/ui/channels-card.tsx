import { useEffect, useState, type FormEvent } from "react";

import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { EmptyState } from "../../../app/client/ui/lit-states";
import type { ChannelView } from "../service";
import { ChannelSetupGuide } from "./channel-setup-guide";

type ChannelsResponse = { unavailable: string | null; channels: ChannelView[]; posts: Array<{ id: string; channel: string; kind: string; reference: string; queuedAt: string; state: string }> };

/** Settings: Slack and Teams channels that receive published incident updates for their components. */
export function ChannelsCard() {
  const channels = useAppData<ChannelsResponse>("/api/app/channels");
  const components = useAppData<{ components: Array<{ id: string; name: string }> }>("/api/app/components");
  const [kind, setKind] = useState<"slack" | "teams">("slack");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [operatorAlerts,setOperatorAlerts] = useState(false);
  const [changingAlerts,setChangingAlerts] = useState<{id:string;enabled:boolean}|null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState<Record<string, { sent: boolean; message: string } | "sending">>({});
  const names = new Map(components.data?.components.map((component) => [component.id, component.name]));

  useEffect(() => {
    if (!changingAlerts) return;
    if (channels.error) { setError(channels.error); setChangingAlerts(null); return; }
    const saved=channels.data?.channels.find(channel=>channel.id===changingAlerts.id);
    if (saved?.operatorAlerts===changingAlerts.enabled) setChangingAlerts(null);
  },[channels.data,channels.error,changingAlerts]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      await appApi("/api/app/channels", { method: "POST", body: JSON.stringify({ kind, name, url, componentIds: selected, operatorAlerts }) });
      setName(""); setUrl(""); setSelected([]); setOperatorAlerts(false); channels.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The channel could not be saved."); }
    finally { setSaving(false); }
  }
  async function changeAlerts(id: string, enabled: boolean) {
    setChangingAlerts({id,enabled});setError(null);
    try { await appApi(`/api/app/channels/${id}`,{method:"PATCH",body:JSON.stringify({operatorAlerts:enabled})});channels.refresh(); }
    catch(cause) {setError(cause instanceof Error ? cause.message : "The alert preference could not be saved.");setChangingAlerts(null);}
  }
  async function sendTest(id: string) {
    setTests((current) => ({ ...current, [id]: "sending" }));
    try { const result = await appApi<{ sent: boolean; message: string }>(`/api/app/channels/${id}/test`, { method: "POST" }); setTests((current) => ({ ...current, [id]: result })); }
    catch (cause) { setTests((current) => ({ ...current, [id]: { sent: false, message: cause instanceof Error ? cause.message : "The test post could not be sent." } })); }
  }
  async function remove(id: string) {
    try { await appApi(`/api/app/channels/${id}`, { method: "DELETE" }); channels.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The channel could not be removed."); }
  }

  const unavailable = channels.data?.unavailable;
  return <section className="data-card channels-card" aria-labelledby="channels-title"><div><p className="card-kicker">Team channels</p><h2 id="channels-title">Slack and Teams</h2><p>{unavailable ?? "Post each published incident update to a Slack or Teams channel. The webhook URL is stored encrypted and never shown again."}</p></div>
    {!unavailable && <>
    {channels.data?.channels.length ? <ul className="channel-list">{channels.data.channels.map((channel) => { const test = tests[channel.id]; return <li key={channel.id}><span><strong>{channel.name}</strong> · {channel.kind === "slack" ? "Slack" : "Teams"} · {channel.host} · {channel.selectionMode === "all" ? "all components" : channel.componentIds.map((id) => names.get(id) ?? "removed component").join(", ")}</span><span className="channel-actions">{channel.operatorManaged && <label className="checkbox-label"><input type="checkbox" aria-label={`Operator alerts for ${channel.name}`} checked={changingAlerts?.id===channel.id ? changingAlerts.enabled : channel.operatorAlerts} disabled={changingAlerts?.id===channel.id} onChange={event=>void changeAlerts(channel.id,event.target.checked)} />Operator alerts</label>}<Button type="button" variant="secondary" className="table-action" disabled={test === "sending"} onClick={() => void sendTest(channel.id)}>{test === "sending" ? "Sending…" : "Send test post"}</Button><Button type="button" variant="secondary" className="table-action" onClick={() => void remove(channel.id)}>Remove</Button></span>{test && test !== "sending" && <p className="setup-result" data-ok={test.sent} role="status">{test.message}</p>}</li>; })}</ul> : <EmptyState>No team channels yet.</EmptyState>}
    <form className="channel-form" onSubmit={save}>
      <label className="form-label">Service<select value={kind} onChange={(event) => setKind(event.target.value as "slack" | "teams")}><option value="slack">Slack</option><option value="teams">Microsoft Teams</option></select></label>
      <ChannelSetupGuide kind={kind} />
      <label className="form-label">Name<input required maxLength={120} placeholder="#status" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="form-label full-width">Incoming webhook URL<input required type="password" autoComplete="off" placeholder={kind === "slack" ? "https://hooks.slack.com/services/…" : "https://….logic.azure.com/… or ….powerplatform.com/…"} value={url} onChange={(event) => setUrl(event.target.value)} /></label>
      <fieldset className="full-width"><legend>Components</legend><p>Leave all clear to post about every visible component.</p>{components.data?.components.map((component) => <label key={component.id} className="checkbox-label"><input type="checkbox" checked={selected.includes(component.id)} onChange={() => setSelected((current) => current.includes(component.id) ? current.filter((id) => id !== component.id) : [...current, component.id])} />{component.name}</label>)}</fieldset>
      <label className="checkbox-label full-width"><input type="checkbox" checked={operatorAlerts} onChange={event=>setOperatorAlerts(event.target.checked)} />Send private operator alerts</label>
      <Button disabled={saving}>{saving ? "Saving…" : "Add channel"}</Button>
    </form>
    {error && <FormError>{error}</FormError>}
    {channels.data?.posts.length ? <details><summary>Recent posts</summary><ul className="channel-posts">{channels.data.posts.map((post) => <li key={post.id}>{post.reference} → {post.channel}: {post.state}</li>)}</ul></details> : null}
    </>}
  </section>;
}
