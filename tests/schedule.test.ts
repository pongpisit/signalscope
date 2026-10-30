import { describe, expect, it } from "vitest";
import {
  cadenceOptions,
  isScheduledTime,
  nextScheduled,
  normalizeCadence,
  scheduleTimes,
  scheduledSlot,
  type ObservationCadence,
} from "../shared/schedule";

describe("Bangkok observation schedules", () => {
  it("keeps legacy settings on the original twice-daily schedule", () => {
    expect(normalizeCadence(undefined)).toBe("twice-daily");
    expect(scheduleTimes()).toEqual(["08:05", "17:10"]);
  });
  it.each([null, 2, "", "every-0h", "every-5h", "every-25h", "0 * * * *"])(
    "rejects unsupported cadence %s",
    (value) => {
      expect(() => normalizeCadence(value)).toThrow(
        "supported observation frequency",
      );
    },
  );
  it.each([
    ["every-1h", "2026-10-26T00:59:59Z", "2026-10-26T01:05:00.000Z"],
    ["every-2h", "2026-10-26T01:00:00Z", "2026-10-26T01:05:00.000Z"],
    ["every-2h", "2026-10-26T16:00:00Z", "2026-10-26T17:05:00.000Z"],
    ["every-3h", "2026-10-26T00:00:00Z", "2026-10-26T02:10:00.000Z"],
    ["every-4h", "2026-10-26T01:00:00Z", "2026-10-26T01:05:00.000Z"],
    ["every-6h", "2026-10-26T04:00:00Z", "2026-10-26T05:05:00.000Z"],
    ["every-12h", "2026-10-26T05:00:00Z", "2026-10-26T05:10:00.000Z"],
    ["every-24h", "2026-10-26T17:00:00Z", "2026-10-26T17:05:00.000Z"],
    ["every-24h", "2026-12-31T16:59:59Z", "2026-12-31T17:05:00.000Z"],
  ] as const)("finds the next %s slot after %s", (cadence, input, expected) => {
    expect(nextScheduled(new Date(input), cadence).toISOString()).toBe(
      expected,
    );
  });
  it("stagger two-hour intervals across alternating :05 and :10 minutes", () => {
    expect(scheduleTimes("every-2h")).toEqual([
      "00:05",
      "02:10",
      "04:05",
      "06:10",
      "08:05",
      "10:10",
      "12:05",
      "14:10",
      "16:05",
      "18:10",
      "20:05",
      "22:10",
    ]);
    expect(
      isScheduledTime(Date.parse("2026-10-26T01:05:00Z"), "every-2h"),
    ).toBe(true);
    expect(
      isScheduledTime(Date.parse("2026-10-26T02:05:00Z"), "every-2h"),
    ).toBe(false);
  });
  it("accepts heartbeat ticks from the staggered slot until the hour ends", () => {
    expect(
      isScheduledTime(Date.parse("2026-10-26T01:00:01Z"), "every-1h"),
    ).toBe(false);
    expect(
      isScheduledTime(Date.parse("2026-10-26T01:04:59.999Z"), "every-1h"),
    ).toBe(false);
    expect(
      isScheduledTime(Date.parse("2026-10-26T01:05:00Z"), "every-1h"),
    ).toBe(true);
    expect(
      isScheduledTime(Date.parse("2026-10-26T01:59:59.999Z"), "every-1h"),
    ).toBe(true);
    expect(isScheduledTime(Number.NaN, "every-1h")).toBe(false);
    expect(isScheduledTime(Number.POSITIVE_INFINITY, "every-1h")).toBe(false);
  });
  it("checks the same UTC hour against the configured time zone", () => {
    // 01:05 UTC is 08:05 Bangkok (a legacy slot) and 21:05 the previous day in New York.
    const minute = Date.parse("2026-10-26T01:05:00Z");
    expect(isScheduledTime(minute, "twice-daily", "Asia/Bangkok")).toBe(true);
    expect(isScheduledTime(minute, "twice-daily", "America/New_York")).toBe(
      false,
    );
    // In winter New York runs on EST (UTC-5), so 08:05 local is 13:05 UTC.
    expect(
      isScheduledTime(
        Date.parse("2026-01-15T13:05:00Z"),
        "twice-daily",
        "America/New_York",
      ),
    ).toBe(true);
    // UTC zones never hit the twice-daily 08:05/17:10 Bangkok slots.
    expect(isScheduledTime(minute, "twice-daily", "UTC")).toBe(false);
  });
  it("maps odd-offset zones to the UTC hour that contains the local slot", () => {
    // Asia/Kathmandu (+05:45): 12:00 UTC is 17:45 local, the 17:00 slot,
    // which as the second slot of the day starts at 17:10 local = 12:10 UTC.
    expect(
      scheduledSlot(
        Date.parse("2026-10-26T12:26:38Z"),
        "twice-daily",
        "Asia/Kathmandu",
      ),
    ).toBe(Date.parse("2026-10-26T12:10:00Z"));
    // The same instant is 19:00 in Bangkok: not a twice-daily slot.
    expect(
      scheduledSlot(Date.parse("2026-10-26T12:26:38Z"), "twice-daily"),
    ).toBeNull();
  });
  it("finds the next slot across a DST fall-back in the configured zone", () => {
    // America/New_York leaves DST on 2026-11-01 at 06:00 UTC; from 05:30 UTC
    // the next every-2h local slot is 02:10 EST = 07:10 UTC.
    expect(
      nextScheduled(
        new Date("2026-11-01T05:30:00Z"),
        "every-2h",
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-11-01T07:10:00.000Z");
  });
  it.each(cadenceOptions)(
    "makes next-run display agree with dispatch for $value",
    ({ value }) => {
      const now = new Date("2026-12-31T21:35:12Z");
      const next = nextScheduled(now, value as ObservationCadence);
      expect(next.getTime()).toBeGreaterThan(now.getTime());
      expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(24 * 3600_000);
      expect(isScheduledTime(next.getTime(), value)).toBe(true);
    },
  );
  it("recovers delayed due-hour ticks without accepting other Bangkok hours", () => {
    // 08:05 Bangkok (01:05 UTC) is the first every-2h slot of the day.
    const slot = Date.parse("2026-10-26T01:05:00Z");
    for (const delay of [1, 1234, 60_000, 35 * 60_000, 54 * 60_000]) {
      expect(scheduledSlot(slot + delay, "every-2h")).toBe(slot);
    }
    expect(scheduledSlot(slot + 3600_000, "every-2h")).toBeNull();
    expect(scheduledSlot(Number.NaN, "every-1h")).toBeNull();
    expect(scheduledSlot(Number.POSITIVE_INFINITY, "every-1h")).toBeNull();
  });
  it("keeps one deterministic slot ID per due hour across the staggered minute", () => {
    // 13:00 Bangkok (06:00 UTC) is the 14th hourly slot, so it starts at :10.
    const slot = Date.parse("2026-10-26T06:10:00Z");
    for (const delay of [1, 1234, 60_000, 25 * 60_000, 45 * 60_000]) {
      expect(scheduledSlot(slot + delay, "every-1h")).toBe(slot);
    }
    expect(scheduledSlot(slot + 50 * 60_000, "every-1h")).toBeNull();
  });
});
