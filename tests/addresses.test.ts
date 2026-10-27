import { describe, expect, it } from "vitest";
import {
  destinationIp,
  ipAddress,
  testedDestinationIp,
} from "../shared/addresses";
import type { Result, Probe } from "../shared/types";

describe("recorded destination IPs", () => {
  it("prefers structured fields and only falls back to the destination in a PING header", () => {
    const rawOutput =
      "PING test.example (203.0.113.10) 56(84) bytes of data.\n64 bytes from 192.0.2.1: icmp_seq=1";
    expect(
      testedDestinationIp({ resolvedAddress: "203.0.113.20", rawOutput }),
    ).toBe("203.0.113.20");
    expect(testedDestinationIp({ rawOutput })).toBe("203.0.113.10");
    expect(
      testedDestinationIp({
        rawOutput: "PING test.example(2001:db8::1) 56 data bytes",
      }),
    ).toBe("2001:db8::1");
    expect(
      testedDestinationIp({ rawOutput: "PING 203.0.113.10 56 data bytes" }),
    ).toBe("203.0.113.10");
    expect(
      testedDestinationIp({ rawOutput: "64 bytes from 192.0.2.1: icmp_seq=1" }),
    ).toBeNull();
    expect(
      testedDestinationIp({
        rawOutput: "PING test.example (999.0.0.1)\n64 bytes from 192.0.2.1",
      }),
    ).toBeNull();
    expect(testedDestinationIp({ rawOutput: "probe offline" })).toBeNull();
  });
  it.each([
    [" 203.0.113.10 ", "203.0.113.10"],
    ["2001:db8::1", "2001:db8::1"],
    ["::ffff:192.0.2.1", "::ffff:192.0.2.1"],
    ["999.0.0.1", null],
    ["2001:db8:::1", null],
    ["example.com", null],
    ["https://203.0.113.10", null],
    ["", null],
    [null, null],
  ])("accepts only reported IP literals: %s", (input, expected) => {
    expect(ipAddress(input)).toBe(expected);
  });
  it("preserves per-probe scope and never falls back to a page IP for Globalping", () => {
    const result = {
      source: "globalping",
      resolvedAddress: "203.0.113.99",
    } as Result;
    const probe = { resolvedAddress: "203.0.113.10" } as Probe;
    expect(destinationIp(result, probe)).toEqual({
      address: "203.0.113.10",
      scope: "probe",
    });
    expect(destinationIp(result)).toEqual({
      address: null,
      scope: "unavailable",
    });
    expect(destinationIp({ ...result, source: undefined })).toEqual({
      address: "203.0.113.99",
      scope: "page",
    });
    expect(destinationIp()).toEqual({ address: null, scope: "unavailable" });
  });
});
