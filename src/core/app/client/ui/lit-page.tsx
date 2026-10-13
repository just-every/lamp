import type { ReactNode } from "react";
import { LampPool } from "../../../../site/lamp/sections/LampPool";
import { StaticLamp } from "../../../../site/lamp/sections/StaticLamp";

// The page a person waits on before the workspace (sign-in, first-run setup): the landing's lit pendant hangs on its
// cord from the top edge and its pool of light falls on the card.
export function LitPage({ children }: { children: ReactNode }) {
  return <main className="signin-page"><StaticLamp className="signin-lamp" /><LampPool className="signin-pool" />{children}</main>;
}
