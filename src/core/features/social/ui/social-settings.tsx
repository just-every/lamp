import { useEffect, useState, type FormEvent } from "react";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { EmptyState } from "../../../app/client/ui/lit-states";

type Network = "x" | "bluesky" | "mastodon";
type SocialAccount = { id: string; network: Network; name: string; prefix: string; host: string };
export type SocialSettingsResponse = { accounts: SocialAccount[]; postByDefault: boolean; posts: Array<{ id: string; network: string; account: string; reference: string; queuedAt: string; outcomeAt: string | null; attempts: number; state: string; postId: string | null }> };
const networkNames: Record<Network, string> = { x: "X", bluesky: "Bluesky", mastodon: "Mastodon" };

/** Connect the page's own social accounts without exposing saved credentials. */
export function SocialSettings() {
  const resource = useAppData<SocialSettingsResponse>("/api/app/social");
  const [network, setNetwork] = useState<Network>("x");
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [credential, setCredential] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [host, setHost] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDefault, setPendingDefault] = useState<boolean | null>(null);
  useEffect(() => { if (resource.data && resource.data.postByDefault === pendingDefault) setPendingDefault(null); }, [resource.data, pendingDefault]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null); setMessage(null);
    try {
      await appApi("/api/app/social", { method: "POST", body: JSON.stringify({ network, name, prefix, credential, ...(network !== "x" && host.trim() ? { host: host.trim() } : {}), ...(network === "bluesky" ? { identifier } : {}), scopes: network === "x" ? ["tweet.write"] : network === "mastodon" ? ["write:statuses"] : [] }) });
      setName(""); setPrefix(""); setCredential(""); setIdentifier(""); setHost(""); resource.refresh(); setMessage("Social account connected.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The social account could not be connected."); }
    finally { setSaving(false); }
  }
  async function remove(account: SocialAccount) {
    setSaving(true); setError(null); setMessage(null);
    try { await appApi(`/api/app/social/${account.id}`, { method: "DELETE" }); resource.refresh(); setMessage(`${account.name} removed.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The account could not be removed."); }
    finally { setSaving(false); }
  }
  async function changeDefault(postByDefault: boolean) {
    setPendingDefault(postByDefault); setSaving(true); setError(null); setMessage(null);
    try { await appApi("/api/app/social", { method: "PATCH", body: JSON.stringify({ postByDefault }) }); resource.refresh(); setMessage("Social posting default saved."); }
    catch (cause) { setPendingDefault(null); setError(cause instanceof Error ? cause.message : "The posting default could not be saved."); }
    finally { setSaving(false); }
  }
  return <section className="data-card channels-card" aria-labelledby="social-accounts-title">
    <div><p className="card-kicker">Social accounts</p><h2 id="social-accounts-title">X, Bluesky and Mastodon</h2><p>Post incident updates to the page’s accounts. Credentials are encrypted and never shown again. Choose Social accounts on each update to post.</p></div>
    {resource.data?.accounts.length ? <ul className="channel-list">{resource.data.accounts.map(account => <li key={account.id}><span><strong>{account.name}</strong> · {networkNames[account.network]} · {account.host}</span><span className="channel-actions"><Button type="button" variant="secondary" className="table-action" disabled={saving} aria-label={`Remove ${account.name}`} onClick={() => void remove(account)}>Remove</Button></span></li>)}</ul> : <EmptyState>No social accounts connected.</EmptyState>}
    <label className="checkbox-label"><input type="checkbox" checked={pendingDefault ?? resource.data?.postByDefault ?? false} disabled={saving || !resource.data} onChange={event => void changeDefault(event.target.checked)} />Post by default</label>
    <form className="channel-form" onSubmit={connect}>
      <label className="form-label">Social network<select aria-label="Social network" value={network} disabled={saving} onChange={event => { setNetwork(event.target.value as Network); setCredential(""); setHost(""); setIdentifier(""); }}><option value="x">X</option><option value="bluesky">Bluesky</option><option value="mastodon">Mastodon</option></select></label>
      <label className="form-label">Account name<input required maxLength={120} disabled={saving} value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="form-label full-width">Post prefix<input maxLength={80} disabled={saving} value={prefix} onChange={event => setPrefix(event.target.value)} placeholder="Status update:" /></label>
      {network === "bluesky" && <label className="form-label">Bluesky handle<input required maxLength={253} disabled={saving} autoComplete="off" value={identifier} onChange={event => setIdentifier(event.target.value)} /></label>}
      {network !== "x" && <label className="form-label">{network === "mastodon" ? "Mastodon instance" : "Bluesky service"}<input required={network === "mastodon"} type="url" disabled={saving} value={host} onChange={event => setHost(event.target.value)} placeholder={network === "mastodon" ? "https://mastodon.social" : "https://bsky.social"} /></label>}
      <label className="form-label full-width">{network === "bluesky" ? "Bluesky app password" : network === "mastodon" ? "Mastodon access token (write:statuses)" : "X OAuth 2.0 user token (tweet.write)"}<input required type="password" autoComplete="off" maxLength={4096} disabled={saving} value={credential} onChange={event => setCredential(event.target.value)} /></label>
      {network === "x" && <p className="full-width">Use a user token from your X developer app with tweet.write permission. Your X API tier and costs apply.</p>}
      <Button type="submit" disabled={saving || resource.loading}>{saving ? "Saving…" : "Connect social account"}</Button>
    </form>
    {(error || resource.error) && <FormError>{error || resource.error}</FormError>}
    {message && <p role="status">{message}</p>}
    {resource.data?.posts.length ? <details><summary>Social delivery log</summary><ul className="channel-posts">{resource.data.posts.map(post => <li key={post.id}>{post.reference} → {post.account} ({post.network}): {post.state} · {post.attempts} attempts · Queued {post.queuedAt}{post.outcomeAt ? ` · Outcome ${post.outcomeAt}` : ""}{post.postId ? <> · Post ID: {post.postId}</> : null}</li>)}</ul></details> : null}
  </section>;
}
