import { describe, expect, it } from "vitest";
import {
  excludedNetwork,
  mean,
  nextScheduled,
  normalizeIgnoredNetworks,
  normalizeTarget,
  summarize,
} from "../shared/metrics";
import type { Probe } from "../shared/types";

describe("measurement semantics", () => {
  it.each([
    ["KeFF Networks (AS41281)", true],
    ["SiS Distribution (Thailand) (AS135381)", true],
    ["KeFF Networks", true],
    ["SiS Distribution (Thailand)", true],
    [" keff   NETWORKS (as41281) ", true],
    ["Renamed network (AS135381)", true],
    ["Another network (AS412810)", false],
    ["Another network (AS1135381)", false],
    ["Unrelated KeFF Networks customer (AS123)", false],
    ["AIS Fibre (AS13335)", false],
  ])("applies configured exclusions to %s", (provider, expected) => {
    const ignored = [
      "KeFF Networks (AS41281)",
      "SiS Distribution (Thailand)",
      "135381",
    ];
    expect(excludedNetwork({ provider }, ignored)).toBe(expected);
  });
  it("excludes nothing when no networks are configured", () => {
    expect(excludedNetwork({ provider: "KeFF Networks (AS41281)" })).toBe(
      false,
    );
  });
  it.each([
    ["nope", "Ignored networks must be a list of names or ASNs."],
    [Array.from({ length: 21 }, () => "AS1"), "Ignore at most 20 networks."],
    [["x".repeat(81)], "Keep each ignored network under 80 characters."],
  ])("rejects invalid ignored networks %j", (value, message) => {
    expect(() => normalizeIgnoredNetworks(value)).toThrow(message);
  });
  it("trims and drops empty ignored-network entries", () => {
    expect(
      normalizeIgnoredNetworks(["  KeFF Networks  ", "", "\tAS123\t"]),
    ).toEqual(["KeFF Networks", "AS123"]);
  });
  it("does not turn absent readings into zero latency or zero loss", () => {
    expect(mean([null, Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
    const probes: Probe[] = [
      {
        id: "a",
        location: "A",
        provider: "A",
        sent: 0,
        loss: null,
        avg: null,
        best: null,
        worst: null,
        jitter: null,
      },
      {
        id: "b",
        location: "B",
        provider: "B",
        sent: 5,
        loss: 100,
        avg: null,
        best: null,
        worst: null,
        jitter: null,
      },
      {
        id: "c",
        location: "C",
        provider: "C",
        sent: 5,
        loss: 0,
        avg: 20,
        best: 18,
        worst: 25,
        jitter: 2,
      },
    ];
    expect(summarize(probes)).toEqual({
      avg: 20,
      loss: 50,
      jitter: 2,
      reporting: 2,
      total: 3,
      reachable: 1,
    });
  });
  it.each([
    ["2026-10-25T23:00:00Z", "2026-10-26T01:05:00.000Z"],
    ["2026-10-26T01:00:00Z", "2026-10-26T01:05:00.000Z"],
    ["2026-10-26T10:00:00Z", "2026-10-26T10:10:00.000Z"],
    ["2026-12-31T23:59:59Z", "2027-01-01T01:05:00.000Z"],
  ])("schedules the next Bangkok observation after %s", (input, expected) => {
    expect(nextScheduled(new Date(input)).toISOString()).toBe(expected);
  });
  it("preserves the supplied URL but sends just the hostname to Ping.pe", () => {
    expect(
      normalizeTarget(
        { name: "Website A", url: "https://www.example.com/path?q=1" },
        0,
      ),
    ).toMatchObject({
      id: "target-1",
      hostname: "www.example.com",
      url: "https://www.example.com/path?q=1",
    });
  });
  it.each([
    "file:///etc/passwd",
    "https://user:pass@example.com",
    "localhost",
    "127.0.0.1",
    "10.2.3.4",
    "172.17.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "hello.internal",
  ])("rejects unsupported target %s", (url) => {
    expect(() => normalizeTarget({ name: "Test", url }, 0)).toThrow();
  });
});
