import type { HouseStyleRecord } from "./repository.ts";

/** Why a page shows Calm headline where its house style would be. Each is its own kind, named by the public page's
 *  foot and by Settings' Template card alike. */
export type HouseStyleReason = "not-connected" | "making" | "failed" | "refused";

export interface HouseStyleShowing {
  /** The stored house style is on the page. */
  shown: boolean;
  /** Set when the page shows Calm headline because the house style can't show. */
  reason: HouseStyleReason | null;
  /** The latest attempt's own sentence when a make failed or was refused. */
  detail: string | null;
}

/** What a page that chose `template` wears, and why, for the public page and Settings alike. House style shows once
 *  one is stored, through a re-make and without the binding; until then the page shows Calm headline, its fallback.
 *  Calm headline also says when the install can't make house styles: it is what Setup saves on such an install. */
export function houseStyleShowing(template: string, connected: boolean, record: HouseStyleRecord | null): HouseStyleShowing {
  if (template === "house") {
    if (record?.made) return { shown: true, reason: null, detail: null };
    if (!connected) return { shown: false, reason: "not-connected", detail: null };
    if (record?.state === "failed" || record?.state === "refused") return { shown: false, reason: record.state, detail: record.reason };
    return { shown: false, reason: "making", detail: null };
  }
  if (template === "calm" && !connected) return { shown: false, reason: "not-connected", detail: null };
  return { shown: false, reason: null, detail: null };
}
