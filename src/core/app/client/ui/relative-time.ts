import { useEffect, useState } from "react";

/** "just now", "4 minutes ago", "2 hours ago", "3 days ago". */
export function relativeTime(iso: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const [amount, unit] = seconds < 3600 ? [Math.floor(seconds / 60), "minute"] : seconds < 86_400 ? [Math.floor(seconds / 3600), "hour"] : [Math.floor(seconds / 86_400), "day"];
  return `${amount} ${unit}${amount === 1 ? "" : "s"} ago`;
}

/** Hydration starts with the same stable instant on both sides. Only a mounted
 * component may describe it relative to the browser's current clock. */
export function useRelativeTime() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return (iso: string) => mounted ? relativeTime(iso, Date.now()) : iso;
}
