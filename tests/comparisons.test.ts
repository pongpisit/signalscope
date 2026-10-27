import { describe, expect, it } from "vitest";
import { averageRuns } from "../shared/comparisons";
import type { Probe, Run, Target } from "../shared/types";

const now = Date.parse("2026-10-26T12:00:00Z");
const targets: Target[] = [0, 1, 2].map((i) => ({
  id: `t${i}`,
  name: `Target ${i}`,
  hostname: `t${i}.example`,
  url: `https://t${i}.example`,
}));
function probe(
  avg: number | null,
  id = "TH_1",
  changes: Partial<Probe> = {},
): Probe {
  return {
    id,
    location: "Thailand, Bangkok",
    provider: "Test network (AS123)",
    sent: 10,
    loss: 0,
    avg,
    best: avg,
    worst: avg,
    jitter: 1,
    ...changes,
  };
}
function run(
  age: number,
  probes: Probe[],
  source: "pingpe" | "globalping" = "pingpe",
): Run {
  const results = targets.map((t) => ({
    source,
    targetId: t.id,
    targetName: t.name,
    hostname: t.hostname,
    status: "complete" as const,
    capturedAt: new Date(now - age * 86400_000).toISOString(),
    sourceUrl: "https://example.com/evidence",
    evidence: [],
    probes: structuredClone(probes),
  }));
  return {
    id: `run-${age}`,
    startedAt: new Date(now - age * 86400_000).toISOString(),
    completedAt: new Date(now - age * 86400_000).toISOString(),
    source: "manual",
    status: "complete",
    targets,
    results: source === "pingpe" ? results : [],
    globalpingResults: source === "globalping" ? results : [],
  };
}
describe("selected-window test averages", () => {
  it("weights tests equally in cards and available tests equally within each location", () => {
    const runs = [run(1, [probe(10), probe(30, "TH_2")]), run(2, [probe(50)])];
    const original = structuredClone(runs);
    const view = averageRuns(runs, targets, "pingpe", 7, now);
    expect(view.testCount).toBe(2);
    expect(view.summaries.map((s) => s.avg)).toEqual([35, 35, 35]);
    expect(view.results[0].probes.map((p) => [p.avg, p.testCount])).toEqual([
      [30, 2],
      [30, 1],
    ]);
    expect(view.results[0].evidence).toEqual([]);
    expect(view.results[0].sourceUrl).toBe("");
    expect(runs).toEqual(original);
  });
  it("applies 7D and 30D boundaries and excludes unfinished or future tests", () => {
    const active = { ...run(0, [probe(999)]), status: "running" as const };
    const runs = [
      run(1, [probe(10)]),
      run(7, [probe(30)]),
      run(8, [probe(50)]),
      run(30, [probe(70)]),
      run(31, [probe(999)]),
      run(-1, [probe(999)]),
      active,
    ];
    const seven = averageRuns(runs, targets, "pingpe", 7, now);
    const thirty = averageRuns(runs, targets, "pingpe", 30, now);
    expect([seven.testCount, seven.summaries[0].avg]).toEqual([2, 20]);
    expect([thirty.testCount, thirty.summaries[0].avg]).toEqual([4, 40]);
  });
  it("matches target hostnames rather than historical target IDs or order", () => {
    const changed = run(1, [probe(999)]);
    changed.results[0].hostname = "different.example";
    const renamed = run(2, [probe(15)]);
    renamed.results.forEach((r) => {
      r.targetId = `old-${r.targetId}`;
    });
    renamed.results.reverse();
    const view = averageRuns([changed, renamed], targets, "pingpe", 7, now);
    expect(view.testCount).toBe(1);
    expect(view.results.map((r) => r.targetId)).toEqual(
      targets.map((t) => t.id),
    );
    expect(view.summaries[0].avg).toBe(15);
  });
  it("keeps sources separate and does not join changing Globalping selection indices", () => {
    const bangkok = { location: "Thailand, Bangkok" };
    const chiangMai = { location: "Thailand, Chiang Mai" };
    const runs = [
      run(
        1,
        [
          probe(10, "TH_globalping_0", bangkok),
          probe(100, "TH_globalping_1", chiangMai),
        ],
        "globalping",
      ),
      run(
        2,
        [
          probe(200, "TH_globalping_0", chiangMai),
          probe(30, "TH_globalping_1", bangkok),
        ],
        "globalping",
      ),
      run(3, [probe(999)]),
    ];
    const globalping = averageRuns(runs, targets, "globalping", 7, now);
    expect(globalping.testCount).toBe(2);
    expect(
      globalping.results[0].probes.map((p) => [p.location, p.avg, p.testCount]),
    ).toEqual([
      ["Thailand, Bangkok", 20, 2],
      ["Thailand, Chiang Mai", 150, 2],
    ]);
    expect(averageRuns(runs, targets, "pingpe", 7, now).summaries[0].avg).toBe(
      999,
    );
  });
  it("averages duplicate city/network probes within each test before averaging tests", () => {
    const runs = [
      run(
        1,
        [
          probe(10, "TH_globalping_0", {
            resolvedAddress: "203.0.113.1",
            jitter: null,
          }),
          probe(30, "TH_globalping_1", {
            resolvedAddress: "203.0.113.2",
            jitter: null,
          }),
        ],
        "globalping",
      ),
      run(
        2,
        [
          probe(100, "TH_globalping_7", {
            resolvedAddress: "203.0.113.1",
            jitter: null,
          }),
        ],
        "globalping",
      ),
    ];
    const view = averageRuns(runs, targets, "globalping", 7, now);
    expect(view.results[0].probes).toHaveLength(1);
    expect(view.results[0].probes[0]).toMatchObject({
      avg: 60,
      testCount: 2,
      jitter: null,
      destinationIps: [
        { address: "203.0.113.1", scope: "probe" },
        { address: "203.0.113.2", scope: "probe" },
      ],
    });
    expect(view.summaries[0].avg).toBe(60);
  });
  it("preserves loss and missing metrics and only compares shared reporting probes", () => {
    const first = run(1, [
      probe(10, "TH_1", { jitter: null }),
      probe(999, "TH_2"),
    ]);
    first.results[1].probes[1].sent = 0;
    const second = run(2, [probe(null, "TH_1", { loss: 100, jitter: null })]);
    const view = averageRuns([first, second], targets, "pingpe", 7, now);
    expect(view.results[0].probes).toHaveLength(1);
    expect(view.summaries[0]).toMatchObject({
      avg: 10,
      loss: 50,
      jitter: null,
    });
    expect(view.results[0].probes[0]).toMatchObject({
      avg: 10,
      loss: 50,
      jitter: null,
      testCount: 2,
    });
  });
  it("filters ignored networks and regions before computing test means", () => {
    const runs = [
      run(1, [
        probe(7),
        probe(999, "TH_keff", { provider: "KeFF Networks (AS41281)" }),
        probe(999, "TH_sis", {
          provider: "SiS Distribution (Thailand) (AS135381)",
        }),
        probe(999, "CN_1", { location: "China, Beijing" }),
      ]),
    ];
    const ignored = ["KeFF Networks (AS41281)", "SiS Distribution (Thailand)"];
    const view = averageRuns(
      runs,
      targets,
      "pingpe",
      7,
      now,
      (p) => p.id.startsWith("TH_"),
      ignored,
    );
    expect(view.summaries[0].avg).toBe(7);
    expect(view.results[0].probes).toHaveLength(1);
    // Without the configured list, excluded networks keep their samples.
    const unfiltered = averageRuns(runs, targets, "pingpe", 7, now, (p) =>
      p.id.startsWith("TH_"),
    );
    expect(unfiltered.summaries[0].avg).toBeGreaterThan(7);
    expect(unfiltered.results[0].probes).toHaveLength(3);
    expect(
      averageRuns(runs, targets, "pingpe", 7, now, () => false, ignored)
        .testCount,
    ).toBe(0);
  });
  it("matches ignored networks by ASN as well as by name", () => {
    const runs = [
      run(1, [
        probe(7),
        probe(999, "TH_keff", { provider: "KeFF Networks (AS41281)" }),
      ]),
    ];
    const view = averageRuns(runs, targets, "pingpe", 7, now, () => true, [
      "41281",
    ]);
    expect(view.results[0].probes).toHaveLength(1);
    expect(view.summaries[0].avg).toBe(7);
  });
  it("retains all original Ping.pe page IPs with their page-level scope", () => {
    const runs = [run(1, [probe(10)]), run(2, [probe(30)])];
    runs[0].results.forEach((r) => {
      r.resolvedAddress = "203.0.113.1";
    });
    runs[1].results.forEach((r) => {
      r.resolvedAddress = "203.0.113.2";
    });
    expect(
      averageRuns(runs, targets, "pingpe", 7, now).results[0].probes[0]
        .destinationIps,
    ).toEqual([
      { address: "203.0.113.1", scope: "page" },
      { address: "203.0.113.2", scope: "page" },
    ]);
  });
  it("never substitutes an older test when there are no samples in the window", () => {
    const view = averageRuns(
      [run(31, [probe(99)])],
      targets,
      "pingpe",
      30,
      now,
    );
    expect(view.testCount).toBe(0);
    expect(view.results).toEqual([]);
    expect(view.summaries[0].avg).toBeNull();
  });
});
