import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import type { MeasurementParams } from "../worker/store";
import type { Result } from "../shared/types";

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {
    env: Env;
    constructor(_ctx: unknown, env: Env) {
      this.env = env;
    }
  },
}));
vi.mock("../worker/capture", () => ({ capture: vi.fn() }));
vi.mock("../worker/globalping", async (original) => ({
  ...(await original<typeof import("../worker/globalping")>()),
  createGlobalping: vi.fn(),
  collectGlobalping: vi.fn(),
  persistGlobalping: vi.fn(),
}));
import { MeasurementWorkflow } from "../worker/workflow";
import { capture } from "../worker/capture";
import {
  createGlobalping,
  collectGlobalping,
  persistGlobalping,
} from "../worker/globalping";

const targets = [1, 2, 3].map((n) => ({
  id: `target-${n}`,
  name: `Target ${n}`,
  hostname: `${n}.example`,
  url: `https://${n}.example`,
}));
const params: MeasurementParams = {
  runId: "test-run",
  targets,
  sampleSeconds: 45,
  country: "TH",
  globalpingLimit: 30,
};
let stored: Result[];
let finalStatus: string;
const step = {
  do: async (_name: string, ...args: unknown[]) =>
    (args.at(-1) as () => Promise<unknown>)(),
} as unknown as WorkflowStep;
const env = {
  DB: {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (sql.startsWith("INSERT"))
            stored.push(JSON.parse(args[2] as string));
          if (sql.includes("completed_at")) finalStatus = args[0] as string;
        },
        all: async () => ({
          results: stored.map((r) => ({ value: JSON.stringify(r) })),
        }),
      }),
    }),
  },
} as unknown as Env;

beforeEach(() => {
  vi.clearAllMocks();
  stored = [];
  finalStatus = "";
  vi.mocked(capture).mockImplementation(async (_env, _id, target) => ({
    targetId: target.id,
    targetName: target.name,
    hostname: target.hostname,
    capturedAt: "2026-10-26T01:00:00Z",
    sourceUrl: `https://ping.pe/${target.hostname}`,
    status: "complete",
    probes: [
      {
        id: "TH_1",
        location: "Bangkok",
        provider: "Test",
        sent: 10,
        loss: 0,
        avg: 10,
        best: 9,
        worst: 11,
        jitter: 1,
      },
    ],
    evidence: [],
  }));
  vi.mocked(createGlobalping).mockImplementation(async (target) => ({
    id: `gp-${target.id}`,
    probesCount: 1,
  }));
  vi.mocked(collectGlobalping).mockImplementation(async (id) => ({
    id,
    type: "ping",
    status: "finished",
    target: targets.find((t) => `gp-${t.id}` === id)!.hostname,
    updatedAt: "2026-10-26T01:00:00Z",
    probesCount: 1,
    results: [
      {
        probe: { country: "TH", city: "Bangkok", network: "Test", asn: 123 },
        result: {
          status: "finished",
          stats: { total: 10, loss: 0, avg: 10, min: 9, max: 11 },
        },
      },
    ],
  }));
  vi.mocked(persistGlobalping).mockImplementation(async (_env, _id, result) => {
    stored.push(result);
  });
});
const run = () =>
  new MeasurementWorkflow({} as ExecutionContext, env).run(
    { payload: params } as WorkflowEvent<MeasurementParams>,
    step,
  );

describe("dual-source observation workflow", () => {
  it("reuses the first probe selection on both later targets and completes all six results", async () => {
    await run();
    expect(
      vi
        .mocked(createGlobalping)
        .mock.calls.map(([target, selection]) => [target.id, selection]),
    ).toEqual([
      ["target-1", undefined],
      ["target-2", "gp-target-1"],
      ["target-3", "gp-target-1"],
    ]);
    // Every creation uses the country and probe limit captured at launch.
    for (const call of vi.mocked(createGlobalping).mock.calls)
      expect(call[2]).toEqual({ country: "TH", limit: 30 });
    expect(vi.mocked(collectGlobalping).mock.calls[0][1]).toBe(30);
    expect(stored).toHaveLength(6);
    expect(finalStatus).toBe("complete");
  });
  it("skips new selection attempts when the initial POST fails while retaining Ping.pe samples", async () => {
    vi.mocked(createGlobalping).mockRejectedValue(
      new Error("Globalping rate limit reached"),
    );
    await run();
    expect(createGlobalping).toHaveBeenCalledTimes(1);
    expect(collectGlobalping).not.toHaveBeenCalled();
    expect(persistGlobalping).toHaveBeenCalledTimes(3);
    expect(
      stored
        .filter((r) => r.source === "globalping")
        .every((r) => r.status === "failed"),
    ).toBe(true);
    expect(finalStatus).toBe("partial");
  });
  it("keeps the original selection after a polling failure", async () => {
    vi.mocked(collectGlobalping).mockRejectedValueOnce(
      new Error("Polling failed"),
    );
    await run();
    expect(vi.mocked(createGlobalping).mock.calls[2][1]).toBe("gp-target-1");
    expect(stored.find((r) => r.source === "globalping")?.measurementId).toBe(
      "gp-target-1",
    );
    expect(finalStatus).toBe("partial");
  });
});
