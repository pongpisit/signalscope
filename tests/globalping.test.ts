import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectGlobalping,
  createGlobalping,
  globalpingResult,
  persistGlobalping,
  type GlobalpingMeasurement,
} from "../worker/globalping";

const target = {
  id: "target-1",
  name: "First",
  hostname: "one.example",
  url: "https://one.example/",
};
const measurement = (): GlobalpingMeasurement => ({
  id: "measurement-1",
  type: "ping",
  target: target.hostname,
  status: "finished",
  updatedAt: "2026-10-26T01:00:15.000Z",
  probesCount: 2,
  results: [
    {
      probe: {
        country: "TH",
        city: "Bangkok",
        network: "Test network",
        asn: 123,
      },
      result: {
        status: "finished",
        resolvedAddress: "203.0.113.10",
        stats: { total: 10, loss: 0, avg: 12, min: 10, max: 14 },
      },
    },
    {
      probe: {
        country: "TH",
        city: "Chiang Mai",
        network: "Another network",
        asn: 456,
      },
      result: { status: "offline" },
    },
  ],
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Globalping adapter", () => {
  const thailand = { country: "TH", limit: 30 };
  it("selects only the configured country with the configured limit, then reuses a previous selection", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ id: "selection-1", probesCount: 30 }, { status: 202 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const first = await createGlobalping(target, undefined, thailand);
    await createGlobalping(
      { ...target, hostname: "two.example" },
      first.id,
      thailand,
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      type: "ping",
      target: "one.example",
      locations: [{ country: "TH" }],
      limit: 30,
      timeout: 30,
      measurementOptions: { packets: 10, protocol: "ICMP" },
    });
    expect(JSON.parse(fetcher.mock.calls[1][1].body).locations).toBe(
      "selection-1",
    );
    expect(JSON.parse(fetcher.mock.calls[1][1].body).limit).toBe(30);
    expect(fetcher.mock.calls[0][1].headers["User-Agent"]).toContain(
      "signalscope",
    );
  });
  it("runs probes from any configured country with its own limit", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ id: "selection-jp", probesCount: 10 }, { status: 202 }),
      );
    vi.stubGlobal("fetch", fetcher);
    await createGlobalping(target, undefined, { country: "JP", limit: 10 });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      locations: [{ country: "JP" }],
      limit: 10,
    });
    const japan = measurement();
    japan.results.forEach((r) => {
      r.probe.country = "JP";
      r.probe.city = "Tokyo";
    });
    const result = globalpingResult(target, japan, undefined, "JP");
    expect(result.probes[0]).toMatchObject({
      id: "JP_globalping_0",
      location: "Japan, Tokyo",
    });
  });
  it("reports rate limits without retrying a potentially charged creation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(createGlobalping(target, undefined, thailand)).rejects.toThrow(
      "Retry after 120 seconds",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects empty or oversized probe selections", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "id", probesCount: 0 }))
      .mockResolvedValueOnce(Response.json({ id: "id", probesCount: 31 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(createGlobalping(target, undefined, thailand)).rejects.toThrow(
      "no usable Thailand",
    );
    await expect(
      createGlobalping(target, undefined, { country: "TH", limit: 25 }),
    ).rejects.toThrow("no usable Thailand");
  });
  it("polls after responses with ETag caching and stops on final status", async () => {
    vi.useFakeTimers();
    const first = { ...measurement(), status: "in-progress" };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(first, { headers: { ETag: '"v1"' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(Response.json(measurement()));
    vi.stubGlobal("fetch", fetcher);
    const pending = collectGlobalping("measurement-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toEqual(measurement());
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1][1].headers["If-None-Match"]).toBe('"v1"');
  });
  it("bounds polling and reports a timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async () =>
          Response.json({ ...measurement(), status: "in-progress" }),
        ),
    );
    const pending = expect(collectGlobalping("measurement-1")).rejects.toThrow(
      "within 60 seconds",
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await pending;
  });
  it("preserves missing metrics and 100% loss without inventing jitter", () => {
    const raw = measurement();
    const partial = globalpingResult(target, raw);
    expect(partial.status).toBe("partial");
    expect(partial.probes[0]).toMatchObject({
      id: "TH_globalping_0",
      avg: 12,
      jitter: null,
      sent: 10,
    });
    expect(partial.probes[1]).toMatchObject({ sent: 0, loss: null, avg: null });
    raw.results[1].result = {
      status: "finished",
      stats: { total: 10, loss: 100, avg: null, min: null, max: null },
    };
    const complete = globalpingResult(target, raw);
    expect(complete.status).toBe("complete");
    expect(complete.probes[1]).toMatchObject({
      sent: 10,
      loss: 100,
      avg: null,
      jitter: null,
    });
    expect(globalpingResult(target).status).toBe("failed");
  });
  it("rejects any out-of-country result and wrong target", () => {
    const raw = measurement();
    raw.results[1].probe.country = "SG";
    expect(() => globalpingResult(target, raw)).toThrow("outside Thailand");
    expect(() =>
      globalpingResult(target, { ...measurement(), target: "wrong.example" }),
    ).toThrow("different target");
  });
  it("keeps each probe's resolved destination distinct, including loss and absent addresses", () => {
    const raw = measurement();
    raw.results[1].result = {
      status: "finished",
      resolvedAddress: "2001:db8::2",
      stats: { total: 10, loss: 100, avg: null, min: null, max: null },
    };
    const result = globalpingResult(target, raw);
    expect(result.probes.map((p) => p.resolvedAddress)).toEqual([
      "203.0.113.10",
      "2001:db8::2",
    ]);
    expect(result.probes[1].loss).toBe(100);
    expect(
      globalpingResult(target, measurement()).probes[1].resolvedAddress,
    ).toBeNull();
    raw.results[0].result.resolvedAddress = "not-an-ip.example";
    expect(globalpingResult(target, raw).probes[0].resolvedAddress).toBeNull();
  });
  it("captures a raw PING destination when the structured address is absent", () => {
    const raw = measurement();
    raw.results[0].result.resolvedAddress = null;
    raw.results[0].result.rawOutput =
      "PING one.example (203.0.113.42) 56(84) bytes of data.";
    expect(globalpingResult(target, raw).probes[0].resolvedAddress).toBe(
      "203.0.113.42",
    );
  });
  it("stores raw API evidence and its checksum under a separate source prefix", async () => {
    const put = vi.fn();
    const run = vi.fn();
    const bind = vi.fn(() => ({ run }));
    const env = { EVIDENCE: { put }, DB: { prepare: vi.fn(() => ({ bind })) } };
    // Minimal binding doubles exercise R2 bytes and the D1 value together.
    await persistGlobalping(
      env as unknown as Pick<Env, "DB" | "EVIDENCE">,
      "run-1",
      globalpingResult(target, measurement()),
      measurement(),
    );
    expect(put.mock.calls[0][0]).toBe(
      "run-1/globalping/target-1/evidence.json",
    );
    const bytes = put.mock.calls[0][1] as Uint8Array;
    expect(JSON.parse(new TextDecoder().decode(bytes)).request.limit).toBe(30);
    expect(JSON.parse(new TextDecoder().decode(bytes)).measurement).toEqual(
      measurement(),
    );
    const digest = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
      ),
    ]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    expect(put.mock.calls[0][2].customMetadata.sha256).toBe(digest);
    expect(bind.mock.calls[0].slice(0, 2)).toEqual([
      "run-1",
      "globalping-target-1",
    ]);
    expect(JSON.parse(bind.mock.calls[0][2]).evidence[0]).toMatchObject({
      sha256: digest,
      kind: "json",
      bytes: bytes.byteLength,
    });
  });
});
