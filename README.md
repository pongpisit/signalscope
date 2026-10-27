# SignalScope — Network Observability

**Every signal. In sight.**

SignalScope is a network observability dashboard on Cloudflare Workers, combining Ping.pe and Globalping measurements for three-host comparisons on schedules **you** configure: pick a **probe country**, an **IANA time zone**, an observation frequency, and how many probes to run. Compare multi-location latency, loss, resolved destination IPs, and original measurement evidence.

**Live demo:** https://signalscope.pongpisit.workers.dev  
**Country dashboard:** https://signalscope.pongpisit.workers.dev/#country

## Quickstart

You need a Cloudflare account (the free tier works). From a clone of this repository:

```sh
npm ci

# Create your own resources, then note the printed database ID.
npx wrangler d1 create pingpe-observatory
npx wrangler r2 bucket create pingpe-observatory-evidence

# Put your account ID and the new database ID into wrangler.jsonc, then:
npm run db:remote          # apply migrations to your D1
npx wrangler secret put DASHBOARD_TOKEN   # any non-empty dashboard password
npm run deploy
```

Open your `*.workers.dev` URL, sign in with that password, choose **Configure**, and set three targets, your probe country, time zone, and schedule. `DASHBOARD_TOKEN` is the dashboard login password, not a Cloudflare API token; it is stored as a Worker secret and never belongs in source code.

Scheduled runs are entirely cloud-hosted. The laptop and dashboard can be closed. Choose twice daily (08:00 and 17:00 in your zone), hourly, or every 2, 3, 4, 6, 12, or 24 hours. Interval schedules align to 00:00 in the configured time zone; for example every 2 hours runs at 00:00, 02:00, …, 22:00, and every 24 hours runs at 00:00. The frequency control shows scheduled times and estimated daily Globalping usage. The dashboard cadence strip shows the saved frequency, time zone, and next run.

A once-per-minute Cron Trigger checks the persisted enabled flag and the saved country-aware schedule before dispatching a Workflow. It recovers a due observation throughout its scheduled hour if the first timer tick is missed or delayed. Every tick in that hour uses the same deterministic run ID, so it creates at most one observation. A still-active observation blocks overlapping launches; later ticks can retry within the due hour. It does not replay older hours. Saving a new frequency, country, time zone, or targets, or resuming the schedule, starts at the next future slot, rather than launching immediately. Changes to Cloudflare's cron registration itself can take up to 15 minutes to propagate; frequency changes in settings need no trigger update. The heartbeat performs no probe tests unless a new observation is due.

Time zones handle DST and 30/45-minute offsets (for example Kathmandu): ticks map to the UTC hour containing the local slot, so a slot can start up to an hour after its wall-clock time in odd-offset zones. A DST fall-back hour can produce one additional distinct slot when the local hour repeats.

No Ping.pe API token or browser token is required: the Worker uses its native Cloudflare Browser Run binding. Deployment and resource administration use Wrangler's account authentication.

## Configuration

All of it lives in the **Configure** dialog and is persisted in D1:

- **Probe country** (ISO 3166-1 alpha-2): Globalping runs probes located in this country, and the country dashboard filters Ping.pe results to it. Ping.pe captures remain global; the country setting drives the focused view and the Globalping probe location.
- **Time zone** (IANA name): schedule alignment and all displayed times.
- **Globalping probes per target** (1–50, default 30): each observation requests up to this many in-country probes per target.
- **Ignored networks**: provider names or ASNs (for example `KeFF Networks (AS41281)` or `41281`), one per line. Hidden from cards, counts, trends, tables, and CSV exports for both sources and all runs. Stored results and evidence keep every collected probe, and probe selection is unaffected.
- **Observation window** (20–90 seconds per target) and **frequency**, as above.

Each run row snapshots the country and time zone it launched with, so changing the configuration later never repaints earlier observations. Settings saved before a field existed keep that deployment's previous values; older clients omitting a field preserve the saved one.

## What is measured

