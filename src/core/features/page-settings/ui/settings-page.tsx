import { useEffect, useState } from "react";
import { Link, getRouteApi } from "@tanstack/react-router";

import type { PageSettingsService } from "../service";
import type { OverviewService } from "../../overview/service";
import { AuditLog } from "../../audit-log/ui/audit-log";
import { useAppData } from "../../../app/client/ui/api";
import { Icon } from "../../../app/client/ui/icon";
import { useLeaveGuard } from "../../../app/client/ui/leave-guard";
import { LoadingState } from "../../../app/client/ui/states";
import { ErrorState } from "../../../app/client/ui/lit-states";
import { ChannelsCard } from "../../channels/ui/channels-card";
import { OperatorsPanel } from "../../operators/ui/operators-panel";
import { ImportDoorSetting } from "./import-door-setting";
import { type AiStatus } from "./ai-assistance-card";
import { PageDataCard } from "../../page-export/ui/page-data-card";
import { SettingsTabs, useSettingsTab } from "./settings-tabs";
import { PublicResources } from "./public-resources";
import { PageSettingsTab } from "./page-settings-tab";
import { NotificationSettingsTab } from "./notification-settings-tab";
import { WritingSettingsTab } from "./writing-settings-tab";
import { SettingsSaveState } from "./settings-save-state";
import { useSettingsAutosave } from "./use-settings-autosave";

const operatorRoute = getRouteApi("/app");
type SettingsResponse = { settings: Awaited<ReturnType<PageSettingsService["get"]>> };
type OverviewResponse = { overview: Awaited<ReturnType<OverviewService["get"]>> };

export function SettingsPage() {
  const { data, error, loading } = useAppData<SettingsResponse>("/api/app/page-settings");
  const overview = useAppData<OverviewResponse>("/api/app/overview");
  const publicOrigin = operatorRoute.useLoaderData().publicPageOrigin;
  const aiStatus = useAppData<AiStatus>("/api/app/ai/status");
  const tab = useSettingsTab();
  const autosave = useSettingsAutosave(data?.settings ?? undefined, () => {
    window.dispatchEvent(new Event("lamp:page-settings-changed"));
    overview.refresh();
  });
  const { settings, saved, update } = autosave;
  const [brandBusy, setBrandBusy] = useState(false);
  const [brandStatus, setBrandStatus] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // Leaving Settings or signing out waits for pending edits to save; a refused save keeps the owner here with its reason and Retry.
  useLeaveGuard(autosave.leave, autosave.unsaved);
  if (loading && !data) return <LoadingState />;
  if (error && !settings) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!settings || !saved) return null;

  const live = overview.data?.overview.live ?? null;
  const components = (overview.data?.overview.components ?? []).filter(component => !component.internal).map(component => ({ name: component.name, state: component.publicState }));
  const markSrc = saved.logoKey ? `/api/app/page-settings/brand/logo?v=${encodeURIComponent(saved.updatedAt)}` : `/api/app/page-settings/brand/mark?v=${encodeURIComponent(saved.updatedAt)}`;
  const configuration = ["page", "notifications", "writing", "embeds"].includes(tab);

  return <div className="page-stack settings-page" inert={!ready}>
    <section className="page-title-row"><h1>Settings</h1></section>
    <SettingsTabs current={tab} />
    {configuration && <SettingsSaveState phase={autosave.phase} error={autosave.error} retry={autosave.retry} />}
    <div className={configuration ? "settings-form page-stack" : "page-stack"}>
      {tab === "page" && <PageSettingsTab settings={settings} saved={saved} live={live} markSrc={markSrc} components={components} update={update} adoptSaved={autosave.adoptSaved} busy={brandBusy} setBusy={setBrandBusy} setStatus={setBrandStatus} />}
      {tab === "notifications" && <NotificationSettingsTab settings={settings} live={live} identityEditable={saved.mailIdentityEditable} update={update} needsConfirm={autosave.pending("mailFromAddress")} confirm={() => autosave.confirm("mailFromAddress")} />}
      {tab === "writing" && <WritingSettingsTab settings={settings} aiStatus={aiStatus} update={update} />}
      {tab === "embeds" && <PublicResources publicOrigin={publicOrigin} allowedOrigins={settings.widgetAllowedOrigins} onOriginsChange={value => update("widgetAllowedOrigins", value)} appearance={settings.widgetAppearance} onAppearanceChange={(value, immediate) => update("widgetAppearance", value, immediate)} needsConfirm={autosave.pending("widgetAllowedOrigins")} onConfirm={() => autosave.confirm("widgetAllowedOrigins")} />}
      {tab === "page" && brandStatus && <p className="save-message" role="status">{brandStatus}</p>}
      {tab === "channels" && <ChannelsCard />}
      {tab === "operators" && <OperatorsPanel />}
      {tab === "data" && <>
        <section className="data-card intake-link-card"><p className="card-kicker">Moving here</p><h2>Move in</h2><p>Bring components, incident history, maintenance and subscribers, with a dry run first and undo after.</p><ImportDoorSetting /><Link className="text-link" to="/app/move-in">Start a move-in <Icon name="arrow" width={16} height={16} /></Link><a className="text-link" href="/app/cutover">Cutover preview</a></section>
        <PageDataCard />
        <AuditLog />
      </>}
    </div>
  </div>;
}
