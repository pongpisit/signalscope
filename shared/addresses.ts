import type { Probe, Result } from "./types";

export function ipAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const address = value.trim();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address))
    return address.split(".").every((octet) => Number(octet) <= 255)
      ? address
      : null;
  if (!/^[0-9a-f:]+(?:\.[0-9.]+)?$/i.test(address) || !address.includes(":"))
    return null;
  try {
    // URL's IPv6 parser rejects invalid compression and group counts.
    new URL(`http://[${address}]/`);
    return address;
  } catch {
    return null;
  }
}

export function destinationIp(
  result?: Result,
  probe?: Probe,
): {
  address: string | null;
  scope: "probe" | "page" | "unavailable";
} {
  const perProbe = ipAddress(probe?.resolvedAddress);
  if (perProbe) return { address: perProbe, scope: "probe" };
  const pageAddress =
    result?.source !== "globalping" ? ipAddress(result?.resolvedAddress) : null;
  if (pageAddress) return { address: pageAddress, scope: "page" };
  return { address: null, scope: "unavailable" };
}

export function testedDestinationIp(result: {
  resolvedAddress?: unknown;
  rawOutput?: unknown;
}): string | null {
  const structured = ipAddress(result.resolvedAddress);
  if (structured) return structured;
  if (typeof result.rawOutput !== "string") return null;
  // Only the PING header names the destination. Never use reply/hop/source IPs.
  const header = result.rawOutput.trimStart().split(/\r?\n/, 1)[0];
  const match = /^PING[ \t]+([^\s(]+)(?:[ \t]*\(([^)]+)\))?/.exec(header);
  return match ? ipAddress(match[2] ?? match[1]) : null;
}

export function destinationIps(
  result?: Result,
  probe?: Probe,
): { address: string; scope: "probe" | "page" }[] {
  if (probe?.destinationIps) return probe.destinationIps;
  const destination = destinationIp(result, probe);
  return destination.address && destination.scope !== "unavailable"
    ? [{ address: destination.address, scope: destination.scope }]
    : [];
}
