/** Calendar boundaries belong to the page zone, including midnight offset changes. */
export function pageMonth(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(new Date(instant));
  return `${parts.find(part => part.type === "year")!.value.padStart(4, "0")}-${parts.find(part => part.type === "month")!.value}`;
}

export function calendarMonth(month: string, timezone: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1000 || Number(month.slice(0, 4)) > 9998) throw new Error("Choose a valid calendar month (YYYY-MM).");
  const year = Number(month.slice(0, 4)), number = Number(month.slice(5));
  const next = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" });
  const localMonth = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant));
    return `${parts.find(part => part.type === "year")!.value.padStart(4, "0")}-${parts.find(part => part.type === "month")!.value}`;
  };
  const boundary = (target: string) => {
    const nominal = Date.parse(`${target}-01T00:00:00.000Z`);
    let lower = nominal - 48 * 3600000, upper = nominal + 48 * 3600000;
    // Find the first instant in this local month. This also handles a skipped
    // midnight; converting an assumed local midnight by a fixed offset does not.
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (localMonth(middle) < target) lower = middle + 1;
      else upper = middle;
    }
    return new Date(lower).toISOString();
  };
  return { month, startsAt: boundary(month), endsAt: boundary(next) };
}
