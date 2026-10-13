import { EditorLauncher } from '../../../../editor/EditorLauncher';
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import type { StoredOperator } from "../../../features/operators/repository";
import { ApiError, appApi, useAppData } from "./api";
import { PageTimezoneContext } from "./timezone";
import { Button } from "./button";
import { Icon } from "./icon";
import { badge } from "../../../../site/lamp/badge";
import { ClientExtensionProvider } from "../extensions";
import { FormError } from "./states";

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
  return <Link className="app-brand" to="/app" aria-label="Lamp overview"><img className="app-brand-mark" src={badge} alt="" width="28" height="28" />Lamp</Link>;
}

export function OperatorShell({ initialSession }: { initialSession: { operator: StoredOperator; publicPageOrigin: string; timezone: string } }) {
  const sessionRequest = useAppData<{ operator: StoredOperator; publicPageHost: string }>("/api/app/session");
  const pageSettingsRequest = useAppData<{ settings: { timezone: string } }>("/api/app/page-settings");
  useEffect(() => {
    const changed = () => pageSettingsRequest.refresh();
    window.addEventListener("lamp:page-settings-changed", changed);
    return () => window.removeEventListener("lamp:page-settings-changed", changed);
  }, [pageSettingsRequest.refresh]);
  const operator = sessionRequest.data?.operator ?? initialSession.operator;
  const location = useRouterState({ select: (state) => state.location.href });
  const navigationRow = useRef<HTMLElement>(null);
  // On narrow screens the sections are one scrolling row of tabs: keep the current one in view.
  useEffect(() => {
    const row = navigationRow.current, active = row?.querySelector<HTMLElement>(".is-active");
    if (row && active && row.scrollWidth > row.clientWidth) row.scrollLeft = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
  }, [location]);
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

  return (
    <PageTimezoneContext.Provider value={pageSettingsRequest.data?.settings.timezone ?? initialSession.timezone}>
    <ClientExtensionProvider operatorId={operator.id}>
    <EditorLauncher authorized={operator.isSetupOperator && !sessionRequest.error} />
    <div className="operator-shell">
      <aside className="operator-rail" aria-label="Operator navigation">
        <Brand />
        <nav ref={navigationRow} aria-label="Workspace sections" className="operator-navigation">
          {navigation.map((item) => (
            <Link key={item.to} to={item.to} activeOptions={{ exact: item.to === "/app" }} className="operator-nav-link" activeProps={{ className: "operator-nav-link is-active" }}>
              <Icon name={item.icon} width={20} height={20} />
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
          <div className="operator-account"><div className="operator-identity"><span>{operator.displayName}</span><small>{operator.email}</small></div><Button type="button" variant="secondary" className="header-signout" disabled={sessionRequest.loading || signingOut} onClick={signOut}>{signingOut ? "Signing out…" : "Sign out"}</Button></div>
        </header>
        <main className="operator-main">{signOutError && <FormError>{signOutError}</FormError>}<Outlet /></main>
      </div>
    </div>
    </ClientExtensionProvider>
    </PageTimezoneContext.Provider>
  );
}
