import type { Probe, Summary, Target } from "./types";

// An entry matches a probe when it equals the provider name (case-insensitive,
// whitespace-normalized, trailing ASN suffix ignored) or names its ASN, e.g.
// "KeFF Networks (AS41281)" or "41281" or "AS41281".
export function excludedNetwork(
  probe: Pick<Probe, "provider">,
  ignored: readonly string[] = [],
): boolean {
  if (!ignored.length) return false;
  const provider = probe.provider.trim().replace(/\s+/g, " ");
  const bareName = provider.replace(/\s*\(AS\s*\d+\)\s*$/i, "").toLowerCase();
  for (const entry of ignored) {
    const value = String(entry).trim().replace(/\s+/g, " ");
    if (!value) continue;
    const asn = value.match(/^(?:as\s*)?(\d{1,10})$/i);
    if (asn) {
      if (new RegExp(`\\bAS\\s*${asn[1]}\\b`, "i").test(provider)) return true;
      continue;
    }
    if (value.replace(/\s*\(AS\s*\d+\)\s*$/i, "").toLowerCase() === bareName)
      return true;
  }
  return false;
}

export function normalizeIgnoredNetworks(value: unknown): string[] {
  if (!Array.isArray(value))
    throw new Error("Ignored networks must be a list of names or ASNs.");
  if (value.length > 20) throw new Error("Ignore at most 20 networks.");
  const entries = value.map((entry) => {
    if (typeof entry !== "string")
      throw new Error("Ignored networks must be a list of names or ASNs.");
    return entry.trim().replace(/\s+/g, " ");
  });
  if (entries.some((entry) => entry.length > 80))
    throw new Error("Keep each ignored network under 80 characters.");
  return entries.filter(Boolean);
}

export function mean(values: (number | null)[]): number | null {
  const valid = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

export function summarize(probes: Probe[]): Summary {
  const reporting = probes.filter((p) => p.sent > 0 && p.loss !== null);
  return {
    avg: mean(reporting.map((p) => p.avg)),
    loss: mean(reporting.map((p) => p.loss)),
    jitter: mean(reporting.map((p) => p.jitter)),
    reporting: reporting.length,
    total: probes.length,
    reachable: reporting.filter((p) => p.loss! < 100).length,
  };
}

export function normalizeTarget(
  input: { name?: unknown; url?: unknown },
  index: number,
): Target {
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 60
  )
    throw new Error("Each target needs a name of 1–60 characters.");
  if (typeof input.url !== "string" || input.url.length > 2048)
    throw new Error("Enter a valid HTTP(S) URL or hostname.");
  let url: URL;
  try {
    url = new URL(
      input.url.includes("://") ? input.url : `https://${input.url}`,
    );
  } catch {
    throw new Error("Enter a valid HTTP(S) URL or hostname.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Use an HTTP(S) URL without credentials.");
  const host = url.hostname.toLowerCase();
  // Only DNS names / IPv4: these are passed as a single path segment to Ping.pe.
  if (
    !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) ||
    host.includes("..")
  )
    throw new Error("Use a public DNS hostname or IPv4 address.");
  if (
    !host.includes(".") ||
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      host,
    ) ||
    /\.(local|internal|localhost)$/.test(host)
  )
    throw new Error("Use a public hostname or IPv4 address.");
  return {
    id: `target-${index + 1}`,
    name: input.name.trim(),
    url: url.toString(),
    hostname: host,
  };
}

export { nextScheduled } from "./schedule";
