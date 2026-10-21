import { REPORTING_DAYS } from "../format";
import { textWidth } from "./text-width";

/** The Uptime-history-led heatmap's date axis: a date every week back from today, each starting at its own day's
 *  column, today's ending at the end of the track. The stylesheet keeps as many dates as fit the track's real width,
 *  read by container queries on the track itself (.hm-scroll in styles/history-led.css), so neighbouring dates never
 *  come within GAP pixels of each other at any width. */

// Sizes mirror styles/history-led.css: .hm-axis sets its dates in 10.5px Inter on the track's 90 day columns.
const FONT = 10.5;
const GAP = 6;

interface Label { index: number; week: number; text: string; width: number }

/** The axis's choices, densest first: the weeks back from today each keeps, and the selector for the dates it hides
 *  (the axis lists its dates oldest first, so today's is its last child). Today's date is right-aligned, so it meets
 *  its neighbour first; the second choice drops only that neighbour. */
const CHOICES: ReadonlyArray<{ keeps: (week: number) => boolean; hides: string }> = [
  { keeps: () => true, hides: "" },
  { keeps: (week) => week !== 1, hides: ":nth-last-child(2)" },
  ...[2, 3, 4, 6, 12].map((step) => ({ keeps: (week: number) => week % step === 0, hides: `:not(:nth-last-child(${step}n+1))` })),
  { keeps: (week) => week === 0, hides: ":not(:last-child)" },
];

function labels(days: string[]): Label[] {
  const format = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const found: Label[] = [];
  for (let index = days.length - 1, week = 0; index >= 0; index -= 7, week += 1) {
    const text = format.format(new Date(`${days[index]}T12:00:00Z`));
    found.unshift({ index, week, text, width: textWidth(text, FONT, 400) });
  }
  return found;
}

/** The narrowest track, in whole pixels, on which these dates stay GAP apart. On a track m pixels wide a date starts
 *  index · m / 90 from the left; today's ends (index + 1) · m / 90 from it. */
function narrowest(kept: Label[]) {
  let width = kept.at(-1)!.width;
  for (let at = 0; at + 1 < kept.length; at += 1) {
    const left = kept[at]!, right = kept[at + 1]!, today = right.week === 0;
    const columns = right.index + (today ? 1 : 0) - left.index;
    const ink = left.width + (today ? right.width : 0) + GAP;
    width = Math.max(width, (ink * REPORTING_DAYS) / columns);
  }
  return Math.ceil(width);
}

/** Rules that hide, at each width of the track, the dates it cannot fit: the densest choice that fits wins. */
export function axisStyles(days: string[]) {
  const all = labels(days);
  if (!all.length) return "";
  const rules: string[] = [];
  let below = Infinity;
  CHOICES.forEach((choice, rank) => {
    const from = rank === CHOICES.length - 1 ? 0 : narrowest(all.filter((label) => choice.keeps(label.week)));
    if (from >= below) return;
    if (choice.hides) rules.push(`@container ${from ? `(${from}px <= width < ${below}px)` : `(width < ${below}px)`}{.hm-axis span${choice.hides}{display:none}}`);
    below = from;
  });
  return rules.join("");
}

/** The axis's markup. Its last day names the layout: an open page refreshing in place reloads instead when the
 *  stylesheet it has was laid out for other dates (script.js). */
export function axisMarkup(days: string[]) {
  const spans = labels(days).map((label) => `<span class="d${label.index + 1}${label.week === 0 ? " last" : ""}">${label.text}</span>`).join("");
  return `<div class="hm-axis" aria-hidden="true" data-axis="${days.at(-1) ?? ""}">${spans}</div>`;
}
