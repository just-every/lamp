/** "just now", "4 minutes ago", "2 hours ago", "3 days ago". */
export function relativeTime(iso: string, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const [amount, unit] = seconds < 3600 ? [Math.floor(seconds / 60), "minute"] : seconds < 86_400 ? [Math.floor(seconds / 3600), "hour"] : [Math.floor(seconds / 86_400), "day"];
  return `${amount} ${unit}${amount === 1 ? "" : "s"} ago`;
}
