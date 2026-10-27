// Time-zone helpers shared by the Worker runtime and the browser.
// Intl-based: no dependency, and correct across DST and 30/45-minute offsets.

export function timeZoneIsValid(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const zoneAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour") % 24,
    value("minute"),
    value("second"),
  );
  return Math.round((zoneAsUtc - at.getTime()) / 60_000);
}

// A short, stable label such as "UTC", "UTC+7", or "UTC+5:45".
export function timeZoneOffsetLabel(
  timeZone: string,
  at: Date = new Date(),
): string {
  const minutes = zoneOffsetMinutes(timeZone, at);
  if (minutes === 0) return "UTC";
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

export function localHour(timestamp: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "numeric",
  }).formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return Number.isFinite(hour) ? hour % 24 : 0;
}
