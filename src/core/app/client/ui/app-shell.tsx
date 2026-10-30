import { EditorLauncher } from '../../../../editor/EditorLauncher';
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import type { StoredOperator } from "../../../features/operators/repository";
import { SETTINGS_MENU, settingsLabel, useSettingsDestination, type SettingsDestination } from "../../../features/page-settings/ui/settings-tabs";
import { ApiError, appApi, useAppData, AppDataContext } from "./api";
import type { OperatorSessionView } from "../../loaders";
import type { EditorConfig } from "../../../../editor/editor-widget";
import { PageTimezoneContext } from "./timezone";
import { Icon, type IconName } from "./icon";
import { badge } from "../../../../site/lamp/badge";
import { ClientExtensionProvider } from "../extensions";
import { FormError } from "./states";
import { useVisitSnapshot } from "./visit-snapshot";
import { mayLeave } from "./leave-guard";

type NavigationItem = {
  to: "/app" | "/app/incidents" | "/app/components" | "/app/maintenance" | "/app/subscribers" | "/app/settings";
  label: string;
  icon: IconName;
};

// The daily jobs. Configuration lives under Settings, which takes this rail over (SettingsMenu).
const navigation: NavigationItem[] = [
  { to: "/app", label: "Overview", icon: "overview" },
  { to: "/app/incidents", label: "Incidents", icon: "incident" },
  { to: "/app/components", label: "Components", icon: "components" },
  { to: "/app/maintenance", label: "Maintenance", icon: "maintenance" },
  { to: "/app/subscribers", label: "Subscribers", icon: "subscribers" },
  { to: "/app/settings", label: "Settings", icon: "settings" },
];

function Brand() {
  return <Link className="app-brand" to="/app" aria-label="Lamp overview"><img className="app-brand-mark" src={badge} alt="" width="28" height="28" /><span data-rer-name>Lamp</span></Link>;
}

function DailyMenu({ onNavigate }: { onNavigate: () => void }) {
  return <nav aria-label="Workspace sections" className="operator-navigation">
    {navigation.map((item) => (
      <Link key={item.to} to={item.to} activeOptions={{ exact: item.to === "/app" }} className="operator-nav-link" activeProps={{ className: "operator-nav-link is-active" }} onClick={onNavigate}>
        <Icon name={item.icon} width={20} height={20} />
        <span>{item.label}</span>
      </Link>
    ))}
  </nav>;
}

/** On any Settings address the same rail lists Settings' destinations; the one shown is its highlight. */
function SettingsMenu({ current, onNavigate }: { current: SettingsDestination; onNavigate: () => void }) {
  return <nav aria-label="Settings sections" className="operator-navigation settings-menu">
    <Link to="/app" activeOptions={{ exact: true }} className="settings-menu-back" onClick={onNavigate}><Icon name="back" width={18} height={18} /><span>Overview</span></Link>
    <p className="settings-menu-title">Settings</p>
    {SETTINGS_MENU.map(({ topic, destinations }) => <div key={topic} className="settings-menu-topic" role="group" aria-labelledby={`settings-topic-${destinations[0].id}`}>
      <p id={`settings-topic-${destinations[0].id}`}>{topic}</p>
      {destinations.map((destination) => {
        const link = { className: `operator-nav-link${destination.id === current ? " is-active" : ""}`, "aria-current": destination.id === current ? "page" as const : undefined, onClick: onNavigate };
        const label = <><Icon name={destination.icon} width={18} height={18} /><span>{destination.label}</span></>;
        // The router marks a link current by its path alone; the pane, aliases included, decides here.
        return destination.id === "move-in"
          ? <Link key={destination.id} to="/app/move-in" activeOptions={{ exact: true }} {...link}>{label}</Link>
          : <Link key={destination.id} to="/app/settings" hash={destination.id} activeOptions={{ includeHash: true }} {...link}>{label}</Link>;
      })}
    </div>)}
  </nav>;
}

