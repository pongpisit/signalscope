import { localHour } from "./time";

export const cadenceOptions = [
  { value: "twice-daily", label: "Twice daily · 08:00 & 17:00" },
  { value: "every-1h", label: "Every hour" },
  { value: "every-2h", label: "Every 2 hours" },
  { value: "every-3h", label: "Every 3 hours" },
  { value: "every-4h", label: "Every 4 hours" },
  { value: "every-6h", label: "Every 6 hours" },
  { value: "every-12h", label: "Every 12 hours" },
  { value: "every-24h", label: "Every 24 hours · 00:00" },
] as const;

export type ObservationCadence = (typeof cadenceOptions)[number]["value"];
export const defaultCadence: ObservationCadence = "twice-daily";
// Settings normalizers always pass the configured zone explicitly; this
// default only covers settings saved before configurable time zones existed,
// which ran on Asia/Bangkok.
export const defaultTimeZone = "Asia/Bangkok";

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
    (hour) => `${String(hour).padStart(2, "0")}:00`,
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
// hour that contains it, and a due slot is recovered for the rest of its hour
// even if the first tick was delayed or never delivered. Zones with 30/45
// minute offsets fire within the mapped hour; a DST fall-back can produce one
// additional distinct slot when the local hour repeats.
export function scheduledSlot(
  timestamp: number,
  cadence: ObservationCadence = defaultCadence,
  timeZone: string = defaultTimeZone,
): number | null {
  if (!Number.isFinite(timestamp)) return null;
  const slot = Math.floor(timestamp / 3600_000) * 3600_000;
  return scheduleHours(cadence).includes(localHour(slot, timeZone))
    ? slot
    : null;
}

export function nextScheduled(
  now = new Date(),
  cadence: ObservationCadence = defaultCadence,
  timeZone: string = defaultTimeZone,
): Date {
  const firstHour = Math.floor(now.getTime() / 3600_000) * 3600_000 + 3600_000;
  // Odd-offset zones and DST transitions can hide one local hour inside 24
  // consecutive UTC hours, so scan one extra hour.
  for (let offset = 0; offset < 25; offset++) {
    const candidate = firstHour + offset * 3600_000;
    if (isScheduledTime(candidate, cadence, timeZone))
      return new Date(candidate);
  }
  throw new Error("Could not determine the next scheduled observation.");
}
