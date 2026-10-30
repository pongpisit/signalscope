import { localHour } from "./time";

export const cadenceOptions = [
  { value: "twice-daily", label: "Twice daily · 08:05 & 17:10" },
  { value: "every-1h", label: "Every hour" },
  { value: "every-2h", label: "Every 2 hours" },
  { value: "every-3h", label: "Every 3 hours" },
  { value: "every-4h", label: "Every 4 hours" },
  { value: "every-6h", label: "Every 6 hours" },
  { value: "every-12h", label: "Every 12 hours" },
  { value: "every-24h", label: "Every 24 hours · 00:05" },
] as const;

export type ObservationCadence = (typeof cadenceOptions)[number]["value"];
export const defaultCadence: ObservationCadence = "twice-daily";
// Settings normalizers always pass the configured zone explicitly; this
// default only covers settings saved before configurable time zones existed,
// which ran on Asia/Bangkok.
export const defaultTimeZone = "Asia/Bangkok";

// Consecutive scheduled runs start at alternating minutes past the hour:
// odd-numbered slots of the day (1st, 3rd, …) at :05, even-numbered
// (2nd, 4th, …) at :10. Back-to-back hourly runs then never fall in the same
// Globalping rate-limit window at the exact same instant, and scheduled
// traffic stays clear of the busy top of the hour. Both offsets are
// deterministic, so every heartbeat tick in a due hour still maps to the
// same run ID.
const firstSlotMinute = 5;
const secondSlotMinute = 10;

function slotStartMinute(index: number): number {
  return index % 2 === 0 ? firstSlotMinute : secondSlotMinute;
}

function slotStart(
  hourStart: number,
  cadence: ObservationCadence,
  timeZone: string,
): number | null {
  const index = scheduleHours(cadence).indexOf(localHour(hourStart, timeZone));
  return index === -1 ? null : hourStart + slotStartMinute(index) * 60_000;
}

export function normalizeCadence(value: unknown): ObservationCadence {
  if (value === undefined) return defaultCadence;
  if (cadenceOptions.some((option) => option.value === value))
    return value as ObservationCadence;
  throw new Error("Choose a supported observation frequency.");
}

export function scheduleHours(
  cadence: ObservationCadence = defaultCadence,
): number[] {
  if (cadence === "twice-daily") return [8, 17];
  const interval = Number(cadence.slice(6, -1));
  return Array.from({ length: 24 / interval }, (_, index) => index * interval);
}

export function scheduleTimes(
  cadence: ObservationCadence = defaultCadence,
): string[] {
  return scheduleHours(cadence).map(
    (hour, index) =>
      `${String(hour).padStart(2, "0")}:${String(slotStartMinute(index)).padStart(2, "0")}`,
  );
}

export function cadenceLabel(
  cadence: ObservationCadence = defaultCadence,
): string {
  return cadenceOptions.find((option) => option.value === cadence)!.label;
}

export function isScheduledTime(
  timestamp: number,
  cadence: ObservationCadence = defaultCadence,
  timeZone: string = defaultTimeZone,
): boolean {
  return scheduledSlot(timestamp, cadence, timeZone) !== null;
}

// Cron is a heartbeat, not the observation identity. Each tick maps to the UTC
// hour that contains it; that hour's observation becomes due at :05 or :10
// past the hour and stays recoverable for the rest of the hour even if the
// first tick was delayed or never delivered. Zones with 30/45 minute offsets
// fire within the mapped hour; a DST fall-back can produce one additional
// distinct slot when the local hour repeats.
export function scheduledSlot(
  timestamp: number,
  cadence: ObservationCadence = defaultCadence,
  timeZone: string = defaultTimeZone,
): number | null {
  if (!Number.isFinite(timestamp)) return null;
  const hourStart = Math.floor(timestamp / 3600_000) * 3600_000;
  const slot = slotStart(hourStart, cadence, timeZone);
  return slot !== null && timestamp >= slot ? slot : null;
}

export function nextScheduled(
  now = new Date(),
  cadence: ObservationCadence = defaultCadence,
  timeZone: string = defaultTimeZone,
): Date {
  const currentHour = Math.floor(now.getTime() / 3600_000) * 3600_000;
  // Odd-offset zones and DST transitions can hide one local hour inside 24
  // consecutive UTC hours, so scan one extra hour.
  for (let offset = 0; offset <= 25; offset++) {
    const slot = slotStart(currentHour + offset * 3600_000, cadence, timeZone);
    if (slot !== null && slot > now.getTime()) return new Date(slot);
  }
  throw new Error("Could not determine the next scheduled observation.");
}
