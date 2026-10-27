import puppeteer from "@cloudflare/puppeteer";
import type { EvidenceFile, Probe, Result, Target } from "../shared/types";
import { freezePingPage } from "../shared/page-snapshot";
import { ipAddress } from "../shared/addresses";

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function capture(
  env: Env,
  runId: string,
  target: Target,
  seconds: number,
): Promise<Result> {
  const result: Result = {
    targetId: target.id,
    targetName: target.name,
    hostname: target.hostname,
    status: "failed",
    capturedAt: new Date().toISOString(),
    sourceUrl: `https://ping.pe/${encodeURIComponent(target.hostname)}`,
    probes: [],
    evidence: [],
  };
  // The observation intentionally sends no CDP commands while Ping.pe runs.
  // Its 90-second maximum exceeds Browser Run's default 60-second idle limit.
  const browser = await puppeteer.launch(env.BROWSER, {
    keep_alive: seconds * 1000 + 60_000,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    // Normal browser navigation allows Ping.pe's JS cookie check to run itself.
    await page.goto(result.sourceUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    try {
      await page.waitForSelector("tr.ping-result-row[data-pinger-id]", {
        timeout: 35_000,
      });
      // Ping.pe is continuous: collect a fixed-duration observation, not a fictional "finished" event.
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    } catch {
      result.error =
        "Ping.pe did not expose its probe table. Review the captured page for a challenge, rate limit, or changed markup.";
    }
    // Freeze the page and read data in one browser task so evidence matches the parsed results.
    const frozen = await page.evaluate(freezePingPage);
    result.probes = frozen.probes as Probe[];
    result.resolvedAddress = ipAddress(frozen.resolvedAddress);
    result.capturedAt = frozen.capturedAt;
    // Stop live timers / reloads; render an unmodified static clone for PNG and PDF.
    await page.setJavaScriptEnabled(false);
    await page.setContent(frozen.html, { waitUntil: "load", timeout: 30_000 });
    const persist = async (
      kind: EvidenceFile["kind"],
      bytes: Uint8Array,
      contentType: string,
    ) => {
      const key = `${runId}/${target.id}/evidence.${kind}`;
      const hash = await sha256(bytes);
      await env.EVIDENCE.put(key, bytes, {
        httpMetadata: { contentType },
        customMetadata: {
          sha256: hash,
          capturedAt: result.capturedAt,
          sourceUrl: result.sourceUrl,
        },
      });
      result.evidence.push({
        kind,
        key,
        sha256: hash,
        bytes: bytes.byteLength,
      });
    };
    await persist(
      "png",
      await page.screenshot({ type: "png", fullPage: true }),
      "image/png",
    );
    await page.emulateMediaType("screen");
    await persist(
      "pdf",
      await page.pdf({
        format: "A3",
        landscape: true,
        printBackground: true,
        margin: { top: "8mm", bottom: "8mm", left: "8mm", right: "8mm" },
      }),
      "application/pdf",
    );
    const reporting = result.probes.filter(
      (p) => p.sent > 0 && p.loss !== null,
    ).length;
    if (reporting)
      result.status =
        reporting === result.probes.length ? "complete" : "partial";
    else
      result.error ??=
        "No probes reported a valid sample during the observation window.";
    const manifest = {
      ...result,
      observationSeconds: seconds,
      note: "PNG and PDF are captured from a frozen Ping.pe page. SHA-256 checksums provide integrity, not independent proof of authenticity.",
    };
    await persist(
      "json",
      new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
      "application/json",
    );
    return result;
  } finally {
    await browser.close();
  }
}
