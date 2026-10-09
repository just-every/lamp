import alert from "./cool-a-icons/alert.svg?raw";
import check from "./cool-a-icons/check.svg?raw";
import feed from "./cool-a-icons/feed.svg?raw";
import history from "./cool-a-icons/history.svg?raw";
import incident from "./cool-a-icons/incident.svg?raw";
import maintenance from "./cool-a-icons/maintenance.svg?raw";
import subscribe from "./cool-a-icons/subscribe.svg?raw";
import timeline from "./cool-a-icons/timeline.svg?raw";

const icons = { alert, check, feed, history, incident, maintenance, subscribe, timeline };

export type CoolAIcon = keyof typeof icons;

/** Exact vectors extracted by the selected 12ui improve kit; inlining keeps PAGE-003's asset ceiling. */
export function coolAIcon(name: CoolAIcon, className = "") {
  return `<span class="cool-a-icon ${className}" aria-hidden="true">${icons[name]}</span>`;
}
