import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { Glyph, type GlyphName } from "./local-glyphs";

/** One entry of the + menu. With `panel` it opens that option panel under the Publish row; with `target` it moves
 * to that element (a field it showed); otherwise it acts at once and focus returns to the +. */
export type OptionEntry = { key: string; label: string; glyph: GlyphName; value?: string; panel?: string; target?: string; disabled?: boolean; onSelect?: () => void };
/** A one-of choice drawn as pills inside the menu: New incident's starting status. */
export type OptionChoice = { options: readonly string[]; value: string; onChange: (value: string) => void };
export type OptionGroup = { caption: string; entries?: OptionEntry[]; choice?: OptionChoice };

// The phone width where the menu becomes a bottom sheet, as the responsive rules draw it.
const SHEET = "(max-width: 620px)";
// An opened panel focuses its first text, time or select field, else its first control.
const FIELD = 'input:not([type="checkbox"], [type="radio"], [disabled]), select:not([disabled]), textarea:not([disabled])';
const FOCUSABLE = "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])";

type Panels = { open: string | null; idFor: (name: string) => string; close: () => void };
const PanelContext = createContext<Panels>({ open: null, idFor: name => name, close: () => {} });

/** The Publish row's "Update options" (+): everything an update can carry beyond its first fields, in four captioned
 * groups. Above 620 px a menu drops down from the +; at 620 px and under a bottom sheet rises. Every option panel stays
 * mounted while closed, so nothing chosen or typed in one is lost, and only one is open at a time. */
export function UpdateOptions({ groups, footer, message, children }: { groups: OptionGroup[]; footer: ReactNode; message?: ReactNode; children?: ReactNode }) {
  const base = useId();
  const idFor = useCallback((name: string) => `${base}-option-${name}`, [base]);
  const [popup, setPopup] = useState<"menu" | "sheet" | null>(null);
  const [panel, setPanel] = useState<string | null>(null);
  // What takes focus once it is on screen: an opened panel's first control, or a field an entry showed.
  const [focusTarget, setFocusTarget] = useState<{ id: string; inside: boolean } | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const startAt = useRef<"first" | "last">("first");
  // Focus returns to the + once the menu or sheet is gone: a modal sheet keeps the page inert until it closes.
  const returnFocus = useRef(false);
  const menuId = `${base}-menu`, titleId = `${base}-title`;

  const dismiss = useCallback((refocus: boolean) => { returnFocus.current = refocus; setPopup(null); }, []);
  const show = (at: "first" | "last") => { startAt.current = at; setPopup(window.matchMedia(SHEET).matches ? "sheet" : "menu"); };
  const closePanel = useCallback(() => { setPanel(null); toggle.current?.focus(); }, []);

  useEffect(() => {
    if (!popup) {
      if (returnFocus.current) toggle.current?.focus();
      returnFocus.current = false;
      return;
    }
    if (popup === "sheet" && sheet.current && !sheet.current.open) sheet.current.showModal();
    const items = menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]');
    (startAt.current === "last" ? items?.[items.length - 1] : items?.[0])?.focus();
    if (popup !== "menu") return;
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!menu.current?.contains(target) && !toggle.current?.contains(target)) dismiss(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [popup, dismiss]);

  useEffect(() => {
    if (!focusTarget) return;
    const node = document.getElementById(focusTarget.id);
    node?.scrollIntoView({ block: "nearest" });
    (focusTarget.inside ? node?.querySelector<HTMLElement>(FIELD) ?? node?.querySelector<HTMLElement>(FOCUSABLE) : node)?.focus({ preventScroll: true });
  }, [focusTarget]);

  const choose = (entry: OptionEntry) => {
    if (entry.disabled) return;
    const moves = Boolean(entry.panel || entry.target);
    dismiss(!moves);
    entry.onSelect?.();
    if (entry.panel) { setPanel(entry.panel); setFocusTarget({ id: idFor(entry.panel), inside: true }); }
    if (entry.target) setFocusTarget({ id: entry.target, inside: false });
  };
  const onToggleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    show(event.key === "ArrowUp" ? "last" : "first");
  };
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => { event.preventDefault(); items[(next + items.length) % items.length]?.focus(); };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else if (popup === "menu" && (event.key === "Escape" || event.key === "Tab")) { event.preventDefault(); dismiss(true); }
  };

  const tabIndex = popup === "sheet" ? 0 : -1;
  const list = <div ref={menu} id={menuId} role="menu" className="option-menu" {...(popup === "sheet" ? { "aria-labelledby": titleId } : { "aria-label": "Update options" })} onKeyDown={onMenuKey}>
    {groups.map(group => <div key={group.caption} role="group" aria-label={group.caption} className="option-menu-group">
      <div className="option-caption" aria-hidden="true">{group.caption}</div>
      {group.choice ? <div className="option-choice">{group.choice.options.map(option => <button key={option} type="button" role="menuitemradio" aria-checked={group.choice!.value === option} tabIndex={tabIndex} className="choice-pill" onClick={() => group.choice!.onChange(option)}>{option}</button>)}</div> : null}
      {group.entries?.map(entry => <button key={entry.key} type="button" role="menuitem" tabIndex={tabIndex} aria-disabled={entry.disabled || undefined} className="option-entry" onClick={() => choose(entry)}>
        <Glyph name={entry.glyph} className="option-glyph" /><span className="option-label">{entry.label}</span>{entry.value ? <>{" "}<span className="option-value">{entry.value}</span></> : null}
      </button>)}
    </div>)}
  </div>;

  return <>
    <div className="composer-footer">
      <div className="update-options">
        <button ref={toggle} type="button" className="update-options-toggle" aria-label="Update options" aria-haspopup="menu" aria-expanded={popup !== null} aria-controls={popup ? menuId : undefined} onClick={() => popup ? dismiss(true) : show("first")} onKeyDown={onToggleKey}><Icon name="plus" width={20} height={20} /></button>
        {popup === "menu" ? <div className="update-options-menu">{list}</div> : null}
      </div>
      {footer}
    </div>
    {popup === "sheet" ? <dialog ref={sheet} className="update-options-sheet" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); dismiss(true); }} onClick={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.target === event.currentTarget && (event.clientY < bounds.top || event.clientX < bounds.left || event.clientX > bounds.right)) dismiss(true);
    }}>
      <div className="sheet-grabber" aria-hidden="true" />
      <div className="sheet-heading"><h2 id={titleId}>Update options</h2><button type="button" className="sheet-close" aria-label="Close options" onClick={() => dismiss(true)}><Icon name="close" width={20} height={20} /></button></div>
      {list}
    </dialog> : null}
    {message}
    <PanelContext.Provider value={{ open: panel, idFor, close: closePanel }}>{children}</PanelContext.Provider>
  </>;
}

/** One option panel under the Publish row, opened from its + entry. It stays mounted while closed; Done closes it. */
export function OptionPanel({ name, title, children }: { name: string; title: string; children: ReactNode }) {
  const { open, idFor, close } = useContext(PanelContext);
  const id = idFor(name);
  return <section id={id} className="option-panel" aria-labelledby={`${id}-title`} hidden={open !== name}>
    <h3 id={`${id}-title`} className="option-panel-title">{title}</h3>
    {children}
    <div className="option-panel-actions"><Button type="button" variant="secondary" onClick={close}>Done</Button></div>
  </section>;
}
