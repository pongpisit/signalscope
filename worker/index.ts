import {
  authenticated,
  clearCookie,
  sessionCookie,
  verifyPassword,
} from "./auth";
import {
  clearHistory,
  defaultSettings,
  listRuns,
  normalizeCountry,
  normalizeGlobalpingLimit,
  normalizeTimeZone,
  reconcileActive,
  settings,
  startRun,
} from "./store";
import { normalizeIgnoredNetworks, normalizeTarget } from "../shared/metrics";
import {
  nextScheduled,
  normalizeCadence,
  scheduleTimes,
} from "../shared/schedule";
import { dispatchScheduled } from "./scheduler";
import { BodyTooLarge, readJson } from "./body";
export { MeasurementWorkflow } from "./workflow";

const json = (
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const secure = url.protocol === "https:";
  if (request.method !== "GET" && request.headers.get("Origin") !== url.origin)
    return json({ error: "Request must come from this dashboard." }, 403);
  if (path === "/api/session" && request.method === "GET") {
    return json({
      configured: Boolean(env.DASHBOARD_TOKEN),
      authenticated: env.DASHBOARD_TOKEN
        ? await authenticated(request, env.DASHBOARD_TOKEN)
        : false,
    });
  }
  if (!env.DASHBOARD_TOKEN)
    return json(
      {
        error:
          "Set the DASHBOARD_TOKEN Worker secret to connect this dashboard.",
      },
      503,
    );
  if (path === "/api/login" && request.method === "POST") {
    if (Number(request.headers.get("Content-Length") ?? 0) > 4096)
      return json({ error: "Request too large." }, 413);
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    const now = Date.now();
    const attempt = await env.DB.prepare(
      "INSERT INTO login_attempts (ip, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(ip) DO UPDATE SET count = CASE WHEN expires_at < ? THEN 1 ELSE count + 1 END, expires_at = CASE WHEN expires_at < ? THEN ? ELSE expires_at END RETURNING count",
    )
      .bind(ip, now + 15 * 60_000, now, now, now + 15 * 60_000)
      .first<{ count: number }>();
    if (attempt && attempt.count > 10)
      return json(
        { error: "Too many sign-in attempts. Try again in 15 minutes." },
        429,
      );
    // The Content-Length check above is a fast path only: chunked requests
    // omit the header, so the cap is enforced again on the bytes read.
    let body: { token?: string };
    try {
      body = await readJson<{ token?: string }>(request, 4096);
    } catch (error) {
      if (error instanceof BodyTooLarge)
        return json({ error: "Request too large." }, 413);
      throw error;
    }
    if (
      typeof body.token !== "string" ||
      body.token.length > 1024 ||
      !(await verifyPassword(body.token, env.DASHBOARD_TOKEN))
    )
      return json({ error: "The dashboard password is incorrect." }, 401);
    await env.DB.prepare(
      "DELETE FROM login_attempts WHERE ip = ? OR expires_at < ?",
    )
      .bind(ip, now)
      .run();
    return json({ ok: true }, 200, {
      "Set-Cookie": await sessionCookie(env.DASHBOARD_TOKEN, secure),
    });
  }
  if (path === "/api/logout" && request.method === "POST")
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie(secure) });
  if (!(await authenticated(request, env.DASHBOARD_TOKEN)))
    return json({ error: "Sign in to view measurements and evidence." }, 401);
  if (path === "/api/dashboard" && request.method === "GET") {
    await reconcileActive(env);
    const config = await settings(env);
    return json({
      settings: config,
      runs: await listRuns(env),
      timezone: config.timezone ?? defaultSettings.timezone,
      schedule: scheduleTimes(config.cadence),
    });
  }
  if (path === "/api/settings" && request.method === "PUT") {
    if (Number(request.headers.get("Content-Length") ?? 0) > 10_000)
      return json({ error: "Request too large." }, 413);
    // The Content-Length check above is a fast path only: chunked requests
    // omit the header, so the cap is enforced again on the bytes read.
    let body: {
      targets?: { name?: unknown; url?: unknown }[];
      enabled?: unknown;
      sampleSeconds?: unknown;
      cadence?: unknown;
      country?: unknown;
      timezone?: unknown;
      ignoredNetworks?: unknown;
      globalpingLimit?: unknown;
    };
    try {
      body = await readJson<typeof body>(request, 10_000);
    } catch (error) {
      if (error instanceof BodyTooLarge)
        return json({ error: "Request too large." }, 413);
      throw error;
    }
    if (
      !Array.isArray(body.targets) ||
      body.targets.length !== 3 ||
      body.targets.some((t) => !t || typeof t !== "object")
    )
      return json({ error: "Configure exactly three targets." }, 400);
    let targets;
    try {
      targets = body.targets.map(normalizeTarget);
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
    if (new Set(targets.map((t) => t.hostname)).size !== 3)
      return json(
        {
          error:
            "Choose three different hostnames. Ping.pe does not compare URL paths.",
        },
        400,
      );
    if (
      typeof body.enabled !== "boolean" ||
      !Number.isInteger(body.sampleSeconds) ||
      Number(body.sampleSeconds) < 20 ||
      Number(body.sampleSeconds) > 90
    )
      return json(
        { error: "Choose an observation window between 20 and 90 seconds." },
        400,
      );
    const previous = await settings(env);
    let cadence;
    try {
      cadence = normalizeCadence(
        body.cadence === undefined ? previous.cadence : body.cadence,
      );
    } catch (error) {
      return json({ error: (error as Error).message }, 400);
    }
    // Older clients omitting the newer fields preserve the saved values.
    let country;
    let timezone;
    let ignoredNetworks;
    let globalpingLimit;
    try {
      country = normalizeCountry(
        body.country === undefined
          ? (previous.country ?? defaultSettings.country)
          : body.country,
      );
      timezone = normalizeTimeZone(
        body.timezone === undefined
          ? (previous.timezone ?? defaultSettings.timezone)
          : body.timezone,
      );
      ignoredNetworks = normalizeIgnoredNetworks(
        body.ignoredNetworks === undefined
          ? (previous.ignoredNetworks ?? [])
          : body.ignoredNetworks,
      );
      globalpingLimit = normalizeGlobalpingLimit(
        body.globalpingLimit === undefined
          ? (previous.globalpingLimit ?? defaultSettings.globalpingLimit)
          : body.globalpingLimit,
      );
    } catch (error) {
      return json({ error: (error as Error).message }, 400);
    }
    const value = {
      targets,
      enabled: body.enabled,
      sampleSeconds: Number(body.sampleSeconds),
      cadence,
      country,
      timezone,
      ignoredNetworks,
      globalpingLimit,
      scheduleNotBefore:
        !previous.enabled ||
        previous.cadence !== cadence ||
        previous.timezone !== timezone ||
        JSON.stringify(previous.targets) !== JSON.stringify(targets)
          ? nextScheduled(new Date(), cadence, timezone).toISOString()
          : previous.scheduleNotBefore,
    };
    await env.DB.prepare(
      "INSERT INTO settings (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
    )
      .bind(JSON.stringify(value))
      .run();
    return json(value);
  }
  if (path === "/api/runs" && request.method === "POST") {
    if ((await settings(env)).targets.length !== 3)
      return json({ error: "Configure three targets first." }, 400);
    const run = await startRun(env, "manual");
    return run.started
      ? json(run, 202)
      : json(
          { error: "A measurement is already running. Wait for it to finish." },
          409,
        );
  }
  if (path === "/api/history" && request.method === "DELETE") {
    const result = await clearHistory(env);
    if (!result.cleared)
      return json(
        {
          error:
            "An observation is running. Wait for it to finish before clearing history.",
        },
        409,
      );
    return json(result);
  }
  const evidence = path.match(
    /^\/api\/evidence\/([\w-]+)\/(target-[123])\/(png|pdf|json)$/,
  );
  if (evidence && request.method === "GET") {
    const [, runId, targetId, kind] = evidence;
    const source = url.searchParams.get("source");
    if (source && !["pingpe", "globalping"].includes(source))
      return json({ error: "Unknown evidence source." }, 400);
    const object = await env.EVIDENCE.get(
      `${runId}/${source === "globalping" ? "globalping/" : ""}${targetId}/evidence.${kind}`,
    );
    if (!object)
      return json({ error: "This evidence file is not available." }, 404);
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${url.searchParams.has("download") ? "attachment" : "inline"}; filename="${source === "globalping" ? "globalping-" : ""}${runId}-${targetId}.${kind}"`,
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
    });
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    if (object.customMetadata?.sha256)
      headers.set("X-Evidence-SHA256", object.customMetadata.sha256);
    return new Response(object.body, { headers });
  }
  return json({ error: "Endpoint not found." }, 404);
}

export default {
  async fetch(request, env) {
    if (!new URL(request.url).pathname.startsWith("/api/"))
      return env.ASSETS.fetch(request);
    try {
      return await api(request, env);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "api_error",
          path: new URL(request.url).pathname,
          error: String(error),
        }),
      );
      if (error instanceof SyntaxError)
        return json({ error: "The request body must be valid JSON." }, 400);
      return json(
        {
          error:
            "The request could not be completed. Check the Worker logs and database migrations.",
        },
        500,
      );
    }
  },
  scheduled: dispatchScheduled,
} satisfies ExportedHandler<Env>;
