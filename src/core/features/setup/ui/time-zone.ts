/** The first zone name `Intl` accepts, else UTC (the installer's default). A browser that cannot resolve its
 * zone can report "Etc/Unknown", and a refused try may already have stored it as the page's: Intl refuses both. */
export function acceptedZone(...candidates: Array<string | undefined>): string {
  for (const zone of candidates) {
    if (!zone) continue;
    try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return zone; } catch { /* not a zone: try the next */ }
  }
  return "UTC";
}
