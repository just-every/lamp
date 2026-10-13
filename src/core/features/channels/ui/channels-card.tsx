import { useState, type FormEvent } from "react";

import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { EmptyState } from "../../../app/client/ui/lit-states";
import type { ChannelView } from "../service";

type ChannelsResponse = { channels: ChannelView[]; posts: Array<{ id: string; channel: string; kind: string; reference: string; queuedAt: string; state: string }> };

/** Settings: Slack and Teams channels that receive published incident updates for their components. */
export function ChannelsCard() {
  const channels = useAppData<ChannelsResponse>("/api/app/channels");
  const components = useAppData<{ components: Array<{ id: string; name: string }> }>("/api/app/components");
  const [kind, setKind] = useState<"slack" | "teams">("slack");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const names = new Map(components.data?.components.map((component) => [component.id, component.name]));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      await appApi("/api/app/channels", { method: "POST", body: JSON.stringify({ kind, name, url, componentIds: selected }) });
      setName(""); setUrl(""); setSelected([]); channels.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The channel could not be saved."); }
    finally { setSaving(false); }
  }
  async function remove(id: string) {
    try { await appApi(`/api/app/channels/${id}`, { method: "DELETE" }); channels.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The channel could not be removed."); }
  }

  return <section className="data-card channels-card" aria-labelledby="channels-title"><div><p className="card-kicker">Team channels</p><h2 id="channels-title">Slack and Teams</h2><p>Each published incident update for a channel's components is posted there once. The webhook URL is stored encrypted and never shown again.</p></div>
    {channels.data?.channels.length ? <ul className="channel-list">{channels.data.channels.map((channel) => <li key={channel.id}><span><strong>{channel.name}</strong> · {channel.kind === "slack" ? "Slack" : "Teams"} · {channel.host} · {channel.selectionMode === "all" ? "all components" : channel.componentIds.map((id) => names.get(id) ?? "removed component").join(", ")}</span><Button type="button" variant="secondary" className="table-action" onClick={() => void remove(channel.id)}>Remove</Button></li>)}</ul> : <EmptyState>No team channels yet.</EmptyState>}
    <form className="channel-form" onSubmit={save}>
      <label className="form-label">Service<select value={kind} onChange={(event) => setKind(event.target.value as "slack" | "teams")}><option value="slack">Slack</option><option value="teams">Microsoft Teams</option></select></label>
      <label className="form-label">Name<input required maxLength={120} placeholder="#status" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="form-label full-width">Incoming webhook URL<input required type="password" autoComplete="off" placeholder={kind === "slack" ? "https://hooks.slack.com/services/…" : "Teams Workflows webhook URL"} value={url} onChange={(event) => setUrl(event.target.value)} /></label>
      <fieldset className="full-width"><legend>Components</legend><p>Leave all clear to post about every visible component.</p>{components.data?.components.map((component) => <label key={component.id} className="checkbox-label"><input type="checkbox" checked={selected.includes(component.id)} onChange={() => setSelected((current) => current.includes(component.id) ? current.filter((id) => id !== component.id) : [...current, component.id])} />{component.name}</label>)}</fieldset>
      <Button disabled={saving}>{saving ? "Saving…" : "Add channel"}</Button>
    </form>
    {error && <FormError>{error}</FormError>}
    {channels.data?.posts.length ? <details><summary>Recent posts</summary><ul className="channel-posts">{channels.data.posts.map((post) => <li key={post.id}>{post.reference} → {post.channel}: {post.state}</li>)}</ul></details> : null}
  </section>;
}
