import { destinationIps } from "./addresses";
import { excludedNetwork, mean, summarize } from "./metrics";
import type { Probe, Result, Run, Summary, Target } from "./types";

export function commonIds(results: Result[]) {
  if (results.length !== 3) return new Set<string>();
  return new Set(
    results[0].probes
      .filter(
        (p) =>
          p.sent > 0 &&
          p.loss !== null &&
          results.every((r) =>
            r.probes.some(
              (q) =>
                q.id === p.id &&
                q.location === p.location &&
                q.provider === p.provider &&
                q.sent > 0 &&
                q.loss !== null,
            ),
          ),
      )
      .map((p) => p.id),
  );
}

function probeKey(probe: Probe, source: "pingpe" | "globalping") {
  // Globalping indices only identify probes within one reused selection.
  return JSON.stringify([
    source === "globalping" ? probe.id.split("_")[0] : probe.id,
    probe.location,
    probe.provider,
  ]);
}

function averageProbes(samples: Probe[], id: string, testCount: number): Probe {
  const ips = new Map<string, { address: string; scope: "probe" | "page" }>();
  for (const sample of samples)
    for (const ip of sample.destinationIps ?? [])
      ips.set(`${ip.scope}:${ip.address}`, ip);
  return {
    id,
    location: samples[0].location,
    provider: samples[0].provider,
    sent: samples.reduce((total, p) => total + p.sent, 0),
    avg: mean(samples.map((p) => p.avg)),
    loss: mean(samples.map((p) => p.loss)),
    best: mean(samples.map((p) => p.best)),
    worst: mean(samples.map((p) => p.worst)),
    jitter: mean(samples.map((p) => p.jitter)),
    testCount,
    destinationIps: [...ips.values()],
  };
}

export function averageRuns(
  runs: Run[],
  targets: Target[],
  source: "pingpe" | "globalping",
  days: number,
  now: number,
  includeProbe: (probe: Probe) => boolean = () => true,
  ignored: readonly string[] = [],
): { results: Result[]; summaries: Summary[]; testCount: number } {
  const cutoff = now - days * 86400_000;
  const observations: {
    results: Result[];
    probes: Probe[][];
    summaries: Summary[];
  }[] = [];
  for (const run of runs) {
    const started = Date.parse(run.startedAt);
    if (
      ["queued", "running"].includes(run.status) ||
      !Number.isFinite(started) ||
      started < cutoff ||
      started > now ||
      targets.length !== 3
    )
      continue;
    const available =
      source === "globalping" ? (run.globalpingResults ?? []) : run.results;
    const results = targets.map((target) =>
      available.find((r) => r.hostname === target.hostname),
    );
    if (results.some((r) => !r)) continue;
    const matching = results.map((r, index) => ({
      ...r!,
      targetId: targets[index].id,
      targetName: targets[index].name,
      probes: r!.probes.filter((p) => !excludedNetwork(p, ignored)),
    }));
    const shared = commonIds(matching);
    const probes = matching.map((r) =>
      r.probes
        .filter((p) => shared.has(p.id) && includeProbe(p))
        .map((p) => ({ ...p, destinationIps: destinationIps(r, p) })),
    );
    if (!probes[0].length) continue;
    observations.push({
      results: matching,
      probes,
      summaries: probes.map(summarize),
    });
  }
  if (!observations.length)
    return {
      results: [],
      summaries: targets.map(() => summarize([])),
      testCount: 0,
    };
  const groups = targets.map(() => new Map<string, Probe[]>());
  for (const observation of observations) {
    observation.probes.forEach((probes, targetIndex) => {
      const perRun = new Map<string, Probe[]>();
      for (const probe of probes) {
        const key = probeKey(probe, source);
        perRun.set(key, [...(perRun.get(key) ?? []), probe]);
      }
      for (const [key, probes] of perRun) {
        const existing = groups[targetIndex].get(key) ?? [];
        groups[targetIndex].set(key, [
          ...existing,
          averageProbes(probes, probes[0].id, 1),
        ]);
      }
    });
  }
  const keys = [...groups[0].keys()];
  const results: Result[] = targets.map((target, index) => ({
    source,
    targetId: target.id,
    targetName: target.name,
    hostname: target.hostname,
    status: "complete",
    capturedAt: observations[0].results[index].capturedAt,
    sourceUrl: "",
    evidence: [],
    probes: keys.map((key, groupIndex) => {
      const samples = groups[index].get(key)!;
      const country = samples[0].id.split("_")[0];
      return averageProbes(
        samples,
        `${country}_average_${groupIndex}`,
        samples.length,
      );
    }),
  }));
  const summaries = targets.map((_, index) => ({
    ...summarize(results[index].probes),
    // Equal weight per test, regardless of the number of probes in that test.
    avg: mean(observations.map((o) => o.summaries[index].avg)),
    loss: mean(observations.map((o) => o.summaries[index].loss)),
    jitter: mean(observations.map((o) => o.summaries[index].jitter)),
  }));
  return { results, summaries, testCount: observations.length };
}