export function OperatorShell({ initialSession }: { initialSession: OperatorSessionView }) {
  const { href, pathname } = useRouterState({ select: (state) => ({ href: state.location.href, pathname: state.location.pathname }), structuralSharing: true });
  const snapshot = useVisitSnapshot(initialSession.data, initialSession.path, href, pathname);
  return <AppDataContext.Provider value={snapshot}><OperatorWorkspace initialSession={initialSession} /></AppDataContext.Provider>;
}

function OperatorWorkspace({ initialSession }: { initialSession: OperatorSessionView }) {
  const sessionRequest = useAppData<{ operator: StoredOperator; publicPageHost: string }>("/api/app/session");
  const pageSettingsRequest = useAppData<{ settings: { timezone: string } }>("/api/app/page-settings");
  useEffect(() => {
    const changed = () => pageSettingsRequest.refresh();
    window.addEventListener("lamp:page-settings-changed", changed);
    return () => window.removeEventListener("lamp:page-settings-changed", changed);
  }, [pageSettingsRequest.refresh]);
  const operator = sessionRequest.data?.operator ?? initialSession.operator;
  const location = useRouterState({ select: (state) => state.location.href });
  const settings = useSettingsDestination();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
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

  // On a phone the pill above a Settings pane opens the menu sheet at the top, on the destination shown.
  function openSettingsMenu() {
    setMenuOpen(true);
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus());
  }

  const closeMenu = () => setMenuOpen(false);

  return (
    <PageTimezoneContext.Provider value={pageSettingsRequest.data?.settings.timezone ?? initialSession.timezone}>
    <ClientExtensionProvider operatorId={operator.id}>
    <EditorLauncher authorized={operator.isSetupOperator && !sessionRequest.error} initialConfig={initialSession.data["/api/app/editor-config"]?.error ? undefined : initialSession.data["/api/app/editor-config"]?.data as EditorConfig | undefined} />
    <div className="operator-shell" data-hydrated={hydrated || undefined}>
      <aside className={`operator-rail${settings ? " is-settings" : ""}`} aria-label="Operator navigation">
        <div className="operator-brand-row"><Brand /><button ref={menuButton} type="button" className="button button-secondary operator-menu-button" aria-expanded={menuOpen} aria-controls="operator-navigation-panel" onClick={() => setMenuOpen(open => !open)}>Menu</button></div>
        <div ref={panel} id="operator-navigation-panel" className={`operator-navigation-panel${menuOpen ? " is-open" : ""}`} onKeyDown={event => { if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus(); } }}>
        {settings ? <SettingsMenu current={settings} onNavigate={closeMenu} /> : <DailyMenu onNavigate={closeMenu} />}
        <div className="operator-rail-footer">
          <a href={`${publicOrigin}/`} className="operator-page-link" target="_blank" rel="noopener">View your page <Icon name="external" width={15} height={15} /></a>
          <div className="operator-account">
            <span className="operator-initial" aria-hidden="true">{operator.displayName.trim().charAt(0).toUpperCase()}</span>
            <span className="operator-name">{operator.displayName}</span>
            <form action="/api/app/session/signout" method="post" onSubmit={event => { event.preventDefault(); void signOut(); }}><button type="submit" className="operator-signout" disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button></form>
          </div>
        </div>
        </div>
      </aside>
      <div className="operator-workspace">
        <main className="operator-main">
          {signOutError && <FormError>{signOutError}</FormError>}
          {settings && <button type="button" className="settings-pill" aria-expanded={menuOpen} aria-controls="operator-navigation-panel" onClick={openSettingsMenu}><Icon name="settings" width={18} height={18} />Settings: {settingsLabel(settings)}<Icon name="chevron" width={16} height={16} /></button>}
          <Outlet />
        </main>
      </div>
    </div>
    </ClientExtensionProvider>
    </PageTimezoneContext.Provider>
  );
}
