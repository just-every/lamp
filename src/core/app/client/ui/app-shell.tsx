import { EditorLauncher } from '../../../../editor/EditorLauncher';
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import type { StoredOperator } from "../../../features/operators/repository";
import { ApiError, appApi, useAppData, AppDataContext } from "./api";
import type { OperatorSessionView } from "../../loaders";
import type { EditorConfig } from "../../../../editor/editor-widget";
import { PageTimezoneContext } from "./timezone";
import { Icon } from "./icon";
import { badge } from "../../../../site/lamp/badge";
import { ClientExtensionProvider } from "../extensions";
import { FormError } from "./states";
import { useVisitSnapshot } from "./visit-snapshot";
import { mayLeave } from "./leave-guard";
import "./theme-readability.css";

type NavigationItem = {
  to: "/app" | "/app/page" | "/app/incidents" | "/app/components" | "/app/maintenance" | "/app/subscribers" | "/app/deliveries" | "/app/alerts" | "/app/settings";
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
};

const navigation: NavigationItem[] = [
  { to: "/app", label: "Overview", icon: "overview" },
  { to: "/app/page", label: "Your page", icon: "page" },
  { to: "/app/incidents", label: "Incidents", icon: "incident" },
  { to: "/app/components", label: "Components", icon: "components" },
  { to: "/app/maintenance", label: "Maintenance", icon: "maintenance" },
  { to: "/app/subscribers", label: "Subscribers", icon: "subscribers" },
  { to: "/app/deliveries", label: "Deliveries", icon: "deliveries" },
  { to: "/app/alerts", label: "Alerts", icon: "warning" },
  { to: "/app/settings", label: "Settings", icon: "settings" },
];

function Brand() {
  return <Link className="app-brand" to="/app" aria-label="Lamp overview"><img className="app-brand-mark" src={badge} alt="" width="28" height="28" /><span data-rer-name>Lamp</span></Link>;
}

export function OperatorShell({ initialSession }: { initialSession: OperatorSessionView }) {
  const { href, pathname } = useRouterState({ select: (state) => ({ href: state.location.href, pathname: state.location.pathname }), structuralSharing: true });
  const snapshot = useVisitSnapshot(initialSession.data, initialSession.path, href, pathname);
  return <AppDataContext.Provider value={snapshot}><OperatorWorkspace initialSession={initialSession} /></AppDataContext.Provider>;
}

function OperatorWorkspace({ initialSession }: { initialSession: OperatorSessionView }) {
  const sessionRequest = useAppData<{ operator: StoredOperator; publicPageHost: string }>("/api/app/session");
  const pageSettingsRequest = useAppData<{ settings: { timezone: string; theme: { paletteEnabled: boolean } } }>("/api/app/page-settings");
  useEffect(() => {
    const changed = () => pageSettingsRequest.refresh();
    window.addEventListener("lamp:page-settings-changed", changed);
    return () => window.removeEventListener("lamp:page-settings-changed", changed);
  }, [pageSettingsRequest.refresh]);
  const operator = sessionRequest.data?.operator ?? initialSession.operator;
  const location = useRouterState({ select: (state) => state.location.href });
  const movingIn = location.split(/[?#]/)[0] === "/app/move-in";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  useEffect(() => setMenuOpen(false), [location]);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionRequest.error?.includes("session")) {
      window.location.assign(`/signin?returnTo=${encodeURIComponent(location)}`);
    }
  }, [location, sessionRequest.error]);

  const publicOrigin = initialSession.publicPageOrigin;
  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    // Unsaved Settings edits save while the session still holds; a refused save keeps the operator there to see why.
    if (!await mayLeave()) {
      setSigningOut(false);
      setMenuOpen(false);
      return;
    }
    try {
      await appApi<void>("/api/app/session/signout", { method: "POST" });
      window.location.assign("/signin");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) window.location.assign("/signin");
      else {
        setSignOutError("Sign-out failed. Your session may still be active. Please try again.");
        setSigningOut(false);
      }
    }
  }

  const account = <div className="operator-account"><div className="operator-identity"><span>{operator.displayName}</span><small>{operator.email}</small></div><form action="/api/app/session/signout" method="post" onSubmit={event => { event.preventDefault(); void signOut(); }}><button type="submit" className="button button-secondary header-signout" disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button></form></div>;

  return (
    <PageTimezoneContext.Provider value={pageSettingsRequest.data?.settings.timezone ?? initialSession.timezone}>
    <ClientExtensionProvider operatorId={operator.id}>
    <EditorLauncher authorized={operator.isSetupOperator && !sessionRequest.error} initialConfig={initialSession.data["/api/app/editor-config"]?.error ? undefined : initialSession.data["/api/app/editor-config"]?.data as EditorConfig | undefined} />
    <div className="operator-shell" data-hydrated={hydrated || undefined} data-palette-readable={pageSettingsRequest.data?.settings.theme.paletteEnabled || undefined}>
      <aside className="operator-rail" aria-label="Operator navigation">
        <div className="operator-brand-row"><Brand /><button ref={menuButton} type="button" className="button button-secondary operator-menu-button" aria-expanded={menuOpen} aria-controls="operator-navigation-panel" onClick={() => setMenuOpen(open => !open)}>Menu</button></div>
        <div id="operator-navigation-panel" className={`operator-navigation-panel${menuOpen ? " is-open" : ""}`} onKeyDown={event => { if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus(); } }}>
        <nav aria-label="Workspace sections" className="operator-navigation">
          {navigation.map((item) => (
            <Link key={item.to} to={item.to} activeOptions={{ exact: item.to === "/app" }} className={`operator-nav-link${item.to === "/app/settings" && movingIn ? " is-active" : ""}`} aria-current={item.to === "/app/settings" && movingIn ? "page" : undefined} activeProps={{ className: "operator-nav-link is-active" }} onClick={() => setMenuOpen(false)}>
              <Icon name={item.icon} width={20} height={20} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="operator-rail-footer">
          <a href={`${publicOrigin}/`} className="operator-page-link" target="_blank" rel="noopener">View your page <Icon name="external" width={15} height={15} /></a>
        </div>
        </div>
      </aside>
      <div className="operator-workspace">
        <header className={`operator-header${menuOpen ? " is-menu-open" : ""}`}>
          <p><span className="header-live-dot" />Your status page</p>
          {account}
        </header>
        <main className="operator-main">{signOutError && <FormError>{signOutError}</FormError>}<Outlet /></main>
      </div>
    </div>
    </ClientExtensionProvider>
    </PageTimezoneContext.Provider>
  );
}
