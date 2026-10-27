import { scheduledSlot } from "../shared/schedule";
import { settings, startRun } from "./store";

export async function dispatchScheduled(
  controller: Pick<ScheduledController, "scheduledTime"> &
    Partial<Pick<ScheduledController, "cron">>,
  env: Env,
) {
  const config = await settings(env);
  const timing = {
    scheduledTime: controller.scheduledTime,
    cron: controller.cron,
    checkedAt: new Date().toISOString(),
  };
  if (!config.enabled || config.targets.length !== 3) {
    console.log(
      JSON.stringify({
        event: "schedule_skipped",
        reason: "paused_or_unconfigured",
        ...timing,
      }),
    );
    return;
  }
  const slot = scheduledSlot(
    controller.scheduledTime,
    config.cadence,
    config.timezone,
  );
  if (
    slot === null ||
    (config.scheduleNotBefore && slot < Date.parse(config.scheduleNotBefore))
  ) {
    console.log(
      JSON.stringify({
        event: "schedule_skipped",
        reason: "not_due",
        cadence: config.cadence,
        ...timing,
      }),
    );
    return;
  }
  // Keep the same ID for duplicate deliveries and overlapping legacy triggers.
  const run = await startRun(env, "scheduled", `scheduled-${slot}`, slot);
  console.log(
    JSON.stringify({
      event: "schedule_dispatched",
      cadence: config.cadence,
      slot: new Date(slot).toISOString(),
      ...timing,
      ...run,
    }),
  );
}
