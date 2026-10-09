import { EditorLauncher } from '../../../../editor/EditorLauncher';
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { StoredOperator } from "../../../features/session/repository";
import { appApi, useAppData } from "./api";
import { Button } from "./button";
import { Icon } from "./icon";
import { ClientExtensionProvider } from "../extensions";

type NavigationItem = {
  to: "/app" | "/app/incidents" | "/app/components" | "/app/maintenance" | "/app/subscribers" | "/app/deliveries" | "/app/alerts" | "/app/settings";
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
};

const navigation: NavigationItem[] = [
  { to: "/app", label: "Overview", icon: "overview" },
  { to: "/app/incidents", label: "Incidents", icon: "incident" },
  { to: "/app/components", label: "Components", icon: "components" },
  { to: "/app/maintenance", label: "Maintenance", icon: "maintenance" },
  { to: "/app/subscribers", label: "Subscribers", icon: "subscribers" },
  { to: "/app/deliveries", label: "Deliveries", icon: "deliveries" },
  { to: "/app/alerts", label: "Alerts", icon: "warning" },
  { to: "/app/settings", label: "Settings", icon: "settings" },
];

function Brand() {
  return <Link className="app-brand" to="/app" aria-label="Lamp overview"><span aria-hidden="true" className="brand-mark">◆</span>Lamp</Link>;
}

export function OperatorShell({ initialSession }: { initialSession: { operator: StoredOperator; publicPageOrigin: string } }) {
  const sessionRequest = useAppData<{ operator: StoredOperator; publicPageHost: string }>("/api/app/session");
  const operator = sessionRequest.data?.operator ?? initialSession.operator;
  const location = useRouterState({ select: (state) => state.location.href });
  const [signingOut, setSigningOut] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navigationRef.current;
    const active = nav?.querySelector<HTMLElement>(".is-active");
    if (nav && active && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = active.offsetLeft - nav.offsetLeft - 8;
  }, [location]);

  useEffect(() => {
    if (sessionRequest.error?.includes("session")) {
      window.location.assign(`/signin?returnTo=${encodeURIComponent(location)}`);
    }
  }, [location, sessionRequest.error]);

  const publicOrigin = initialSession.publicPageOrigin;
  async function signOut() {
    setSigningOut(true);
    try { await appApi<void>("/api/app/session/signout", { method: "POST" }); }
    finally { window.location.assign("/signin"); }
  }

  return (
    <ClientExtensionProvider operatorId={operator.id}>
    <EditorLauncher authorized={operator.isSetupOperator && !sessionRequest.error} />
    <div className="operator-shell">
      <aside className="operator-rail" aria-label="Operator navigation">
        <Brand />
        <nav ref={navigationRef} className="operator-navigation">
          {navigation.map((item) => (
            <Link key={item.to} to={item.to} activeOptions={{ exact: item.to === "/app" }} className="operator-nav-link" activeProps={{ className: "operator-nav-link is-active" }}>
              <Icon name={item.icon} width={18} height={18} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="operator-rail-footer">
          <a href={`${publicOrigin}/history`} className="operator-history-link"><Icon name="external" width={15} height={15} />Public history</a>
          <p>One status page, one public record.</p>
        </div>
      </aside>
      <div className="operator-workspace">
        <header className="operator-header">
          <p><span className="header-live-dot" />Operator workspace</p>
          <div className="operator-account"><div className="operator-identity"><span>{operator.displayName}</span><small>{operator.email}</small></div><Button type="button" variant="secondary" className="header-signout" disabled={signingOut} onClick={signOut}>{signingOut ? "Signing out…" : "Sign out"}</Button></div>
        </header>
        <main className="operator-main"><Outlet /></main>
      </div>
    </div>
    </ClientExtensionProvider>
  );
}

export function SignInPage({ publicPageOrigin }: { publicPageOrigin: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const publicOrigin = publicPageOrigin;

  async function requestLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true); setStatus("idle"); setError(null);
    try {
      const response = await fetch("/signin/request", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/plain" }, body: new URLSearchParams({ email }) });
      const body = await response.text();
      if (!response.ok) throw new Error(body || "The sign-in link could not be requested.");
      setConfirmation(body);
      setStatus("sent");
    } catch (cause) {
      setStatus("error"); setError(cause instanceof Error ? cause.message : "The sign-in link could not be requested.");
    } finally { setSubmitting(false); }
  }

  return (
    <main className="signin-page">
      <section className="signin-card" aria-labelledby="signin-title">
        <Brand />
        <p className="eyebrow">Operator access</p>
        <h1 id="signin-title">Sign in with a magic link</h1>
        <p>Request a secure, single-use link to sign in.</p>
        <form className="signin-form" onSubmit={requestLink}>
          <label className="signin-label" htmlFor="operator-email">Email address</label>
          <input id="operator-email" name="email" type="email" autoComplete="email" required placeholder="operator@example.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={!ready || submitting} />
          <Button disabled={!ready || submitting}>{!ready ? "Preparing sign-in…" : submitting ? "Sending…" : "Send magic link"}<Icon name="arrow" width={17} height={17} /></Button>
        </form>
        {status === "sent" && <section className="signin-confirmation" aria-live="polite"><Icon name="check" width={22} height={22} /><div><strong>Sign-in requested</strong><p>{confirmation}</p></div></section>}
        {status === "error" && <p className="signin-error" role="alert">{error}</p>}
        <a className="quiet-link signin-public-link" href={publicOrigin}>View the public status page <Icon name="external" width={15} height={15} /></a>
      </section>
    </main>
  );
}
