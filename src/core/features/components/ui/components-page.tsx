import { useEffect, useState } from "react";

import type { ComponentsService } from "../service";
import { useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { LoadingState, FormError } from "../../../app/client/ui/states";
import { ErrorState } from "../../../app/client/ui/lit-states";
import { CatalogueDrawer } from "./catalogue-drawer";
import { ComponentDrawer } from "./component-drawer";
import { ComponentGroups } from "./component-list";

type ComponentsResponse = {
  components: Awaited<ReturnType<ComponentsService["list"]>>;
  groups: Awaited<ReturnType<ComponentsService["listGroups"]>>;
};
type Panel = { kind: "create" } | { kind: "component"; id: string };

export function ComponentsPage() {
  const { data, error, loading, refresh } = useAppData<ComponentsResponse>("/api/app/components");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [editAllOpen, setEditAllOpen] = useState(false);
  useEffect(() => {
    if (data?.components.length === 0) setPanel(current => current ?? { kind: "create" });
  }, [data?.components.length]);
  if (loading && !data) return <LoadingState />;
  if (!data) return error ? <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState> : null;

  // A drawer follows its component through refreshes by id, so an open drawer keeps its part and typed values.
  const open = panel?.kind === "component" ? data.components.find((component) => component.id === panel.id) ?? null : null;
  const nextComponentOrder = Math.max(0, ...data.components.map((component) => component.displayOrder + 1));
  const closeAndRefresh = () => { setPanel(null); refresh(); };

  return <div className="page-stack components-page">
    <section className="page-title-row component-title-row"><div><h1>Components</h1><p>Manage the services on your status page.</p></div><div className="component-title-actions"><Button variant="secondary" type="button" onClick={() => setEditAllOpen(true)}>Edit all</Button><Button type="button" onClick={() => setPanel({ kind: "create" })}>Add component</Button></div></section>
    {/* A failed refresh is said here and leaves the list and any open drawer in place. */}
    {error ? <FormError>{error}</FormError> : null}
    <ComponentGroups groups={data.groups} components={data.components} openId={open?.id ?? null} onOpen={(component) => setPanel({ kind: "component", id: component.id })} />
    {editAllOpen && <CatalogueDrawer onClose={() => setEditAllOpen(false)} onSaved={() => { setEditAllOpen(false); refresh(); }} />}
    {panel?.kind === "create" && <ComponentDrawer key="create" component={null} groups={data.groups} defaultDisplayOrder={nextComponentOrder} onClose={() => setPanel(null)} onSaved={closeAndRefresh} />}
    {open && <ComponentDrawer key={open.id} component={open} groups={data.groups} defaultDisplayOrder={nextComponentOrder} onClose={() => setPanel(null)} onSaved={closeAndRefresh} />}
  </div>;
}
