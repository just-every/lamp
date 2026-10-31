import { DependencySettings } from "../../dependencies/ui/dependency-settings";
import { useEffect, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";

import type { PageSettingsService } from "../service";
import type { OverviewService } from "../../overview/service";
import { AuditLog } from "../../audit-log/ui/audit-log";
import { YourPageFacts } from "../../overview/ui/your-page";
import { OperatorsPanel } from "../../operators/ui/operators-panel";
import { useAppData } from "../../../app/client/ui/api";
import { useLeaveGuard } from "../../../app/client/ui/leave-guard";
import { FormError, LoadingState } from "../../../app/client/ui/states";
import { ErrorState } from "../../../app/client/ui/lit-states";
import { type AiStatus } from "./ai-assistance-card";
import { settingsLabel, usePaneLeaveGuard, useSettingsTab, type SettingsTab } from "./settings-tabs";
import { PublicResources } from "./public-resources";
import { PageSettingsTab } from "./page-settings-tab";
import { LookSettingsTab } from "./look-settings-tab";
import { NotificationSettingsTab } from "./notification-settings-tab";
import type { TrafficSavePhase } from "./traffic-alert-settings";
import { WritingSettingsTab } from "./writing-settings-tab";
import { TemplatesSettingsTab } from "./templates-settings-tab";
import { ConnectedToolsTab } from "./connected-tools-tab";
import { ReportsSettingsTab } from "./reports-settings-tab";
import { ExportSettingsTab } from "./export-settings-tab";
import { SettingsSaveState } from "./settings-save-state";
import { useSettingsAutosave } from "./use-settings-autosave";

const operatorRoute = getRouteApi("/app");
type SettingsResponse = { settings: Awaited<ReturnType<PageSettingsService["get"]>> };
type OverviewResponse = { overview: Awaited<ReturnType<OverviewService["get"]>> };

// Panes of page settings that save as they change, laid out as one form.
const FORMS = new Set<SettingsTab>(["page", "look", "notifications", "writing", "templates", "embeds"]);
// The one save note sits under the title of every pane that saves. Connected tools' forms show their own.
const SAVES = new Set<SettingsTab>([...FORMS, "operators"]);
// A pane's title says what it is; a line under it only where it adds something.
const LINES: Partial<Record<SettingsTab, string>> = {
  tools: "Alerts from your tools open private drafts. Nothing is public until you publish, or a rule you saved does.",
};

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
  const [trafficPhase, setTrafficPhase] = useState<TrafficSavePhase>("saved");
  // The pane's one save note reads "Saved · live" only once every write on it has landed.
  const phases = tab === "notifications" ? [autosave.phase, trafficPhase] : [autosave.phase];
  const phase = (["error", "saving", "waiting"] as const).find(candidate => phases.includes(candidate)) ?? "saved";
  // Leaving Settings, another pane or signing out waits for pending edits to save; a refused save keeps the owner here with its reason and Retry.
  useLeaveGuard(autosave.leave, autosave.unsaved);
  usePaneLeaveGuard();
  if (loading && !data) return <LoadingState />;
  if (error && !settings) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!settings || !saved) return null;

  const live = overview.data?.overview.live ?? null;
  const components = (overview.data?.overview.components ?? []).filter(component => !component.internal).map(component => ({ id: component.id, name: component.name, state: component.publicState }));
  const markSrc = saved.logoKey ? `/api/app/page-settings/brand/logo?v=${encodeURIComponent(saved.updatedAt)}` : `/api/app/page-settings/brand/mark?v=${encodeURIComponent(saved.updatedAt)}`;

  return <div className="page-stack settings-page" inert={!ready}>
    <section className="page-title-row"><div><h1>{settingsLabel(tab)}</h1>{LINES[tab] && <p>{LINES[tab]}</p>}</div></section>
    {SAVES.has(tab) && <SettingsSaveState phase={phase} error={autosave.error} retry={autosave.retry} />}
    <div className={FORMS.has(tab) ? "settings-form page-stack" : "page-stack"}>
      {tab === "page" && <>
        {live ? <YourPageFacts live={live} pageName={saved.pageName} accentColor={saved.accentColor} components={components} /> : overview.error ? <FormError>{overview.error}</FormError> : null}
        <PageSettingsTab settings={settings} live={live} markSrc={markSrc} update={update} />
      </>}
      {tab === "look" && <LookSettingsTab settings={settings} saved={saved} components={components} update={update} adoptSaved={autosave.adoptSaved} busy={brandBusy} setBusy={setBrandBusy} status={brandStatus} setStatus={setBrandStatus} />}
      {tab === "notifications" && <NotificationSettingsTab settings={settings} live={live} identityEditable={saved.mailIdentityEditable} update={update} needsConfirm={autosave.pending("mailFromAddress")} confirm={() => autosave.confirm("mailFromAddress")} onTrafficPhase={setTrafficPhase} />}
      {tab === "writing" && <WritingSettingsTab settings={settings} aiStatus={aiStatus} update={update} />}
      {tab === "templates" && <TemplatesSettingsTab />}
      {tab === "tools" && <ConnectedToolsTab />}
      {tab === "dependencies" && <DependencySettings />}
      {tab === "embeds" && <PublicResources publicOrigin={publicOrigin} allowedOrigins={settings.widgetAllowedOrigins} onOriginsChange={value => update("widgetAllowedOrigins", value)} appearance={settings.widgetAppearance} onAppearanceChange={(value, immediate) => update("widgetAppearance", value, immediate)} needsConfirm={autosave.pending("widgetAllowedOrigins")} onConfirm={() => autosave.confirm("widgetAllowedOrigins")} />}
      {tab === "operators" && <OperatorsPanel />}
      {tab === "reports" && <ReportsSettingsTab />}
      {tab === "export" && <ExportSettingsTab />}
      {tab === "audit" && <AuditLog />}
    </div>
  </div>;
}
