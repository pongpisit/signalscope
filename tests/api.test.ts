import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatformProxy, unstable_dev, type PlatformProxy } from "wrangler";
import { execFileSync } from "node:child_process";
import {
  cadenceOptions,
  nextScheduled,
  scheduleTimes,
  scheduledSlot,
} from "../shared/schedule";
import { dispatchScheduled } from "../worker/scheduler";

let worker: Awaited<ReturnType<typeof unstable_dev>>;
let origin: string;
let cookie = "";
let platform: PlatformProxy<Env>;
// A single Unicode character must work; there is no minimum password length.
const token = "ก";
const state = ".wrangler/api-test-state";
const targets = [1, 2, 3].map((n) => ({
  name: `Test ${n}`,
  url: `https://target-${n}.example`,
}));

beforeAll(async () => {
  execFileSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "migrations",
      "apply",
      "pingpe-observatory",
      "--local",
      "--persist-to",
      state,
    ],
    { stdio: "pipe" },
  );
  platform = await getPlatformProxy<Env>({
    configPath: "wrangler.jsonc",
    persist: { path: `${state}/v3` },
    remoteBindings: false,
  });
  await platform.env.DB.batch([
    platform.env.DB.prepare("DELETE FROM settings"),
    platform.env.DB.prepare(
      "DELETE FROM results WHERE run_id LIKE 'clear-fixture-%' OR run_id = 'clear-active-fixture'",
    ),
    platform.env.DB.prepare(
      "DELETE FROM runs WHERE id LIKE 'clear-fixture-%' OR id = 'clear-active-fixture'",
    ),
  ]);
  await platform.env.DB.batch(
    Array.from({ length: 64 }, (_, i) =>
      platform.env.DB.prepare(
        "INSERT INTO runs (id, started_at, completed_at, source, status, targets) VALUES (?, ?, ?, 'manual', 'complete', '[]')",
      ).bind(
        `clear-fixture-${i}`,
        `2026-01-${String((i % 28) + 1).padStart(2, "0")}T01:00:00.000Z`,
        "2026-01-31T01:00:00.000Z",
      ),
    ),
  );
  await platform.env.DB.prepare(
    "INSERT INTO runs (id, started_at, source, status, targets) VALUES ('clear-active-fixture', ?, 'manual', 'queued', '[]')",
  )
    .bind(new Date().toISOString())
    .run();
  await platform.env.DB.prepare(
    "INSERT INTO results (run_id, target_id, value) VALUES ('clear-fixture-0', 'target-1', ?)",
  )
    .bind(
      JSON.stringify({
        targetId: "target-1",
        targetName: "Test",
        hostname: "target-1.example",
        status: "complete",
        capturedAt: new Date().toISOString(),
        sourceUrl: "https://ping.pe/target-1.example",
        probes: [],
        evidence: [],
      }),
    )
    .run();
  for (const key of [
    "clear-fixture-0/target-1/evidence.png",
    "clear-fixture-0/target-1/evidence.pdf",
    "clear-fixture-0/target-1/evidence.json",
    "clear-fixture-0/unfinished-capture.tmp",
    "clear-fixture-63/target-1/evidence.png",
    "newer-unlisted-run/target-1/evidence.png",
  ])
    await platform.env.EVIDENCE.put(key, "local history-clearing test fixture");
  worker = await unstable_dev("worker/index.ts", {
    config: "wrangler.jsonc",
    local: true,
    persist: true,
    persistTo: state,
    vars: { DASHBOARD_TOKEN: token },
    logLevel: "error",
    experimental: {
      disableExperimentalWarning: true,
      disableDevRegistry: true,
      watch: false,
    },
  });
  origin = `http://${worker.address}:${worker.port}`;
});
afterAll(async () => {
  await worker?.stop();
  await platform?.dispose();
});

