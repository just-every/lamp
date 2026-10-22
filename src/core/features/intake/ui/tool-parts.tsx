import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "../../../app/client/ui/button";
import { CopyButton } from "../../../app/client/ui/copy-button";
import { Icon } from "../../../app/client/ui/icon";
import { FormError } from "../../../app/client/ui/states";
import type { SavePhase } from "./use-source-autosave";

/** The open tool's heading: what it is, the one line of what it does, and the way back. Opening a form brings it into view. */
export function ToolHeading({ title, does, close }: { title: string; does: string; close: { label: string; onClick: () => void } }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <div className="card-heading tool-form-heading">
    <div><h2 id="tool-form-title" ref={heading} tabIndex={-1}>{title}</h2><p className="card-support">{does}</p></div>
    <Button type="button" variant="secondary" className="table-action" onClick={close.onClick}>{close.label}</Button>
  </div>;
}

/** The quiet state of a connected tool's choices, as in Settings. */
export function SaveNote({ phase, error, retry }: { phase: SavePhase; error: string | null; retry: () => void }) {
  return <div className="tool-save-state">
    <p className="settings-save-note" role="status" aria-live="polite">
      {phase === "saved" && <Icon name="check" width={16} height={16} />}
      {phase === "error" ? "Not saved" : phase === "saving" ? "Saving…" : phase === "waiting" ? "Waiting to save…" : "Saved"}
    </p>
    {error && <p className="save-message" role="alert">{error} <Button type="button" variant="secondary" className="table-action" onClick={retry}>Retry</Button></p>}
  </div>;
}

export type Copyable = { label: string; value: string; copy: string; multiline?: boolean };

/** A value to paste into the tool, selectable, with its own Copy. */
export function CopyField({ label, value, copy, multiline = false }: Copyable) {
  return <div className="copy-field">
    <label className="form-label">{label}{multiline ? <textarea readOnly rows={8} value={value} onFocus={event => event.target.select()} /> : <input readOnly value={value} onFocus={event => event.target.select()} />}</label>
    <CopyButton text={value} label={copy} />
  </div>;
}

/** What Lamp made for the tool, shown once: the owner copies it into the tool, then closes the form. Focus moves to the first value. */
export function ShownOnce({ children, fields, onDone, once = true }: { children: ReactNode; fields: Copyable[]; onDone: () => void; once?: boolean }) {
  const block = useRef<HTMLDivElement>(null);
  useEffect(() => { block.current?.querySelector<HTMLElement>("input, textarea")?.focus(); }, []);
  return <div className="shown-once" ref={block}>
    <p role="status">{once && <strong>Copy it now; it's shown once. </strong>}{children}</p>
    {fields.map(field => <CopyField key={field.label} {...field} />)}
    <div className="form-actions"><Button type="button" onClick={onDone}>Done</Button></div>
  </div>;
}

/** Component choices, the empty choice first; a required choice cannot go back to empty. */
export function ComponentOptions({ components, empty, required = false }: { components: Array<{ id: string; name: string }>; empty: string; required?: boolean }) {
  return <><option value="" disabled={required}>{empty}</option>{components.map(component => <option key={component.id} value={component.id}>{component.name}</option>)}</>;
}

/** A new key for a connected tool, after one confirm: the old one stops working at once. */
export function NewKey({ what, replace }: { what: string; replace: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    setBusy(true); setError(null);
    try { await replace(); setConfirming(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : `The new ${what} could not be made.`); }
    finally { setBusy(false); }
  }
  if (!confirming) return <div className="form-actions tool-key-actions"><Button type="button" variant="secondary" onClick={() => setConfirming(true)}>New {what}</Button></div>;
  return <div className="tool-confirm" role="group" aria-label={`New ${what}`}>
    <p>The current {what} stops working.</p>
    <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>Keep it</Button><Button type="button" disabled={busy} onClick={() => void confirm()}>{busy ? "Making…" : `Make a new ${what}`}</Button></div>
    {error && <FormError>{error}</FormError>}
  </div>;
}
