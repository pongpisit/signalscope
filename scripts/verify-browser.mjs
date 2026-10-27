// End-to-end production verification using only explicitly named public test targets.
// Uses Wrangler's existing account authentication; no dashboard password is needed.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const resumeId = process.argv[2];
if (resumeId && !/^verification-\d+$/.test(resumeId))
  throw new Error("Only verification run IDs can be resumed.");
const runId = resumeId ?? `verification-${Date.now()}`;
const targets = ["example.com", "cloudflare.com", "google.com"].map(
  (hostname, i) => ({
    id: `target-${i + 1}`,
    name: `Verification: ${hostname}`,
    url: `https://${hostname}`,
    hostname,
  }),
);
const cli = async (...args) =>
  (
    await exec(
      process.execPath,
      ["node_modules/wrangler/bin/wrangler.js", ...args],
      { maxBuffer: 20 * 1024 * 1024 },
    )
  ).stdout;
const sql = async (command) =>
  JSON.parse(
    await cli(
      "d1",
      "execute",
      "pingpe-observatory",
      "--remote",
      "--command",
      command,
      "--json",
    ),
  )[0].results;
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
await mkdir("test-results", { recursive: true });
if (!resumeId)
  await sql(
    `INSERT INTO runs (id,started_at,source,status,targets) VALUES (${literal(runId)},${literal(new Date().toISOString())},'manual','queued',${literal(JSON.stringify(targets))})`,
  );
console.log(`Verifying hosted Browser Run: ${runId}`);
if (!resumeId)
  await cli(
    "workflows",
    "trigger",
    "pingpe-observatory-measurement",
    JSON.stringify({ runId, targets, sampleSeconds: 20 }),
    "--id",
    runId,
    "--json",
  );
let status = "queued";
for (let i = 0; i < 70; i++) {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  const rows = await sql(`SELECT status FROM runs WHERE id=${literal(runId)}`);
  status = rows[0]?.status;
  console.log(`  ${status}`);
  if (!["queued", "running"].includes(status)) break;
}
const rows = await sql(
  `SELECT value FROM results WHERE run_id=${literal(runId)}`,
);
const results = rows.map((row) => JSON.parse(row.value));
await writeFile(
  "test-results/deployment-verification.json",
  JSON.stringify({ runId, status, results }, null, 2),
);
assert.equal(
  results.length,
  6,
  "All three targets must produce Ping.pe and Globalping result records",
);
for (const result of results) {
  assert.ok(
    result.probes.some((probe) => probe.sent > 0 && probe.loss !== null),
    `${result.hostname}: no real samples; ${result.error ?? ""}`,
  );
  assert.equal(
    result.evidence.length,
    result.source === "globalping" ? 1 : 3,
    `${result.hostname}: source-appropriate evidence must be stored`,
  );
  for (const file of result.evidence) {
    const { stdout } = await exec(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        "r2",
        "object",
        "get",
        `pingpe-observatory-evidence/${file.key}`,
        "--remote",
        "--pipe",
      ],
      { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
    );
    const hash = createHash("sha256").update(stdout).digest("hex");
    assert.equal(hash, file.sha256, `${file.kind}: stored evidence checksum`);
    if (file.kind === "png")
      assert.equal(stdout.subarray(1, 4).toString(), "PNG");
    if (file.kind === "pdf")
      assert.equal(stdout.subarray(0, 5).toString(), "%PDF-");
    if (file.kind === "json")
      assert.equal(JSON.parse(stdout.toString()).hostname, result.hostname);
    await writeFile(
      `test-results/production-${result.source ?? "pingpe"}-${result.targetId}.${file.kind}`,
      stdout,
    );
  }
  console.log(
    `  Verified ${result.source ?? "pingpe"} ${result.hostname}: ${result.probes.length} probes, all evidence SHA-256 checks passed`,
  );
}
// Remove only this script's known verification records. Customer configuration is untouched.
await sql(
  `DELETE FROM results WHERE run_id=${literal(runId)}; DELETE FROM runs WHERE id=${literal(runId)};`,
);
for (const result of results)
  for (const file of result.evidence) {
    await cli(
      "r2",
      "object",
      "delete",
      `pingpe-observatory-evidence/${file.key}`,
      "--remote",
    );
  }
console.log(
  "Hosted verification passed. Local evidence is in test-results/. Verification records removed from the dashboard.",
);
