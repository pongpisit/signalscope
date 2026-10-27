import { describe, expect, it } from "vitest";
import { recoverAddresses } from "../shared/recover-addresses";
import {
  globalpingResult,
  type GlobalpingMeasurement,
} from "../worker/globalping";

const target = {
  id: "target-1",
  name: "Test",
  hostname: "test.example",
  url: "https://test.example",
};
function fixture() {
  const measurement: GlobalpingMeasurement = {
    id: "measurement-1",
    target: target.hostname,
    type: "ping",
    status: "finished",
    updatedAt: "2026-10-26T01:00:00Z",
    probesCount: 3,
    results: [0, 1, 2].map((index) => ({
      probe: {
        country: "TH",
        city: `City ${index}`,
        network: "Test network",
        asn: 123,
      },
      result: {
        status: "finished",
        stats: { total: 10, loss: 0, avg: 5, min: 4, max: 6 },
        ...(index === 0
          ? { resolvedAddress: "203.0.113.10" }
          : index === 1
            ? {
                rawOutput:
                  "PING test.example (203.0.113.20) 56(84) bytes of data.",
              }
            : {}),
      },
    })),
  };
  const stored = globalpingResult(target, measurement);
  stored.probes = stored.probes.map(({ resolvedAddress, ...probe }) => probe);
  stored.evidence = [
    {
      kind: "json",
      key: "run/globalping/target-1/evidence.json",
      sha256: "original-checksum",
      bytes: 123,
    },
  ];
  return { stored, evidence: { hostname: target.hostname, measurement } };
}

describe("historical destination-IP recovery", () => {
  it("recovers per-probe IPs without changing metrics, original evidence or input records", () => {
    const { stored, evidence } = fixture();
    const original = structuredClone(stored);
    const recovered = recoverAddresses(stored, evidence);
    expect(recovered.probes.map((probe) => probe.resolvedAddress)).toEqual([
      "203.0.113.10",
      "203.0.113.20",
      null,
    ]);
    expect(stored).toEqual(original);
    expect(recovered.evidence).toEqual(original.evidence);
    expect(recovered.probes[0].avg).toBe(original.probes[0].avg);
    expect(recoverAddresses(recovered, evidence)).toEqual(recovered);
  });
  it("rejects mismatched measurement identity, target and probe ordering", () => {
    const { stored, evidence } = fixture();
    expect(() =>
      recoverAddresses({ ...stored, measurementId: "different" }, evidence),
    ).toThrow("does not match");
    expect(() =>
      recoverAddresses({ ...stored, hostname: "different.example" }, evidence),
    ).toThrow("does not match");
    evidence.measurement.results.reverse();
    expect(() => recoverAddresses(stored, evidence)).toThrow("identity/order");
  });
});