- Ping.pe's live **ICMP hostname/IP test** from its available probes.
- Per-probe average/best/worst latency, packet loss, jitter, and sent count.
- URL paths, HTTP response time, page-load time, and HTTP ports are **not** measured.
- The three targets are observed **sequentially**, each with its own capture timestamp. This is not a simultaneous packet-by-packet benchmark.
- The browser waits for Ping.pe's probe table, observes for the configured window, reads its public DOM data attributes, and freezes that same page for evidence.
- Ping.pe is continuous, so the capture is a bounded observation rather than a claim that the service has "finished."
- Pending probes retain `null` metrics. A missing sample is never treated as zero latency or zero loss.
- Comparison averages use the same reporting probe IDs, locations, and providers across all three targets within each run. Latency averages exclude probes with no RTT; inspect loss alongside latency.
- Cards and location tables default to the selected rolling **7D / 30D** average. Cards give each eligible test equal weight; each location row averages the tests available for that probe/location. Only tests with all three matching target hostnames and shared reporting samples in the selected region contribute. Missing metrics remain unavailable, and 100% loss remains a valid sample.
- Globalping average rows group by country, city and network, never by selection-relative indices across runs. Multiple probes in the same group are averaged within each test before tests are averaged. The UI distinguishes these groups from individual probes. Ping.pe keeps probe ID, location and provider identity across tests.
- Use the observation selector on either dashboard (or click a trend point/history row) to inspect an individual run. Selecting **7D / 30D** returns to the average view. CSV labels average versus individual mode, the window and test counts, and preserves all observed destination IPs with their original scopes. Evidence always refers to individual original captures.
- History is matched by hostname so a changed target does not inherit an earlier hostname's trend.
- Probe tables show **50 rows per page**, with **Previous / Next** controls, the visible row range, and current page number. Search, region, dataset, observation, time-window, and sorting changes return to page 1; background refreshes preserve the current page when it remains valid. CSV exports include all filtered rows across every page.
- Click a target's table header to sort probes by its **AVG MS** numerically, ascending first; click again for descending. Missing readings stay last in either direction. Sorting applies across all pages and CSV exports follow the same order, for both measurement sources.
- Each target cell shows the recorded destination IP. **Globalping:** `resolvedAddress` from that probe's API result, so answers may differ by location. **Ping.pe:** `data-target-host-resolved` from `#snapshot-metadata`, explicitly labelled **Page target IP** because it is not an independent DNS answer per probe. CSV includes `resolved_ip` and `resolved_ip_scope` (`probe`, `page`, or `unavailable`). New observations store these fields; older records without them show unavailable. No fresh DNS lookup is used to reconstruct historical results.
- Globalping prefers structured `resolvedAddress` and falls back to the destination in the first `PING hostname (IP)` output line when necessary. Historical Globalping records can recover IPs from their original R2 JSON evidence: `node scripts/backfill-resolved-ips.mjs` previews changes; add `--apply` to update remote D1. Recovery verifies file checksums and measurement/probe identity, preserves original evidence, and performs no new measurements or DNS lookups.
- A regional filter is a convenience grouping based on Ping.pe probe IDs, with your configured country as one of the options. The Three.js globe is explicitly illustrative, not live geolocation.
- **Country dashboard:** select the map-pin navigation button or bookmark `/#country`. Cards, latency/loss/jitter trends, probe rows, and CSV exports use only probes located in the configured country, for both sources. The view includes a run selector and displays all three summary metrics together. It reuses the scheduled observations and full original Ping.pe evidence; no additional capture or separate schedule is needed. Missing samples are shown as unavailable, never replaced by global averages.

## Architecture

### Globalping country measurements

Each new manual or scheduled observation also runs Globalping ICMP ping tests after the Ping.pe captures. The first target requests `locations: [{ country: <configured> }]` with your configured probe limit; the other targets reuse its measurement ID to keep the same probe selection (including offline entries). If the first selection fails, subsequent Globalping targets are marked failed without selecting a different set. Fewer probes than requested may be available; the whole-country sample does not guarantee city/network quotas.

