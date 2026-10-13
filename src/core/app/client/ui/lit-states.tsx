import { LampPool } from "../../../../site/lamp/sections/LampPool";
import { StaticLamp } from "../../../../site/lamp/sections/StaticLamp";
import { Icon } from "./icon";
import type { ReactNode } from "react";

// A page that could not load its records: the dark band with the lit lamp and the API's own message.
export function ErrorState({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return <div className="app-state app-state-error" role="alert">
    <StaticLamp className="error-lamp" />
    <span className="error-light" aria-hidden="true" />
    <div className="error-card"><p className="error-notice">{children}</p><button className="button button-secondary" type="button" onClick={onRetry}>Reload page</button></div>
  </div>;
}

// The empty sentence of a list, centred in its card. The overview's first run hangs the softly lit lamp over its
// empty Active incidents card; a few cards show their own line icon instead.
export function EmptyState({ children, lamp = false, icon }: { children: ReactNode; lamp?: boolean; icon?: Parameters<typeof Icon>[0]["name"] }) {
  return <div className="app-state app-state-empty">
    {lamp ? <><StaticLamp className="empty-lamp" /><LampPool className="empty-pool" /></> : null}
    {icon ? <span className="empty-icon"><Icon name={icon} width={24} height={24} /></span> : null}
    <p>{children}</p>
  </div>;
}
