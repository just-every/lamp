import { useState } from "react";

import type { ComponentView, ComponentsService } from "../service";
import { Drawer } from "../../../app/client/ui/drawer";
import { mayLeave } from "../../../app/client/ui/leave-guard";
import { ComponentDetails } from "./component-details";
import { ComponentHistory } from "./component-history";
import { ComponentStatus } from "./component-status";

type ComponentGroup = Awaited<ReturnType<ComponentsService["listGroups"]>>[number];
const PARTS = ["Details", "Status", "History"] as const;
type Part = (typeof PARTS)[number];

/** One drawer per component, opened on Details. A part stays mounted once shown, so switching keeps what was typed;
 * a new component has only Details until it exists. */
export function ComponentDrawer({ component, groups, defaultDisplayOrder, onClose, onSaved }: { component: ComponentView | null; groups: ComponentGroup[]; defaultDisplayOrder: number; onClose: () => void; onSaved: () => void }) {
  const [part, setPart] = useState<Part>("Details");
  const [shown, setShown] = useState<ReadonlySet<Part>>(() => new Set<Part>(["Details"]));
  const close = async () => { if (await mayLeave()) onClose(); };
  const details = <ComponentDetails component={component} groups={groups} defaultDisplayOrder={defaultDisplayOrder} onCancel={() => void close()} onSaved={onSaved} />;
  if (!component) return <Drawer eyebrow="New component" title="Add component" onClose={() => void close()}>{details}</Drawer>;
  const choose = (next: Part) => { setPart(next); setShown((current) => current.has(next) ? current : new Set([...current, next])); };
  return <Drawer eyebrow="Component" title={component.name} onClose={() => void close()}>
    <div className="preview-switch component-part-switch" role="group" aria-label="Show">{PARTS.map((name) => <button key={name} type="button" aria-pressed={part === name} data-autofocus={part === name ? "" : undefined} onClick={() => choose(name)}>{name}</button>)}</div>
    <div className="component-part" hidden={part !== "Details"}>{details}</div>
    {shown.has("Status") && <div className="component-part" hidden={part !== "Status"}><ComponentStatus component={component} onSaved={onSaved} /></div>}
    {shown.has("History") && <div className="component-part" hidden={part !== "History"}><ComponentHistory component={component} onSaved={onSaved} /></div>}
  </Drawer>;
}