The **Measurement dataset** panel provides large, keyboard-accessible Ping.pe and Globalping choices, with blue/mint selected states and an explicit **Viewing … dataset** indicator. Source labels repeat in chart and location-table headings. Switching changes cards, trends, probe rows, CSV, and the evidence library between Ping.pe and Globalping. Old runs have no Globalping data. Sources are never pooled into one comparison. Globalping probe IDs are selection-relative indices; they do not identify permanent probes across runs. Comparisons also match city and network. Globalping ping reports RTT and packet loss, but not jitter, so jitter remains unavailable.

Each Globalping test sends 10 packets per probe. Unauthenticated usage allows 50 probes per measurement and 250 probe-tests/hour: this integration requests at most `3 × probes-per-target` tests per run (90 by default) and 180/day on the default twice-daily schedule (up to 2,160/day when hourly). Repeated manual runs can hit hourly limits. Rate limits are recorded in the target result; measurement creation is not automatically retried. Polling uses ETags and a one-second delay after responses, with a 60-second finalization deadline.

Raw API results and normalized data are stored in checksummed JSON under `<run>/globalping/<target>/evidence.json`, including the requested country and limit. These are API evidence, without screenshots or PDFs. D1 uses source-prefixed result keys, preserving existing Ping.pe records without a database migration. Clear history removes both sources. A run is complete only when both sources complete for every target; otherwise usable samples make it partial, or it fails if none are usable.

