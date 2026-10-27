import type { Result, Target } from "../shared/types";
import { testedDestinationIp } from "../shared/addresses";
import { countryName } from "../shared/countries";

const endpoint = "https://api.globalping.io/v1/measurements";
const headers = {
  "User-Agent": "signalscope/1.0 (Globalping integration)",
  "Content-Type": "application/json",
  "Accept-Encoding": "gzip",
};

// The country whose probes to run and the maximum probes per target.
export type GlobalpingOptions = { country: string; limit: number };

export type GlobalpingMeasurement = {
  id: string;
  type: string;
  target: string;
  status: string;
  updatedAt: string;
  probesCount: number;
  results: {
    probe: { country: string; city: string; network: string; asn: number };
    result: {
      status: string;
      resolvedAddress?: string | null;
      rawOutput?: string;
      stats?: {
        total: number;
        loss: number;
        avg: number | null;
        min: number | null;
        max: number | null;
      };
    };
  }[];
};

async function check(response: Response) {
  if (response.ok) return;
  if (response.status === 429) {
    const retry = response.headers.get("Retry-After");
    const remaining = response.headers.get("X-RateLimit-Remaining");
    throw new Error(
      `Globalping rate limit reached${remaining ? ` (${remaining} remaining)` : ""}.${retry ? ` Retry after ${retry} seconds.` : " Try again after the hourly allowance resets."}`,
    );
  }
  throw new Error(`Globalping API returned HTTP ${response.status}.`);
}

export async function createGlobalping(
  target: Target,
  selection: string | undefined,
  options: GlobalpingOptions,
) {
  // Never retry POST automatically: a lost response may still have spent tests.
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      type: "ping",
      target: target.hostname,
      locations: selection ?? [{ country: options.country }],
      limit: options.limit,
      timeout: 30,
      measurementOptions: { packets: 10, protocol: "ICMP" },
    }),
  });
  await check(response);
  const data = await response.json<{ id: string; probesCount: number }>();
  if (
    !/^[a-zA-Z0-9_-]+$/.test(data.id) ||
    !Number.isInteger(data.probesCount) ||
    data.probesCount < 1 ||
    data.probesCount > options.limit
  )
    throw new Error(
      `Globalping returned no usable ${countryName(options.country)} probe selection.`,
    );
  return data;
}

export async function collectGlobalping(
  id: string,
  limit = 30,
): Promise<GlobalpingMeasurement> {
  let etag: string | null = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response: Response = await fetch(
      `${endpoint}/${encodeURIComponent(id)}`,
      {
        headers: { ...headers, ...(etag ? { "If-None-Match": etag } : {}) },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status !== 304) {
      await check(response);
      const data = await response.json<GlobalpingMeasurement>();
      if (
        data.id !== id ||
        data.type !== "ping" ||
        !Array.isArray(data.results) ||
        data.results.length > limit ||
        data.probesCount > limit
      )
        throw new Error("Globalping returned an invalid measurement response.");
      etag = response.headers.get("ETag");
      if (data.status !== "in-progress") return data;
    }
    // Delay after each response, rather than polling on a fixed interval.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Globalping did not finalize within 60 seconds.");
}

export function globalpingResult(
  target: Target,
  measurement?: GlobalpingMeasurement,
  error?: string,
  country = "TH",
): Result {
  if (
    measurement &&
    (measurement.target !== target.hostname ||
      measurement.results.some((r) => r.probe.country !== country))
  )
    throw new Error(
      `Globalping returned a different target or a probe outside ${countryName(country)}; results rejected.`,
    );
  const number = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const probes = (measurement?.results ?? []).map(
    ({ probe, result }, index) => {
      const stats = result.status === "finished" ? result.stats : undefined;
      return {
        // Globalping exposes no permanent probe IDs. Reused selections preserve order.
        id: `${country}_globalping_${index}`,
        location: `${countryName(country)}, ${probe.city}`,
        provider: `${probe.network} (AS${probe.asn})`,
        resolvedAddress: testedDestinationIp(result),
        sent: number(stats?.total) ?? 0,
        loss: number(stats?.loss),
        avg: number(stats?.avg),
        best: number(stats?.min),
        worst: number(stats?.max),
        jitter: null,
      };
    },
  );
  const reporting = probes.filter((p) => p.sent > 0 && p.loss !== null).length;
  return {
    source: "globalping",
    ...(measurement ? { measurementId: measurement.id } : {}),
    targetId: target.id,
    targetName: target.name,
    hostname: target.hostname,
    capturedAt: measurement?.updatedAt ?? new Date().toISOString(),
    sourceUrl: measurement
      ? `${endpoint}/${measurement.id}`
      : "https://globalping.io/",
    status: reporting
      ? reporting === measurement?.probesCount && reporting === probes.length
        ? "complete"
        : "partial"
      : "failed",
    probes,
    evidence: [],
    ...(error || !reporting
      ? { error: error ?? "No Globalping probes reported valid samples." }
      : reporting < (measurement?.probesCount ?? 0)
        ? { error: "Some Globalping probes failed or went offline." }
        : {}),
  };
}

export async function persistGlobalping(
  env: Pick<Env, "DB" | "EVIDENCE">,
  runId: string,
  result: Result,
  measurement?: GlobalpingMeasurement,
  options: GlobalpingOptions = { country: "TH", limit: 30 },
) {
  const key = `${runId}/globalping/${result.targetId}/evidence.json`;
  const bytes = new TextEncoder().encode(
    JSON.stringify(
      {
        ...result,
        request: {
          country: options.country,
          limit: options.limit,
          packets: 10,
          protocol: "ICMP",
        },
        note: "Globalping API evidence; not a Ping.pe capture. Probe IDs are selection-relative, not persistent identities. Jitter is not provided by the ping API. SHA-256 provides integrity, not independent authentication.",
        measurement: measurement ?? null,
      },
      null,
      2,
    ),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await env.EVIDENCE.put(key, bytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      sha256,
      capturedAt: result.capturedAt,
      sourceUrl: result.sourceUrl,
    },
  });
  const stored = {
    ...result,
    evidence: [{ kind: "json" as const, key, sha256, bytes: bytes.byteLength }],
  };
  await env.DB.prepare(
    "INSERT OR REPLACE INTO results (run_id, target_id, value) VALUES (?, ?, ?)",
  )
    .bind(runId, `globalping-${result.targetId}`, JSON.stringify(stored))
    .run();
}
