import { useEffect, useState } from "react";

export const SETTINGS_TABS = [
  { id: "page", label: "Page" },
  { id: "notifications", label: "Notifications" },
  { id: "writing", label: "Writing" },
  { id: "embeds", label: "Embeds and feeds" },
  { id: "channels", label: "Slack and Teams" },
  { id: "alerts", label: "Alert rules" },
  { id: "operators", label: "Operators" },
  { id: "data", label: "Your data" },
] as const;
export type SettingsTab = typeof SETTINGS_TABS[number]["id"];

// Older links into the single long page still land on the right tab.
const ALIASES: Record<string, SettingsTab> = { "sender-check": "notifications", "public-address": "page", "audit-log": "data" };

function fromHash(hash: string): SettingsTab {
  const key = hash.replace(/^#/, "");
  return SETTINGS_TABS.find((tab) => tab.id === key)?.id ?? ALIASES[key] ?? "page";
}

/** The open Settings tab lives in the URL hash, so every tab has a link and Back works. */
export function useSettingsTab() {
  const [tab, setTab] = useState<SettingsTab>("page");
  useEffect(() => {
    const sync = () => setTab(fromHash(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return tab;
}

export function SettingsTabs({ current }: { current: SettingsTab }) {
  return <nav className="settings-tabs" aria-label="Settings sections">
    {SETTINGS_TABS.map((tab) => <a key={tab.id} href={`#${tab.id}`} aria-current={tab.id === current ? "page" : undefined}>{tab.label}</a>)}
  </nav>;
}
