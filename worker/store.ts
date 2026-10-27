import type { Result, Run, Settings, Target } from "../shared/types";
import {
  defaultCadence,
  defaultTimeZone,
  normalizeCadence,
} from "../shared/schedule";
import { normalizeIgnoredNetworks } from "../shared/metrics";
import { timeZoneIsValid } from "../shared/time";

// Settings saved before configurable countries, time zones, probe counts, and
// exclusions existed keep the original deployment's defaults so existing
// behavior never changes silently. Fresh installs pick their own in Configure.
const legacyCountry = "TH";
const legacyIgnoredNetworks = [
  "KeFF Networks (AS41281)",
  "SiS Distribution (Thailand)",
];

export function normalizeCountry(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z]{2}$/.test(value.trim()))
    throw new Error("Choose a supported country.");
  return value.trim().toUpperCase();
}

export function normalizeTimeZone(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    !timeZoneIsValid(value.trim())
  )
    throw new Error("Choose a supported time zone.");
  return value.trim();
}

export function normalizeGlobalpingLimit(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 50)
    throw new Error("Choose between 1 and 50 Globalping probes per target.");
  return Number(value);
}

export const defaultSettings: Settings = {
  targets: [],
  enabled: false,
  sampleSeconds: 45,
  cadence: defaultCadence,
  // Neutral starting points for a new installation; Configure sets real values.
  country: "US",
  timezone: "UTC",
  ignoredNetworks: [],
  globalpingLimit: 30,
};

export async function settings(env: Env): Promise<Settings> {
  const row = await env.DB.prepare(
    "SELECT value FROM settings WHERE id = 1",
  ).first<{ value: string }>();
  if (!row) return defaultSettings;
  const value = JSON.parse(row.value) as Settings;
  return {
    ...value,
    cadence: normalizeCadence(value.cadence),
    country:
      value.country === undefined
        ? legacyCountry
        : normalizeCountry(value.country),
    timezone:
      value.timezone === undefined
        ? defaultTimeZone
        : normalizeTimeZone(value.timezone),
    ignoredNetworks:
      value.ignoredNetworks === undefined
        ? legacyIgnoredNetworks
        : normalizeIgnoredNetworks(value.ignoredNetworks),
    globalpingLimit:
      value.globalpingLimit === undefined
        ? 30
        : normalizeGlobalpingLimit(value.globalpingLimit),
  };
}

type RunRow = {
  id: string;
  started_at: string;
  completed_at: string | null;
  source: Run["source"];
  status: Run["status"];
  targets: string;
  error: string | null;
  country: string | null;
  timezone: string | null;
};
export async function listRuns(env: Env): Promise<Run[]> {
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  // Include every test in the longest comparison window, plus the latest 60
  // observations so infrequently used dashboards still have inspectable history.
  const selection =
    "SELECT id FROM runs WHERE started_at >= ? OR id IN (SELECT id FROM runs ORDER BY started_at DESC LIMIT 60)";
  const rows = await env.DB.prepare(
    `SELECT * FROM runs WHERE id IN (${selection}) ORDER BY started_at DESC`,
  )
    .bind(cutoff)
    .all<RunRow>();
  const results = await env.DB.prepare(
    `SELECT r.run_id, r.value FROM results r JOIN (${selection}) recent ON r.run_id = recent.id`,
  )
    .bind(cutoff)
    .all<{ run_id: string; value: string }>();
  const byRun = new Map<string, Result[]>();
  for (const row of results.results) {
    const values = byRun.get(row.run_id) ?? [];
    values.push(JSON.parse(row.value) as Result);
    byRun.set(row.run_id, values);
  }
  return rows.results.map((row) => ({
    id: row.id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    source: row.source,
    status: row.status,
    targets: JSON.parse(row.targets),
    country: row.country ?? undefined,
    timezone: row.timezone ?? undefined,
    error: row.error ?? undefined,
    results: (byRun.get(row.id) ?? []).filter((r) => r.source !== "globalping"),
    globalpingResults: (byRun.get(row.id) ?? []).filter(
      (r) => r.source === "globalping",
    ),
  }));
}

