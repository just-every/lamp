import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";

import type { IconName } from "../../../app/client/ui/icon";
import { mayLeave } from "../../../app/client/ui/leave-guard";

/** Settings' destinations under their topics, in the rail's order. Each is a pane of /app/settings named by its hash,
 * except Move in, which keeps its own page. */
export const SETTINGS_MENU = [
  { topic: "Your page", destinations: [{ id: "page", label: "Page", icon: "page" }, { id: "look", label: "Look", icon: "brush" }] },
  { topic: "Sending", destinations: [{ id: "notifications", label: "Notifications", icon: "bell" }, { id: "writing", label: "Writing", icon: "pen" }, { id: "templates", label: "Templates", icon: "template" }] },
  { topic: "Connections", destinations: [{ id: "tools", label: "Connected tools", icon: "link" }, { id: "embeds", label: "Embeds and feeds", icon: "code" }] },
  { topic: "Team", destinations: [{ id: "operators", label: "Operators", icon: "person" }, { id: "sign-in", label: "Sign-in", icon: "key" }] },
  { topic: "Data", destinations: [{ id: "reports", label: "Reports", icon: "chart" }, { id: "move-in", label: "Move in", icon: "arrow-in" }, { id: "export", label: "Export and restore", icon: "refresh" }, { id: "audit", label: "Audit log", icon: "shield" }] },
] as const satisfies ReadonlyArray<{ topic: string; destinations: ReadonlyArray<{ id: string; label: string; icon: IconName }> }>;

export type SettingsDestination = typeof SETTINGS_MENU[number]["destinations"][number]["id"];
export type SettingsTab = Exclude<SettingsDestination, "move-in">;

const DESTINATIONS = SETTINGS_MENU.flatMap<{ id: SettingsDestination; label: string; icon: IconName }>(topic => topic.destinations);
const TABS = new Set<string>(DESTINATIONS.filter(destination => destination.id !== "move-in").map(destination => destination.id));

// Older links still land: anchors from the single long page and the tabs the rail replaced.
const ALIASES = new Map<string, SettingsTab>([["public-address", "page"], ["sender-check", "notifications"], ["channels", "tools"], ["alerts", "tools"], ["data", "export"], ["audit-log", "audit"]]);

export function settingsTabFromHash(hash: string): SettingsTab {
  const key = hash.replace(/^#/, "");
  return TABS.has(key) ? key as SettingsTab : ALIASES.get(key) ?? "page";
}

/** The destination an /app address shows, or null outside Settings. Cutover is reached from Move in, so it marks Move in. */
export function settingsDestination(pathname: string, hash: string): SettingsDestination | null {
  const path = pathname.replace(/\/$/, "");
  if (path === "/app/settings") return settingsTabFromHash(hash);
  return path === "/app/move-in" || path === "/app/cutover" ? "move-in" : null;
}

export function settingsLabel(destination: SettingsDestination) {
  return DESTINATIONS.find(item => item.id === destination)!.label;
}

const never = () => () => {};
/** False while React hydrates the server's markup, true from then on (and at once for anything mounted later). */
function useHydrated() {
  return useSyncExternalStore(never, () => true, () => false);
}

/** The Settings destination of the current address. The server never sees the hash, so hydration draws Page, as the
 * server did, and the next render follows the address. */
export function useSettingsDestination() {
  const { pathname, hash } = useRouterState({ select: state => ({ pathname: state.location.pathname, hash: state.location.hash }), structuralSharing: true });
  return settingsDestination(pathname, useHydrated() ? hash : "");
}

/** The open pane lives in the URL hash, so every pane has a link and Back works. While a link out of Settings loads its
 * screen, the address has already moved on; the pane on show stays until that screen replaces it. */
export function useSettingsTab(): SettingsTab {
  const { pathname, hash } = useRouterState({ select: state => ({ pathname: state.location.pathname, hash: state.location.hash }), structuralSharing: true });
  const hydrated = useHydrated();
  const shown = useRef<SettingsTab>("page");
  if (pathname.replace(/\/$/, "") === "/app/settings") shown.current = settingsTabFromHash(hydrated ? hash : "");
  return shown.current;
}

/** Moving to another pane is leaving this one: the rail, the phone sheet, Back and Forward all wait for the same check a
 * route change runs, so a refused save keeps the owner on its pane with the value, the reason and Retry. */
export function usePaneLeaveGuard() {
  const { history } = useRouter();
  useEffect(() => history.block({
    blockerFn: async ({ currentLocation, nextLocation }) => currentLocation.pathname === "/app/settings" && nextLocation.pathname === "/app/settings"
      && settingsTabFromHash(currentLocation.hash) !== settingsTabFromHash(nextLocation.hash) && !await mayLeave("pane"),
    enableBeforeUnload: false,
  }), [history]);
}
