import assert from "node:assert/strict";
import { visibleText } from "./visible-text.mjs";
export { assertResolvedDuration } from "./resolved-duration.mjs";

const months = new Map();
for (let month = 0; month < 12; month++) {
  for (const width of ["short", "long"]) {
    months.set(new Intl.DateTimeFormat("en", { month: width, timeZone: "UTC" }).format(new Date(Date.UTC(2000, month, 1))).toLowerCase(), month + 1);
  }
}
months.set("sept", 9);

function calendar(text) {
  const numeric = text.match(/\b(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?=\D|$)/);
  if (numeric) {
    assert.ok(!/\d/.test(text.replace(numeric[0], "")), "visible date has no extra numeric components");
    return numeric.slice(1).map(Number);
  }
  const tokens = text.toLowerCase().replace(/(\d)(?:st|nd|rd|th)\b/g, "$1").match(/[a-z]+|\d+/g) ?? [];
  const monthNames = tokens.filter(token => months.has(token));
  const numbers = tokens.filter(token => /^\d+$/.test(token));
  assert.ok(monthNames.length === 1 && numbers.length === 2, "visible date supplies a year, month and day");
  const year = numbers.find(token => token.length === 4);
  const day = numbers.find(token => token !== year);
  assert.ok(year && day, "visible date supplies an unambiguous year and day");
  return [Number(year), months.get(monthNames[0]), Number(day)];
}

// Read displayed components; never let Date.parse invent a clock or roll a date over.
export function assertVisibleTime(text, instant, timeZone) {
  const visible = visibleText(text);
  const offsets = [...visible.matchAll(/\b(?:UTC|GMT)(?:\s*([+−-])\s*(\d{1,2})(?::?(\d{2}))?)?(?![\d:]|\s*[+−-])/gi)];
  assert.equal(offsets.length, 1, "visible time supplies one readable UTC offset");
  const offset = offsets[0];
  assert.ok(Number(offset[2] ?? 0) <= 23 && Number(offset[3] ?? 0) < 60, "visible UTC offset has valid components");
  const offsetMinutes = (offset[1] === "+" ? 1 : -1) * (Number(offset[2] ?? 0) * 60 + Number(offset[3] ?? 0));
  const wallText = visible.slice(0, offset.index) + visible.slice(offset.index + offset[0].length);
  const clocks = [...wallText.matchAll(/(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*([ap]\.?\s*m\.?)?(?![\d:.])/gi)];
  assert.equal(clocks.length, 1, "visible date includes an explicit clock time");
  const clock = clocks[0];
  let hour = Number(clock[1]);
  const minute = Number(clock[2]);
  const second = Number(clock[3] ?? 0);
  const meridiem = clock[5]?.replace(/[.\s]/g, "").toLowerCase();
  assert.ok(minute < 60 && second < 60 && (meridiem ? hour >= 1 && hour <= 12 : hour < 24), "visible clock has valid components");
  if (meridiem) hour = hour % 12 + (meridiem === "pm" ? 12 : 0);
  const [year, month, day] = calendar(wallText.slice(0, clock.index) + wallText.slice(clock.index + clock[0].length));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  assert.ok(date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day, "visible date is a real calendar date");
  const epoch = Date.parse(instant);
  assert.ok(Number.isFinite(epoch), "reference instant is valid");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(new Date(epoch));
  const value = type => Number(parts.find(part => part.type === type).value);
  assert.deepEqual([year, month, day, hour, minute], [value("year"), value("month"), value("day"), value("hour"), value("minute")], "visible calendar and clock use the configured zone");
  if (clock[3] !== undefined) assert.equal(second, value("second"), "visible seconds match the instant");
  if (clock[4] !== undefined) {
    const fraction = String(new Date(epoch).getUTCMilliseconds()).padStart(3, "0").padEnd(clock[4].length, "0").slice(0, clock[4].length);
    assert.equal(clock[4], fraction, "visible fractional seconds match their precision");
  }
  date.setUTCSeconds(value("second"), 0);
  assert.equal(offsetMinutes || 0, (date.getTime() - Math.floor(epoch / 1000) * 1000) / 60000, "visible UTC offset matches this instant in the configured zone");
}
