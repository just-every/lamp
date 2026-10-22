import type { HouseStyleReason } from "../../house-style/showing.ts";
import type { PublicSnapshotModel } from "../renderer";
import { escapeHtml } from "../format";

const says: Record<HouseStyleReason, (detail: string | null) => string> = {
  "not-connected": () => "This page shows Calm headline: its house style is made with Workers AI, which this page isn't connected to yet.",
  making: () => "This page shows Calm headline while its house style is being made.",
  failed: (detail) => `This page shows Calm headline because its house style couldn't be made.${detail ? ` ${detail}` : ""}`,
  refused: (detail) => `This page shows Calm headline until its house style can be made.${detail ? ` ${detail}` : ""}`,
};

/** The foot's one line on which template shows and why, whenever Calm headline stands in for the house style. Each
 *  reason is its own kind in `data-reason`, as Settings' Template card names it. */
export function styleNote(model: PublicSnapshotModel) {
  const { reason, detail } = model.house.showing;
  return reason ? `<p class="tpl-style-note" data-house-style data-reason="${reason}">${escapeHtml(says[reason](detail))}</p>` : "";
}
