import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./icon";

export function Drawer({ title, eyebrow, children, onClose, className = "" }: { title: string; eyebrow: string; children: ReactNode; onClose: () => void; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const panel = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    panel?.showModal();
    document.body.style.overflow = "hidden";
    panel?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    return () => { panel?.close(); document.body.style.overflow = overflow; trigger?.focus(); };
  }, []);
  return <dialog ref={dialog} className={`claim-drawer component-drawer ${className}`} aria-labelledby={titleId} onKeyDown={(event) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((node) => node.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) onClose();
  }}>
    <div className="drawer-heading"><div><p className="eyebrow">{eyebrow}</p><h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close component panel"><Icon name="close" width={19} height={19} /></button></div>
    {children}
  </dialog>;
}