Sources: [Globalping API specification](https://raw.githubusercontent.com/jsdelivr/globalping/master/public/v1/spec.yaml),
[request/result schemas](https://raw.githubusercontent.com/jsdelivr/globalping/master/public/v1/components/schemas.yaml),
[credits](https://globalping.io/credits).

```text
React + Recharts + Three.js ── Worker API ── D1 settings and run ledger
                                     │
Minute heartbeat ── saved cadence + time zone + unique hour slot ── Measurement Workflow
                                     │
                              Browser Run / Puppeteer
                                     │
                            Ping.pe target A → B → C
                                     │
                          R2: PNG + PDF + JSON manifest
```

| Resource            | Name                              |
| ------------------- | --------------------------------- |
| Worker              | `signalscope`                     |
| Workflow            | `pingpe-observatory-measurement`  |
| D1                  | `pingpe-observatory`              |
| R2                  | `pingpe-observatory-evidence`     |
| Browser binding     | `BROWSER`                         |
| UTC cron expression | `* * * * *` (schedule check only) |

The `wrangler.jsonc` in this repository contains the maintainer's resource identifiers as a working example. Forks should replace the `account_id` and D1 `database_id` with their own (see Quickstart); they are identifiers, not credentials, and no secrets are committed.

Each target stores a full-page PNG, a screen-styled PDF, and a JSON manifest containing the original source URL, capture timestamp, observation duration, extracted probe rows, and PNG/PDF SHA-256 hashes. The manifest's own hash is stored in R2 metadata and the D1 result. Hashes detect file changes; they are not independent attestation by Ping.pe.

Evidence is streamed from private R2 through authenticated endpoints. Login uses signed, HttpOnly, SameSite=Strict cookies, secure cookies in production, same-origin mutation checks, and a database-backed login-attempt limit. Rotating `DASHBOARD_TOKEN` invalidates existing sessions.

A D1 unique index allows one queued/running observation at a time. Scheduled run IDs are deterministic to avoid duplicate cron delivery. Workflow steps durably store each target result. Capture steps are not automatically retried to avoid silently generating a different observation as though it were the original; the only retry is browser startup, which measures nothing. Run history reconciles interrupted workflows so a terminal failure does not permanently block later observations.

The dashboard loads every run in the last 30 days, plus the latest 60 runs for individual history inspection when observations are infrequent. Extra manual tests do not truncate the average window. Older D1 records and R2 evidence remain stored; no automatic evidence deletion is configured.

## Local development

Use a Node.js version supported by the pinned Wrangler release. Node 26 was used for validation.

```sh
npm ci
npm run types
npm run db:local
```

Create a local `.dev.vars` from `.dev.vars.example` and replace the example password with your own randomly generated value. `.dev.vars` is ignored and is not uploaded by deployment.

In two terminals:

```sh
# Terminal 1: Worker API, local D1/R2, assets from the last build
npm run build
npm run dev:worker

# Terminal 2: frontend with hot reload; /api proxies to :8787
npm run dev
```

Open http://127.0.0.1:5173. The interactive demo is available without a password and is clearly labelled as synthetic. Demo mode makes no Ping.pe requests and does not fabricate downloadable evidence.

For local captures using the cloud browser, use the documented remote browser binding configuration and account authentication. Keep D1 and R2 local unless you deliberately want to use production storage. Local development does not automatically execute cron triggers.

## Validate and deploy changes

```sh
npm run check
npm test
npm run test:browser
npm run build
npx wrangler deploy --dry-run

# Apply new migrations when there are any; this is the remote database.
npm run db:remote
npm run deploy
```

`npm test` builds the dashboard first (pretest): its local API suite serves the
assets directory declared in `wrangler.jsonc`, which is generated by the build
and not committed.

Browser tests use an installed Google Chrome (`channel: "chrome"`). Desktop and mobile screenshots are saved under `test-results/`.

### Hosted capture verification

```sh
npm run verify:hosted
```

This **creates a real, billable production observation** using the public test domains `example.com`, `cloudflare.com`, and `google.com`. Run it while the measurement queue is idle. It triggers the deployed Workflow through Wrangler, verifies all three stored evidence files per target and their checksums, saves local copies to `test-results/`, then deletes only its own test records and remote evidence. It does not change saved targets, the enabled setting, or the dashboard password.

If the terminal is interrupted, resume the same verification without repeating measurements:

```sh
node scripts/verify-browser.mjs verification-<timestamp-from-output>
```

## Operations

- **Pause measurements:** Configure → turn off Scheduled observations → Save.
- **Change targets:** Configure → edit targets → Save. Existing run snapshots retain their original target names and hostnames.
- **Change country, time zone, probe count, or ignored networks:** Configure → adjust → Save. The country dashboard and Globalping runs follow the new configuration immediately; history keeps the country each run was captured with.
- **Start with an empty history:** choose **Clear history** beside Configure, then confirm. This removes all historical runs (including those older than the 60-run display window) and their PNG/PDF/JSON evidence from both views. Targets, schedule, and password are kept. Wait for an active observation to finish first; then choose **Run observation** to collect fresh data. Demo mode clears only its synthetic in-browser history.
- **Inspect an issue:** History → select the run; Evidence library → select the same run and inspect the original capture. Blocked pages, provider limits, and changed Ping.pe markup are recorded as failures/partial captures, not successful network measurements.
- **Logs:** `npx wrangler tail`. Structured events include `capture_failed`, `run_completed`, `schedule_skipped`, and `api_error`.
- **90-second captures:** Browser Run sessions use an idle timeout longer than the configured observation window, then close explicitly after evidence capture. This prevents the default 60-second browser idle timeout from interrupting longer observations.
- **Change the dashboard password:** `npx wrangler secret put DASHBOARD_TOKEN`.

## References

- [Cloudflare Browser Run Worker guide](https://developers.cloudflare.com/browser-run/how-to/deploy-worker/)
- [Puppeteer with Browser Run](https://developers.cloudflare.com/browser-run/puppeteer/)
- [Browser Run limits and session lifecycle](https://developers.cloudflare.com/browser-run/limits/)
- [Workers Cron Triggers use UTC](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Workflows API](https://developers.cloudflare.com/workflows/build/workers-api/)
- [Workers static assets](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Ping.pe live page and supported commands](https://ping.pe/)

## License

[MIT](LICENSE)
