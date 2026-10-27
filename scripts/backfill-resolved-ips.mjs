// Recover historical Globalping destination IPs from original, checksummed R2
// evidence. Defaults to read-only; --apply updates D1, never original evidence.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { recoverAddresses } from "../shared/recover-addresses.ts";
import { ipAddress } from "../shared/addresses.ts";

if (process.argv.slice(2).some((arg) => arg !== "--apply"))
  throw new Error("Usage: node scripts/backfill-resolved-ips.mjs [--apply]");
const apply = process.argv.includes("--apply");
const exec = promisify(execFile);
const cli = async (...args) =>
  (
    await exec(
      process.execPath,
      ["node_modules/wrangler/bin/wrangler.js", ...args],
      { maxBuffer: 20 * 1024 * 1024 },
    )
  ).stdout;
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
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
  )[0];
const rows = (
  await sql(
    "SELECT results.run_id, results.target_id, results.value FROM results JOIN runs ON runs.id = results.run_id WHERE json_extract(results.value, '$.source') = 'globalping' AND runs.status NOT IN ('queued', 'running')",
  )
).results;
let records = 0;
let recovered = 0;
for (const row of rows) {
  const stored = JSON.parse(row.value);
  if (!stored.probes.some((probe) => !ipAddress(probe.resolvedAddress)))
    continue;
  const file = stored.evidence.find((file) => file.kind === "json");
  if (!file) continue;
  const expectedKey = `${row.run_id}/globalping/${stored.targetId}/evidence.json`;
  if (
    file.key !== expectedKey ||
    row.target_id !== `globalping-${stored.targetId}`
  )
    throw new Error("Unexpected evidence key.");
  const content = await cli(
    "r2",
    "object",
    "get",
    `pingpe-observatory-evidence/${file.key}`,
    "--remote",
    "--pipe",
  );
  if (createHash("sha256").update(content).digest("hex") !== file.sha256)
    throw new Error(`Evidence checksum mismatch: ${file.key}`);
  const updated = recoverAddresses(stored, JSON.parse(content));
  const count = updated.probes.filter(
    (probe, index) =>
      probe.resolvedAddress && !ipAddress(stored.probes[index].resolvedAddress),
  ).length;
  if (!count) continue;
  if (apply) {
    const write = await sql(
      `UPDATE results SET value = ${literal(JSON.stringify(updated))} WHERE run_id = ${literal(row.run_id)} AND target_id = ${literal(row.target_id)} AND value = ${literal(row.value)}`,
    );
    if (write.meta.changes !== 1)
      throw new Error("Result changed concurrently; rerun recovery.");
  }
  records++;
  recovered += count;
  console.log(
    `${apply ? "Recovered" : "Would recover"} ${count} destination IPs for ${row.run_id}/${stored.targetId}.`,
  );
}
console.log(
  JSON.stringify({ applied: apply, records, recoveredAddresses: recovered }),
);