function request(
  path: string,
  method = "GET",
  body?: unknown,
  requestOrigin = origin,
) {
  return worker.fetch(`${origin}/api${path}`, {
    method,
    headers: {
      Origin: requestOrigin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("local Worker API with real D1", () => {
  it("protects both measurements and evidence", async () => {
    expect((await request("/dashboard")).status).toBe(401);
    expect((await request("/evidence/no-run/target-1/png")).status).toBe(401);
    expect((await request("/history", "DELETE")).status).toBe(401);
  });
  it("rejects cross-origin login and incorrect credentials", async () => {
    expect(
      (await request("/login", "POST", { token }, "https://elsewhere.example"))
        .status,
    ).toBe(403);
    expect(
      (await request("/login", "POST", { token: "incorrect" })).status,
    ).toBe(401);
    expect((await request("/login", "POST", { token: "" })).status).toBe(401);
  });
  it("recognizes a one-character password and signs in with an HttpOnly session cookie", async () => {
    const session = (await (await request("/session")).json()) as {
      configured: boolean;
    };
    expect(session.configured).toBe(true);
    const response = await request("/login", "POST", { token });
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    cookie = response.headers.get("Set-Cookie")!.split(";")[0];
    expect((await request("/dashboard")).status).toBe(200);
  });
  it("validates distinct hostnames and saves configuration to D1", async () => {
    const invalid = await request("/settings", "PUT", {
      targets: [targets[0], targets[0], targets[1]],
      enabled: false,
      sampleSeconds: 45,
    });
    expect(invalid.status).toBe(400);
    const saved = await request("/settings", "PUT", {
      targets,
      enabled: false,
      sampleSeconds: 45,
    });
    expect(saved.status).toBe(200);
    const dashboard = (await (await request("/dashboard")).json()) as {
      settings: { targets: { hostname: string }[]; enabled: boolean };
      schedule: string[];
    };
    expect(dashboard.settings.targets[0].hostname).toBe("target-1.example");
    expect(dashboard.settings.enabled).toBe(false);
    expect(dashboard.schedule).toEqual(["08:05", "17:10"]);
  });
  it.each(cadenceOptions)(
    "persists $value and returns its Bangkok schedule",
    async ({ value }) => {
      const saved = await request("/settings", "PUT", {
        targets,
        enabled: false,
        sampleSeconds: 45,
        cadence: value,
      });
      expect(saved.status).toBe(200);
      const dashboard = (await (await request("/dashboard")).json()) as {
        settings: { cadence: string };
        schedule: string[];
      };
      expect(dashboard.settings.cadence).toBe(value);
      expect(dashboard.schedule).toEqual(scheduleTimes(value));
    },
  );
  it("rejects unsupported cadences without changing saved configuration", async () => {
    const before = await (await request("/dashboard")).json();
    for (const cadence of [null, "every-0h", "every-5h", "every-25h", {}, 2]) {
      const response = await request("/settings", "PUT", {
        targets,
        enabled: false,
        sampleSeconds: 45,
        cadence,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Choose a supported observation frequency.",
      });
    }
    const after = await (await request("/dashboard")).json();
    expect(after.settings).toEqual(before.settings);
  });
  it("preserves the saved cadence when an older client omits it", async () => {
    const saved = await request("/settings", "PUT", {
      targets,
      enabled: false,
      sampleSeconds: 45,
    });
    expect((await saved.json()).cadence).toBe("every-24h");
    await request("/settings", "PUT", {
      targets,
      enabled: false,
      sampleSeconds: 45,
      cadence: "twice-daily",
    });
  });
  it("validates and saves country, time zone, probe count, and ignored networks", async () => {
    const body = {
      targets,
      enabled: false,
      sampleSeconds: 45,
      cadence: "every-1h",
    };
    for (const [field, value] of [
      ["country", "THA"],
      ["country", 7],
      ["timezone", "Middle Earth"],
      ["globalpingLimit", 0],
      ["globalpingLimit", 51],
      ["ignoredNetworks", "KeFF"],
      ["ignoredNetworks", ["x".repeat(81)]],
      ["ignoredNetworks", Array.from({ length: 21 }, () => "AS1")],
    ] as const) {
      const response = await request("/settings", "PUT", {
        ...body,
        [field]: value,
      });
      expect(response.status).toBe(400);
    }
    const saved = await request("/settings", "PUT", {
      ...body,
      country: "jp",
      timezone: "Asia/Tokyo",
      globalpingLimit: 10,
      ignoredNetworks: ["AS9999", "  Test Network  ", ""],
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      country: "JP",
      timezone: "Asia/Tokyo",
      globalpingLimit: 10,
      ignoredNetworks: ["AS9999", "Test Network"],
    });
    const dashboard = (await (await request("/dashboard")).json()) as {
      settings: Record<string, unknown>;
      timezone: string;
    };
    expect(dashboard.settings.country).toBe("JP");
    expect(dashboard.timezone).toBe("Asia/Tokyo");
    // An older client omitting the fields preserves the saved values.
    const legacy = await request("/settings", "PUT", {
      targets,
      enabled: false,
      sampleSeconds: 45,
      cadence: "twice-daily",
    });
    expect(await legacy.json()).toMatchObject({
      country: "JP",
      timezone: "Asia/Tokyo",
      globalpingLimit: 10,
      ignoredNetworks: ["AS9999", "Test Network"],
    });
  });
  it("keeps the original deployment defaults for settings saved before these fields existed", async () => {
    const legacy = {
      targets,
      enabled: false,
      sampleSeconds: 45,
      cadence: "twice-daily",
    };
    await platform.env.DB.prepare(
      "INSERT OR REPLACE INTO settings (id, value) VALUES (1, ?)",
    )
      .bind(JSON.stringify(legacy))
      .run();
    const dashboard = (await (await request("/dashboard")).json()) as {
      settings: Record<string, unknown>;
      timezone: string;
    };
    expect(dashboard.settings.country).toBe("TH");
    expect(dashboard.timezone).toBe("Asia/Bangkok");
    expect(dashboard.settings.globalpingLimit).toBe(30);
    expect(dashboard.settings.ignoredNetworks).toEqual([
      "KeFF Networks (AS41281)",
      "SiS Distribution (Thailand)",
    ]);
  });
  it("starts a newly enabled schedule at a future slot and preserves that boundary on unchanged saves", async () => {
    const before = nextScheduled(new Date(), "every-1h").toISOString();
    const body = {
      targets,
      enabled: true,
      sampleSeconds: 45,
      cadence: "every-1h",
    };
    const saved = await (await request("/settings", "PUT", body)).json();
    const after = nextScheduled(new Date(), "every-1h").toISOString();
    expect([before, after]).toContain(saved.scheduleNotBefore);
    expect(
      (await (await request("/settings", "PUT", body)).json())
        .scheduleNotBefore,
    ).toBe(saved.scheduleNotBefore);
    await request("/settings", "PUT", { ...body, enabled: false });
  });
  it("blocks history clearing during an observation and rejects cross-origin deletion", async () => {
    expect(
      (
        await request(
          "/history",
          "DELETE",
          undefined,
          "https://elsewhere.example",
        )
      ).status,
    ).toBe(403);
    const response = await request("/history", "DELETE");
    expect(response.status).toBe(409);
    expect(
      (await request("/evidence/clear-fixture-0/target-1/png")).status,
    ).toBe(200);
    await platform.env.DB.prepare(
      "UPDATE runs SET status = 'complete' WHERE id = 'clear-active-fixture'",
    ).run();
  });
  it("keeps Globalping results and authenticated JSON evidence separate from Ping.pe", async () => {
    const result = {
      source: "globalping",
      targetId: "target-1",
      targetName: "Test",
      hostname: "target-1.example",
      status: "complete",
      capturedAt: new Date().toISOString(),
      sourceUrl: "https://api.globalping.io/v1/measurements/test-id",
      probes: [],
      evidence: [],
    };
    await platform.env.DB.prepare(
      "INSERT INTO results (run_id, target_id, value) VALUES ('clear-fixture-0', 'globalping-target-1', ?)",
    )
      .bind(JSON.stringify(result))
      .run();
    await platform.env.EVIDENCE.put(
      "clear-fixture-0/globalping/target-1/evidence.json",
      JSON.stringify(result),
      {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { sha256: "test-checksum" },
      },
    );
    // This fixture is older than the bounded dashboard window; check source
    // separation on a visible run as well.
    await platform.env.DB.prepare(
      "INSERT INTO results (run_id, target_id, value) VALUES ('clear-fixture-27', 'globalping-target-1', ?)",
    )
      .bind(JSON.stringify(result))
      .run();
    const dashboard = (await (await request("/dashboard")).json()) as {
      runs: { id: string; results: unknown[]; globalpingResults: unknown[] }[];
    };
    const visible = dashboard.runs.find(
      (run) => run.id === "clear-fixture-27",
    )!;
    expect(visible.results).toEqual([]);
    expect(visible.globalpingResults).toEqual([result]);
    const evidence = await request(
      "/evidence/clear-fixture-0/target-1/json?source=globalping&download=1",
    );
    expect(evidence.status).toBe(200);
    expect(await evidence.json()).toEqual(result);
    expect(evidence.headers.get("X-Evidence-SHA256")).toBe("test-checksum");
    expect(evidence.headers.get("Content-Disposition")).toContain(
      "globalping-",
    );
    expect(
      (
        await request(
          "/evidence/clear-fixture-0/target-1/png?source=globalping",
        )
      ).status,
    ).toBe(404);
    expect(
      (await request("/evidence/clear-fixture-0/target-1/json?source=unknown"))
        .status,
    ).toBe(400);
  });
  it("loads every test in the 30-day window even when there are more than 60", async () => {
    await platform.env.DB.prepare(
      "UPDATE runs SET started_at = ? WHERE id LIKE 'clear-fixture-%'",
    )
      .bind(new Date(Date.now() - 86400_000).toISOString())
      .run();
    const dashboard = (await (await request("/dashboard")).json()) as {
      runs: { id: string; results: unknown[]; globalpingResults: unknown[] }[];
    };
    expect(dashboard.runs).toHaveLength(65);
    const oldestPreviouslyHidden = dashboard.runs.find(
      (r) => r.id === "clear-fixture-0",
    )!;
    expect(oldestPreviouslyHidden.results).toHaveLength(1);
    expect(oldestPreviouslyHidden.globalpingResults).toHaveLength(1);
  });
  it("clears all historical runs, results and evidence while preserving settings and newer files", async () => {
    const before = (await (await request("/dashboard")).json()) as {
      runs: unknown[];
      settings: unknown;
    };
    expect(before.runs).toHaveLength(65);
    const response = await request("/history", "DELETE");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cleared: true,
      deletedRuns: 65,
      deletedFiles: 6,
    });
    const after = (await (await request("/dashboard")).json()) as {
      runs: unknown[];
      settings: unknown;
    };
    expect(after.runs).toEqual([]);
    expect(after.settings).toEqual(before.settings);
    expect(
      (await request("/evidence/clear-fixture-0/target-1/png")).status,
    ).toBe(404);
    expect(
      (
        await platform.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM results",
        ).first<{ count: number }>()
      )?.count,
    ).toBe(0);
    expect(
      await platform.env.EVIDENCE.get(
        "newer-unlisted-run/target-1/evidence.png",
      ),
    ).not.toBeNull();
    const repeated = await request("/history", "DELETE");
    expect(await repeated.json()).toEqual({
      cleared: true,
      deletedRuns: 0,
      deletedFiles: 0,
    });
  });
  it("returns a missing-evidence error and invalidates sign-out", async () => {
    expect((await request("/evidence/no-run/target-1/png")).status).toBe(404);
    const response = await request("/logout", "POST");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    cookie = "";
    expect((await request("/dashboard")).status).toBe(401);
  });
  it("creates exactly one Workflow and D1 row for repeated late heartbeat deliveries", async () => {
    const previous = await platform.env.DB.prepare(
      "SELECT value FROM settings WHERE id = 1",
    ).first<{ value: string }>();
    const config = {
      ...JSON.parse(previous!.value),
      enabled: true,
      cadence: "every-1h",
    };
    // The dispatcher normalizes legacy rows to the original deployment defaults.
    const expectedCountry = config.country ?? "TH";
    const expectedTimezone = config.timezone ?? "Asia/Bangkok";
    delete config.scheduleNotBefore;
    await platform.env.DB.prepare("UPDATE settings SET value = ? WHERE id = 1")
      .bind(JSON.stringify(config))
      .run();
    const create = vi.fn<Env["MEASUREMENT"]["create"]>();
    const env = {
      ...platform.env,
      MEASUREMENT: {
        create,
        get: vi.fn<Env["MEASUREMENT"]["get"]>(),
        createBatch: vi.fn<Env["MEASUREMENT"]["createBatch"]>(),
        deleteBatch: vi.fn<Env["MEASUREMENT"]["deleteBatch"]>(),
      },
    };
    // The dispatcher normalizes legacy rows to the original deployment defaults,
    // and the hourly slot starts at a staggered :05 or :10 past the hour.
    const hourFloor = Math.floor(Date.now() / 3600_000) * 3600_000;
    const slot =
      scheduledSlot(hourFloor + 59 * 60_000, "every-1h", expectedTimezone) ??
      hourFloor;
    const clock = vi.spyOn(Date, "now").mockReturnValue(slot + 20_000);
    const id = `scheduled-${slot}`;
    try {
      for (const delay of [1234, 60_000, 1598_034, 23 * 60_000, 40 * 60_000])
        await dispatchScheduled({ scheduledTime: slot + delay }, env);
      expect(create).toHaveBeenCalledExactlyOnceWith({
        id,
        params: {
          runId: id,
          targets: config.targets,
          sampleSeconds: config.sampleSeconds,
          country: expectedCountry,
          globalpingLimit: config.globalpingLimit ?? 30,
        },
      });
      const rows = await platform.env.DB.prepare(
        "SELECT id, source, status, started_at, country, timezone FROM runs",
      ).all();
      expect(rows.results).toEqual([
        {
          id,
          source: "scheduled",
          status: "queued",
          started_at: new Date(slot).toISOString(),
          country: expectedCountry,
          timezone: expectedTimezone,
        },
      ]);
    } finally {
      clock.mockRestore();
      await platform.env.DB.batch([
        platform.env.DB.prepare("DELETE FROM runs WHERE id = ?").bind(id),
        platform.env.DB.prepare(
          "UPDATE settings SET value = ? WHERE id = 1",
        ).bind(previous!.value),
      ]);
    }
  });
});