export async function reconcileActive(env: Env) {
  const row = await env.DB.prepare(
    "SELECT id, started_at FROM runs WHERE status IN ('queued', 'running')",
  ).first<{ id: string; started_at: string }>();
  if (!row || Date.now() - Date.parse(row.started_at) < 60_000) return;
  let reason: string | undefined;
  try {
    const instance = await env.MEASUREMENT.get(row.id);
    const status = await instance.status();
    if (["errored", "terminated", "complete"].includes(status.status))
      reason = `Workflow ended before finalizing the run (${status.status}).`;
  } catch {
    if (Date.now() - Date.parse(row.started_at) > 20 * 60_000)
      reason = "Workflow could not be found after 20 minutes.";
  }
  if (reason)
    await env.DB.prepare(
      "UPDATE runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ? AND status IN ('queued', 'running')",
    )
      .bind(reason, new Date().toISOString(), row.id)
      .run();
}

export async function clearHistory(env: Env) {
  await reconcileActive(env);
  // Snapshot terminal run IDs in the same transaction as the active-run check.
  // A new observation launched afterward is fresh data and is never deleted.
  const [active, history] = await env.DB.batch<{ id: string }>([
    env.DB.prepare(
      "SELECT id FROM runs WHERE status IN ('queued', 'running') LIMIT 1",
    ),
    env.DB.prepare(
      "SELECT id FROM runs WHERE status NOT IN ('queued', 'running')",
    ),
  ]);
  if (active.results.length)
    return { cleared: false, deletedRuns: 0, deletedFiles: 0 };

  let deletedRuns = 0;
  let deletedFiles = 0;
  for (const { id } of history.results) {
    // Prefix-scoped deletion also removes captures that were stored before a
    // failed result write. Never wipe the bucket: newer runs may already exist.
    while (true) {
      const objects = await env.EVIDENCE.list({
        prefix: `${id}/`,
        limit: 1000,
      });
      if (!objects.objects.length) break;
      await env.EVIDENCE.delete(objects.objects.map((object) => object.key));
      deletedFiles += objects.objects.length;
    }
    // Remove the ledger only after its evidence is gone, so an interrupted
    // request can safely resume by pressing Clear history again.
    const [, removed] = await env.DB.batch([
      env.DB.prepare("DELETE FROM results WHERE run_id = ?").bind(id),
      env.DB.prepare(
        "DELETE FROM runs WHERE id = ? AND status NOT IN ('queued', 'running')",
      ).bind(id),
    ]);
    deletedRuns += removed.meta.changes;
  }
  console.log(
    JSON.stringify({ event: "history_cleared", deletedRuns, deletedFiles }),
  );
  return { cleared: true, deletedRuns, deletedFiles };
}

export async function startRun(
  env: Env,
  source: Run["source"],
  id: string = crypto.randomUUID(),
  scheduledAt?: number,
) {
  const config = await settings(env);
  if (config.targets.length !== 3)
    throw new Error("Configure three targets before starting a run.");
  const country = config.country ?? legacyCountry;
  const timezone = config.timezone ?? defaultTimeZone;
  const globalpingLimit = config.globalpingLimit ?? 30;
  await reconcileActive(env);
  // INSERT OR IGNORE handles duplicate cron deliveries and concurrent launches atomically.
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO runs (id, started_at, source, status, targets, country, timezone) VALUES (?, ?, ?, 'queued', ?, ?, ?)",
  )
    .bind(
      id,
      new Date(scheduledAt ?? Date.now()).toISOString(),
      source,
      JSON.stringify(config.targets),
      country,
      timezone,
    )
    .run();
  if (!inserted.meta.changes) return { id, started: false };
  try {
    await env.MEASUREMENT.create({
      id,
      params: {
        runId: id,
        targets: config.targets,
        sampleSeconds: config.sampleSeconds,
        country,
        globalpingLimit,
      },
    });
    return { id, started: true };
  } catch (error) {
    await env.DB.prepare(
      "UPDATE runs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?",
    )
      .bind(
        new Date().toISOString(),
        "Unable to launch measurement workflow.",
        id,
      )
      .run();
    throw error;
  }
}

export type MeasurementParams = {
  runId: string;
  targets: Target[];
  sampleSeconds: number;
  // Captured at launch; instances created before these fields existed fall
  // back to the original deployment defaults inside the workflow.
  country?: string;
  globalpingLimit?: number;
};
