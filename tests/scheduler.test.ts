import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../shared/types";

vi.mock("../worker/store", () => ({ settings: vi.fn(), startRun: vi.fn() }));
import { settings, startRun } from "../worker/store";
import { dispatchScheduled } from "../worker/scheduler";

const env = {} as Env;
const base: Settings = {
  enabled: true,
  sampleSeconds: 45,
  targets: [1, 2, 3].map((n) => ({
    id: `target-${n}`,
    name: `Target ${n}`,
    hostname: `${n}.example`,
    url: `https://${n}.example`,
  })),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(settings).mockResolvedValue(base);
  vi.mocked(startRun).mockResolvedValue({ id: "test", started: true });
});
afterEach(() => vi.restoreAllMocks());

describe("scheduled dispatch", () => {
  it.each(["2026-10-26T01:00:00Z", "2026-10-26T10:00:00Z"])(
    "preserves the legacy slot %s with deterministic run IDs",
    async (time) => {
      const timestamp = Date.parse(time);
      await dispatchScheduled({ scheduledTime: timestamp }, env);
      expect(startRun).toHaveBeenCalledExactlyOnceWith(
        env,
        "scheduled",
        `scheduled-${timestamp}`,
        timestamp,
      );
    },
  );
  it("skips other hours for the twice-daily default", async () => {
    await dispatchScheduled(
      { scheduledTime: Date.parse("2026-10-26T02:00:00Z") },
      env,
    );
    expect(startRun).not.toHaveBeenCalled();
  });
  it.each([
    { enabled: false, targets: base.targets },
    { enabled: true, targets: [] },
  ])("does not dispatch paused or unconfigured settings", async (config) => {
    vi.mocked(settings).mockResolvedValue({
      ...base,
      ...config,
      cadence: "every-1h",
    });
    await dispatchScheduled(
      { scheduledTime: Date.parse("2026-10-26T01:00:00Z") },
      env,
    );
    expect(startRun).not.toHaveBeenCalled();
  });
  it("uses the latest saved cadence to include only matching Bangkok hours", async () => {
    vi.mocked(settings).mockResolvedValue({ ...base, cadence: "every-2h" });
    await dispatchScheduled(
      { scheduledTime: Date.parse("2026-10-26T01:00:00Z") },
      env,
    );
    await dispatchScheduled(
      { scheduledTime: Date.parse("2026-10-26T10:00:00Z") },
      env,
    );
    expect(startRun).toHaveBeenCalledTimes(1);
  });
  it("dispatches on the saved time zone, not the original Bangkok default", async () => {
    vi.mocked(settings).mockResolvedValue({
      ...base,
      cadence: "twice-daily",
      timezone: "America/New_York",
    });
    // Winter: 08:00 New York is 13:00 UTC; a delayed 13:26 tick still recovers it.
    const slot = Date.parse("2026-01-15T13:00:00Z");
    await dispatchScheduled(
      { scheduledTime: Date.parse("2026-01-15T13:26:38Z") },
      env,
    );
    expect(startRun).toHaveBeenCalledExactlyOnceWith(
      env,
      "scheduled",
      `scheduled-${slot}`,
      slot,
    );
    // The legacy Bangkok 08:00 slot (01:00 UTC) is not due in New York.
    await dispatchScheduled(
      { scheduledTime: Date.parse("2026-01-15T01:26:38Z") },
      env,
    );
    expect(startRun).toHaveBeenCalledTimes(1);
  });
  it("passes the same ID for duplicate deliveries and accepts an already-started result", async () => {
    vi.mocked(settings).mockResolvedValue({ ...base, cadence: "every-1h" });
    vi.mocked(startRun)
      .mockResolvedValueOnce({ id: "test", started: true })
      .mockResolvedValueOnce({ id: "test", started: false });
    const event = { scheduledTime: Date.parse("2026-10-26T02:00:00Z") };
    await dispatchScheduled(event, env);
    await dispatchScheduled(event, env);
    expect(vi.mocked(startRun).mock.calls[0]).toEqual(
      vi.mocked(startRun).mock.calls[1],
    );
  });
  it("uses one observation ID across delayed and repeated heartbeat ticks", async () => {
    vi.mocked(settings).mockResolvedValue({ ...base, cadence: "every-1h" });
    const slot = Date.parse("2026-10-26T06:00:00Z");
    // Includes the real production event observed at 06:26:38.034 UTC.
    for (const delay of [1234, 60_000, 23 * 60_000, 1598_034, 3599_999]) {
      await dispatchScheduled({ scheduledTime: slot + delay }, env);
    }
    expect(startRun).toHaveBeenCalledTimes(5);
    for (const call of vi.mocked(startRun).mock.calls)
      expect(call).toEqual([env, "scheduled", `scheduled-${slot}`, slot]);
  });
  it("does not run a newly saved or resumed schedule before its first future slot", async () => {
    vi.mocked(settings).mockResolvedValue({
      ...base,
      cadence: "every-1h",
      scheduleNotBefore: "2026-10-26T07:00:00.000Z",
    });
    await dispatchScheduled(
      { scheduledTime: Date.parse("2026-10-26T06:59:59Z") },
      env,
    );
    expect(startRun).not.toHaveBeenCalled();
    const slot = Date.parse("2026-10-26T07:00:00Z");
    await dispatchScheduled({ scheduledTime: slot + 60_000 }, env);
    expect(startRun).toHaveBeenCalledExactlyOnceWith(
      env,
      "scheduled",
      `scheduled-${slot}`,
      slot,
    );
  });
});
