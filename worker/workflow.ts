import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { capture } from "./capture";
import type { MeasurementParams } from "./store";
import type { Result } from "../shared/types";
import {
  createGlobalping,
  collectGlobalping,
  globalpingResult,
  persistGlobalping,
} from "./globalping";
import { countryName } from "../shared/countries";

export class MeasurementWorkflow extends WorkflowEntrypoint<
  Env,
  MeasurementParams
> {
  async run(event: WorkflowEvent<MeasurementParams>, step: WorkflowStep) {
    const { runId, targets, sampleSeconds } = event.payload;
    // Instances launched before configurable countries existed keep the
    // original deployment defaults.
    const country = event.payload.country ?? "TH";
    const globalpingLimit = event.payload.globalpingLimit ?? 30;
    await step.do("mark running", async () => {
      await this.env.DB.prepare(
        "UPDATE runs SET status = 'running' WHERE id = ?",
      )
        .bind(runId)
        .run();
    });
    for (const target of targets) {
      // No automatic re-measurement: every capture represents one actual observation window.
      await step.do(
        `observe ${target.id}`,
        { timeout: "5 minutes", retries: { limit: 0, delay: "10 seconds" } },
        async () => {
          let result: Result;
          try {
            result = await capture(this.env, runId, target, sampleSeconds);
          } catch (error) {
            console.error(
              JSON.stringify({
                event: "capture_failed",
                runId,
                targetId: target.id,
                error: String(error),
              }),
            );
            result = {
              targetId: target.id,
              targetName: target.name,
              hostname: target.hostname,
              sourceUrl: `https://ping.pe/${encodeURIComponent(target.hostname)}`,
              status: "failed",
              capturedAt: new Date().toISOString(),
              probes: [],
              evidence: [],
              error:
                "Browser capture failed. Check Worker logs and Browser Run availability.",
            };
          }
          await this.env.DB.prepare(
            "INSERT OR REPLACE INTO results (run_id, target_id, value) VALUES (?, ?, ?)",
          )
            .bind(runId, target.id, JSON.stringify(result))
            .run();
        },
      );
    }
    // Persist creation separately from polling/storage so retries never re-POST.
    let selection: string | undefined;
    for (const target of targets) {
      const creation = await step.do(
        `globalping create ${target.id}`,
        { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" },
        async () => {
          if (target.id !== targets[0].id && !selection)
            return {
              error: `Globalping skipped because the initial ${countryName(country)} probe selection failed.`,
            };
          try {
            return await createGlobalping(target, selection, {
              country,
              limit: globalpingLimit,
            });
          } catch (error) {
            return { error: String(error) };
          }
        },
      );
      if ("id" in creation && target.id === targets[0].id)
        selection = creation.id;
      const collected = await step.do(
        `globalping collect ${target.id}`,
        { retries: { limit: 0, delay: "1 second" }, timeout: "90 seconds" },
        async () => {
          if (!("id" in creation))
            return {
              result: globalpingResult(
                target,
                undefined,
                creation.error,
                country,
              ),
            };
          try {
            const measurement = await collectGlobalping(
              creation.id,
              globalpingLimit,
            );
            return {
              result: globalpingResult(target, measurement, undefined, country),
              measurement,
            };
          } catch (error) {
            return {
              result: {
                ...globalpingResult(target, undefined, String(error), country),
                measurementId: creation.id,
                sourceUrl: `https://api.globalping.io/v1/measurements/${creation.id}`,
              },
            };
          }
        },
      );
      await step.do(`globalping store ${target.id}`, async () => {
        await persistGlobalping(
          this.env,
          runId,
          collected.result,
          "measurement" in collected ? collected.measurement : undefined,
          { country, limit: globalpingLimit },
        );
      });
    }
    await step.do("finalize run", async () => {
      const rows = await this.env.DB.prepare(
        "SELECT value FROM results WHERE run_id = ?",
      )
        .bind(runId)
        .all<{ value: string }>();
      const results = rows.results.map((r) => JSON.parse(r.value) as Result);
      const status =
        results.length === targets.length * 2 &&
        results.every((r) => r.status === "complete")
          ? "complete"
          : results.some((r) =>
                r.probes.some((p) => p.sent > 0 && p.loss !== null),
              )
            ? "partial"
            : "failed";
      await this.env.DB.prepare(
        "UPDATE runs SET status = ?, completed_at = ? WHERE id = ?",
      )
        .bind(status, new Date().toISOString(), runId)
        .run();
      console.log(JSON.stringify({ event: "run_completed", runId, status }));
    });
    return { runId };
  }
}
