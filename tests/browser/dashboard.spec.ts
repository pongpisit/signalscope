import { expect, test } from "playwright/test";
import { freezePingPage } from "../../shared/page-snapshot";
import { demoDashboard } from "../../src/demo";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { configured: false, authenticated: false } }),
  );
});

test("the password field stays editable before setup and reports setup errors", async ({
  page,
}) => {
  await page.route("**/api/login", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error:
          "Set the DASHBOARD_TOKEN Worker secret to connect this dashboard.",
      },
    }),
  );
  await page.goto("/");
  const password = page.getByLabel("Dashboard password", { exact: true });
  await expect(password).toBeEditable();
  const testPassword = "ก";
  await password.fill(testPassword);
  await expect(password).toHaveValue(testPassword);
  const signIn = page.getByRole("button", { name: "Enter SignalScope" });
  await expect(signIn).toBeEnabled();
  await signIn.click();
  await expect(page.getByRole("alert")).toContainText(
    "Set the DASHBOARD_TOKEN",
  );
  await expect(password).toBeEditable();
});
test("desktop preview supports region, metrics, search, history and evidence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore interactive demo" }).click();
  await expect(page.getByText("Every connection.")).toBeVisible();
  await expect(page.getByText("All measurements are synthetic.")).toBeVisible();
  await page.getByLabel("Probe region").selectOption("china");
  await expect(page.getByText("4 shared probes").first()).toBeVisible();
  await page.getByRole("button", { name: "Packet loss", exact: true }).click();
  await expect(page.getByText("Average packet loss").first()).toBeVisible();
  await page.getByLabel("Find a location or network").fill("Shanghai");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Find a location or network").fill("");
  await page.getByLabel("Probe region").selectOption("all");
  await page.getByRole("button", { name: "Latency", exact: true }).click();
  await page.waitForTimeout(1300);
  await page.screenshot({
    path: "test-results/desktop-overview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Run history", exact: true }).click();
  await expect(page.locator(".run-row")).toHaveCount(14);
  await page.locator(".run-row").nth(2).click();
  await expect(page.getByText("Where the difference lives")).toBeVisible();
  await page
    .getByRole("button", { name: "Evidence library", exact: true })
    .click();
  await expect(
    page.getByText("Real captures appear after your first run."),
  ).toHaveCount(3);
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("observation frequency saves, survives reload, shows the next Bangkok slot and stays editable while paused", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-26T02:35:00Z"));
  const fixture = demoDashboard();
  let runRequests = 0;
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { configured: true, authenticated: true } }),
  );
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.route("**/api/settings", async (route) => {
    const body = route.request().postDataJSON();
    fixture.settings = {
      ...fixture.settings,
      cadence: body.cadence,
      enabled: body.enabled,
      sampleSeconds: body.sampleSeconds,
      country: body.country ?? fixture.settings.country,
      timezone: body.timezone ?? fixture.settings.timezone,
      globalpingLimit: body.globalpingLimit ?? fixture.settings.globalpingLimit,
      ignoredNetworks: body.ignoredNetworks ?? fixture.settings.ignoredNetworks,
    };
    await route.fulfill({ json: fixture.settings });
  });
  await page.route("**/api/runs", async (route) => {
    runRequests++;
    await route.fulfill({
      status: 500,
      json: { error: "Unexpected observation" },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  const frequency = page.getByLabel("Observation frequency", { exact: true });
  await expect(frequency).toHaveValue("twice-daily");
  await expect(frequency.locator("option")).toHaveCount(8);
  await frequency.selectOption("every-2h");
  await expect(page.locator(".schedule-preview")).toContainText(
    "12 observations/day",
  );
  await expect(page.locator(".schedule-preview")).toContainText(
    "1,080 Globalping tests/day",
  );
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".schedule-times")).toContainText("Every 2 hours");
  await expect(page.locator(".schedule-next strong")).toHaveText(
    "26 Oct · 10:00",
  );
  await page.reload();
  await expect(page.locator(".schedule-times")).toContainText("Every 2 hours");
  await expect(page.locator(".schedule-next strong")).toHaveText(
    "26 Oct · 10:00",
  );
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  await expect(frequency).toHaveValue("every-2h");
  await frequency.selectOption("every-24h");
  await expect(page.locator(".schedule-preview")).toContainText(
    "00:00 (UTC+7)",
  );
  await expect(page.locator(".schedule-preview")).toContainText(
    "1 observation/day",
  );
  await page
    .getByRole("switch", { name: "Enable scheduled observations" })
    .click();
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(page.locator(".schedule-times")).toContainText("Every 24 hours");
  await expect(page.locator(".schedule-next")).toContainText("Schedule paused");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  await expect(frequency).toHaveValue("every-24h");
  await expect(
    page.getByRole("switch", { name: "Enable scheduled observations" }),
  ).toHaveAttribute("aria-checked", "false");
  expect(runRequests).toBe(0);
});

test("country, time zone, probe count and ignored networks save and drive the country page", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-26T02:35:00Z"));
  const fixture = demoDashboard();
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { configured: true, authenticated: true } }),
  );
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.route("**/api/settings", async (route) => {
    const body = route.request().postDataJSON();
    // The real API normalizes target form input; keep the fixture's targets.
    fixture.settings = {
      ...fixture.settings,
      ...body,
      targets: fixture.settings.targets,
    };
    await route.fulfill({ json: fixture.settings });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  await page.getByLabel("Probe country").selectOption("SG");
  await page.getByLabel("Time zone").selectOption("Asia/Singapore");
  await page.getByLabel("Globalping probes per target").selectOption("20");
  await page.getByLabel("Ignored networks").fill("Sample network");
  await expect(page.locator(".schedule-preview")).toContainText("(UTC+8)");
  await expect(page.locator(".schedule-preview")).toContainText(
    "2 observations/day · up to 120 Globalping tests/day",
  );
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".schedule-times")).toContainText(
    "Asia/Singapore · UTC+8",
  );
  await page
    .getByRole("button", { name: "Country dashboard", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Singapore, in focus." }),
  ).toBeVisible();
  // The ignored network hides the only Singapore probe row.
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await expect(page.locator(".country-badge")).toContainText("SG ONLY");
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  await page.getByLabel("Ignored networks").fill("");
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("Singapore");
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export comparison CSV" }).click();
  expect((await pendingDownload).suggestedFilename()).toContain("sg-");
});

test("configuration controls wait for the dashboard to load and show saved values", async ({
  page,
}) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { configured: true, authenticated: true } }),
  );
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/dashboard", async (route) => {
    await gate;
    await route.fulfill({ json: demoDashboard() });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Configure", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Configure targets" }),
  ).toBeDisabled();
  release!();
  await expect(
    page.getByRole("button", { name: "Configure", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // The modal reflects the saved configuration, never the neutral defaults.
  await expect(page.getByLabel("Probe country")).toHaveValue("TH");
  await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Bangkok");
  await expect(page.getByLabel("Globalping probes per target")).toHaveValue(
    "30",
  );
  await expect(page.getByLabel("Ignored networks")).toHaveValue("");
});

test("mobile preview stays within the viewport and supports navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore interactive demo" }).click();
  await page.waitForTimeout(1000);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/mobile-overview.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Evidence library", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Evidence, preserved." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  await expect(page.getByLabel("Enable scheduled observations")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
});

test("dataset channels support keyboard selection and clearly identify the source across pages and screen sizes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#country");
  await page.getByRole("button", { name: "Explore interactive demo" }).click();
  const selector = page.getByRole("region", { name: "Measurement dataset" });
  const pingpe = selector.getByRole("radio", { name: "Ping.pe", exact: true });
  const globalping = selector.getByRole("radio", {
    name: "Globalping",
    exact: true,
  });
  await expect(pingpe).toBeChecked();
  await expect(selector.getByRole("status")).toHaveText(
    "Viewing Ping.pe dataset",
  );
  await pingpe.focus();
  await page.keyboard.press("ArrowRight");
  await expect(globalping).toBeChecked();
  await expect(globalping).toBeFocused();
  await expect(selector.getByRole("status")).toHaveText(
    "Viewing Globalping dataset",
  );
  await expect(selector).toContainText("up to 30 Thailand probes");
  await expect(page.locator(".trend-panel .dataset-inline-label")).toHaveText(
    "Globalping",
  );
  await expect(page.locator(".probes-panel .dataset-inline-label")).toHaveText(
    "Globalping",
  );
  await page
    .getByRole("button", { name: "Evidence library", exact: true })
    .click();
  await expect(globalping).toBeChecked();
  await expect(selector.getByRole("status")).toHaveText(
    "Viewing Globalping dataset",
  );
  await page.getByRole("button", { name: "Run history", exact: true }).click();
  await expect(selector).toContainText("History lists both sources");
  await page
    .getByRole("button", { name: "Country dashboard", exact: true })
    .click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await selector.scrollIntoViewIfNeeded();
    await expect(selector.getByRole("status")).toBeVisible();
    await expect(
      selector.getByText("Globalping", { exact: true }),
    ).toBeVisible();
    await expect(selector.getByText("Ping.pe", { exact: true })).toBeVisible();
    const bounds = await globalping.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(90);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if (width === 1440 || width === 390)
      await page.screenshot({
        path: `test-results/dataset-globalping-${width}.png`,
        fullPage: true,
      });
  }
  await globalping.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(pingpe).toBeChecked();
  await expect(selector.getByRole("status")).toHaveText(
    "Viewing Ping.pe dataset",
  );
  await expect(page.locator(".probes-panel .dataset-inline-label")).toHaveText(
    "Ping.pe",
  );
  await page.screenshot({
    path: "test-results/dataset-pingpe-mobile.png",
    fullPage: true,
  });
});

test("country dashboard compares only configured-country probes across metrics, runs and CSV", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore interactive demo" }).click();
  await page.getByLabel("Probe region").selectOption("china");
  await page
    .getByRole("button", { name: "Country dashboard", exact: true })
    .click();
  await expect(page).toHaveURL(/#country$/);
  await expect(
    page.getByRole("heading", { name: "Thailand, in focus." }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await expect(page.locator(".country-code")).toHaveText(["TH", "TH", "TH"]);
  await expect(page.locator(".target-secondary-metrics")).toHaveCount(3);
  await expect(
    page.getByText("3 shared probes", { exact: true }).first(),
  ).toBeVisible();
  const fixture = demoDashboard();
  // Cards average every configured-country probe that reported.
  const metric = (
    runIndex: number,
    targetIndex: number,
    key: "avg" | "jitter",
  ) =>
    (
      fixture.runs[runIndex].results[targetIndex].probes
        .filter((p) => p.id.startsWith("TH_"))
        .reduce((total, p) => total + p[key]!, 0) / 3
    ).toFixed(2);
  await page.getByLabel("Country observation").selectOption("demo-0");
  for (let i = 0; i < 3; i++) {
    await expect(page.locator(".target-metric strong").nth(i)).toHaveText(
      metric(0, i, "avg"),
    );
  }
  await page.getByRole("button", { name: "Packet loss", exact: true }).click();
  await expect(page.locator(".target-metric strong").first()).toHaveText("0.0");
  await page.getByRole("button", { name: "Jitter", exact: true }).click();
  await expect(page.locator(".target-metric strong").first()).toHaveText(
    metric(0, 0, "jitter"),
  );
  await page.getByRole("button", { name: "Latency", exact: true }).click();
  await page.getByLabel("Country observation").selectOption("demo-1");
  await expect(page.locator(".target-metric strong").first()).toHaveText(
    metric(1, 0, "avg"),
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export comparison CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("th-");
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream!) csv += chunk.toString();
  expect(csv).toContain("Thailand, Bangkok");
  expect(csv).not.toContain("China, Beijing");
  expect(csv).not.toContain("Singapore");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/desktop-country.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByLabel("Probe region")).toHaveValue("china");
  await expect(page.locator("tbody tr")).toHaveCount(4);
});

test("country dashboard opens from its bookmark on mobile", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#country");
  await page.getByRole("button", { name: "Explore interactive demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Thailand, in focus." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Country dashboard", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await expect(page.locator(".country-code")).toHaveText(["TH", "TH", "TH"]);
  await page.screenshot({
    path: "test-results/mobile-country.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("country view shows absent samples instead of global averages", async ({
  page,
}) => {
  const fixture = demoDashboard();
  fixture.runs.forEach((run) =>
    run.results.forEach((result) => {
      result.probes = result.probes.filter(
        (probe) => !probe.id.startsWith("TH_"),
      );
    }),
  );
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { configured: true, authenticated: true } }),
  );
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/#country");
  await expect(page.locator(".target-metric strong")).toHaveText([
    "—",
    "—",
    "—",
  ]);
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await expect(
    page.getByText("No Thailand probes were returned", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("No matched Thailand samples", { exact: false }),
  ).toBeVisible();
});

test("clear history resets both views and evidence while retaining demo targets and schedule", async ({
  page,
}) => {
  let deleteRequests = 0;
  await page.route("**/api/history", (route) => {
    deleteRequests++;
    return route.fulfill({ json: { cleared: true } });
  });
  await page.goto("/#country");
  await page.getByRole("button", { name: "Explore interactive demo" }).click();
  await page
    .getByRole("button", { name: "Clear history", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "Clear observation history?" });
  await expect(dialog).toContainText("global and country");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Clear history", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Clear observation history?" });
  await dialog
    .getByRole("button", { name: "Clear history", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".target-metric strong")).toHaveText([
    "—",
    "—",
    "—",
  ]);
  await expect(page.locator(".target-card")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Run observation", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("AUTOMATED", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clear history", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Run history", exact: true }).click();
  await expect(page.locator(".run-row")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Evidence library", exact: true })
    .click();
  await expect(page.locator(".evidence-card")).toHaveCount(0);
  expect(deleteRequests).toBe(0);
});

test("clear history keeps records on API failure and reloads fresh data after a successful retry", async ({
  page,
}) => {
  const fixture = demoDashboard();
  let attempts = 0;
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { configured: true, authenticated: true } }),
  );
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.route("**/api/history", (route) => {
    expect(route.request().method()).toBe("DELETE");
    if (++attempts === 1)
      return route.fulfill({
        status: 500,
        json: { error: "History could not be cleared. Try again." },
      });
    fixture.runs = [];
    return route.fulfill({
      json: { cleared: true, deletedRuns: 14, deletedFiles: 0 },
    });
  });
  await page.goto("/#country");
  await page
    .getByRole("button", { name: "Clear history", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Clear history", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "History could not be cleared",
  );
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Clear history", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Clear history", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "History cleared" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run observation", exact: true }),
  ).toBeEnabled();
});

test("clear history is disabled while a measurement is running", async ({
  page,
}) => {
  const fixture = demoDashboard();
  fixture.runs[0].status = "running";
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { configured: true, authenticated: true } }),
  );
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Clear history", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".target-card")).toHaveCount(3);
});

test("the capture parser keeps missing samples null and freezes canvas evidence", async ({
  page,
}) => {
  await page.setContent(
    `<html><head></head><body><table><tr class="ping-result-row" data-pinger-id="CN_1" data-location="China, Shanghai" data-provider="Test" data-sent="5" data-loss="20" data-avg="35.2" data-best="31" data-worst="45" data-stdev="3.1"><td>35.2</td></tr><tr class="ping-result-row" data-pinger-id="SG_1" data-sent="0" data-loss="" data-avg=""><td>pending</td></tr></table><canvas width="20" height="10"></canvas><script>window.example=1</script></body></html>`,
  );
  const frozen = await page.evaluate(freezePingPage);
  expect(frozen.probes[0]).toMatchObject({ avg: 35.2, loss: 20, sent: 5 });
  expect(frozen.probes[1]).toMatchObject({ avg: null, loss: null, sent: 0 });
  expect(frozen.html).not.toContain("<script");
  expect(frozen.html).toContain("data:image/png");
  expect(frozen.html).not.toContain("<canvas");
  expect(frozen.resolvedAddress).toBeNull();
  await page.evaluate(() => {
    const metadata = document.createElement("div");
    metadata.id = "snapshot-metadata";
    metadata.dataset.targetHostResolved = "203.0.113.10";
    document.body.appendChild(metadata);
  });
  const withMetadata = await page.evaluate(freezePingPage);
  expect(withMetadata.resolvedAddress).toBe("203.0.113.10");
  expect(withMetadata.probes[0]).not.toHaveProperty("resolvedAddress");
  expect(withMetadata.html).toContain(
    'data-target-host-resolved="203.0.113.10"',
  );
});

test("Globalping comparisons, exports and JSON evidence stay separate from Ping.pe", async ({
  page,
}) => {
  const fixture = demoDashboard();
  fixture.runs[0].globalpingResults = fixture.runs[0].results.map((r) => ({
    ...r,
    source: "globalping",
    measurementId: `gp-${r.targetId}`,
    sourceUrl: `https://api.globalping.io/v1/measurements/gp-${r.targetId}`,
    probes: [
      {
        id: "TH_globalping_0",
        location: "Thailand, Chiang Mai",
        provider: "Globalping Test (AS123)",
        sent: 10,
        loss: 0,
        avg: 7,
        best: 6,
        worst: 8,
        jitter: null,
      },
    ],
    evidence: [
      {
        kind: "json",
        key: `test/globalping/${r.targetId}/evidence.json`,
        sha256: "test-sha256",
        bytes: 1024,
      },
    ],
  }));
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { configured: true, authenticated: true } }),
  );
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/#country");
  await page.getByLabel("Country observation").selectOption("demo-0");
  const pingpeValue = await page
    .locator(".target-metric strong")
    .first()
    .innerText();
  await page.getByRole("radio", { name: "Globalping", exact: true }).check();
  await expect(page.locator(".target-metric strong")).toHaveText([
    "7.00",
    "7.00",
    "7.00",
  ]);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("Chiang Mai");
  await page.getByRole("button", { name: "Jitter", exact: true }).click();
  await expect(page.locator(".target-metric strong")).toHaveText([
    "—",
    "—",
    "—",
  ]);
  await page.getByLabel("Country observation").selectOption("demo-1");
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await page.getByLabel("Country observation").selectOption("demo-0");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export comparison CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("globalping-th-");
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream!) csv += chunk.toString();
  expect(csv).toContain("Globalping");
  expect(csv).toContain("Chiang Mai");
  expect(csv).not.toContain("Thailand, Bangkok");
  await page
    .getByRole("button", { name: "Evidence library", exact: true })
    .click();
  await expect(page.locator(".evidence-card")).toHaveCount(3);
  await expect(page.locator(".capture-tag").first()).toHaveText(
    "GLOBALPING API",
  );
  await expect(page.locator(".evidence-downloads a")).toHaveCount(3);
  await expect(page.locator(".evidence-downloads a").first()).toHaveAttribute(
    "href",
    /source=globalping&download=1/,
  );
  await expect(page.locator(".evidence-card img")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Country dashboard", exact: true })
    .click();
  await page.getByRole("radio", { name: "Ping.pe", exact: true }).check();
  await page.getByRole("button", { name: "Latency", exact: true }).click();
  await expect(page.locator(".target-metric strong").first()).toHaveText(
    pingpeValue,
  );
});

for (const source of ["pingpe", "globalping"] as const) {
  test(`${source} shows recorded destination IPs with the correct scope and exports them`, async ({
    page,
  }) => {
    const fixture = demoDashboard();
    const results = fixture.runs[0].results.map((result, targetIndex) => ({
      ...result,
      source,
      resolvedAddress:
        source === "pingpe" ? `203.0.113.${targetIndex + 50}` : undefined,
      probes: [0, 1, 2].map((index) => ({
        id: `TH_ip_${index}`,
        location: `Thailand, Location ${index}`,
        provider: "Test network",
        sent: 10,
        loss: 0,
        avg: index + 1,
        best: index + 1,
        worst: index + 1,
        jitter: null,
        ...(source === "globalping"
          ? {
              resolvedAddress:
                index === 2
                  ? null
                  : index === 1
                    ? `2001:db8::${targetIndex + 1}`
                    : `203.0.113.${targetIndex + 10}`,
            }
          : {}),
      })),
    }));
    if (source === "globalping") fixture.runs[0].globalpingResults = results;
    else fixture.runs[0].results = results;
    await page.route("**/api/session", (route) =>
      route.fulfill({ json: { configured: true, authenticated: true } }),
    );
    await page.route("**/api/dashboard", (route) =>
      route.fulfill({ json: fixture }),
    );
    await page.goto("/#country");
    await page.getByLabel("Country observation").selectOption("demo-0");
    await page
      .getByRole("radio", {
        name: source === "globalping" ? "Globalping" : "Ping.pe",
        exact: true,
      })
      .check();
    const firstColumn = page.locator(
      "tbody tr td:nth-child(2) .destination-ip",
    );
    await expect(firstColumn.locator("code")).toHaveText(
      source === "globalping"
        ? ["203.0.113.10", "2001:db8::1", "unavailable"]
        : ["203.0.113.50", "203.0.113.50", "203.0.113.50"],
    );
    await expect(firstColumn.locator("span").first()).toHaveText(
      source === "globalping" ? "Resolved IP" : "Page target IP",
    );
    await expect(
      page
        .locator("tbody tr")
        .first()
        .locator("td:nth-child(3) .destination-ip code"),
    ).toHaveText(source === "globalping" ? "203.0.113.11" : "203.0.113.51");
    const pendingDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export comparison CSV" }).click();
    const stream = await (await pendingDownload).createReadStream();
    let csv = "";
    for await (const chunk of stream!) csv += chunk.toString();
    expect(csv).toContain("resolved_ip_scope");
    expect(csv).toContain(source === "globalping" ? '"probe"' : '"page"');
    expect(csv).toContain(
      source === "globalping" ? "2001:db8::1" : "203.0.113.50",
    );
    if (source === "globalping") expect(csv).toContain('"unavailable"');
    // Historical rows never borrow the current run's address or trigger DNS lookups.
    await page.getByLabel("Country observation").selectOption("demo-1");
    if (source === "pingpe")
      await expect(page.locator(".destination-ip code")).toHaveText(
        Array.from({ length: 9 }, () => "unavailable"),
      );
    else await expect(page.locator("tbody tr")).toHaveCount(0);
  });

  test(`${source} sorts target latency numerically in both directions with missing samples last`, async ({
    page,
  }) => {
    const fixture = demoDashboard();
    const results = fixture.runs[0].results.map((result, targetIndex) => ({
      ...result,
      probes: [10, 2, 100, null, null]
        .map((avg, index) => ({
          id: `TH_sort_${index}`,
          location: `Thailand, Sort ${index}`,
          provider: "Included network (AS123)",
          sent: 10,
          loss: avg === null ? 100 : 0,
          avg: targetIndex === 1 && avg !== null ? 100 - avg : avg,
          best: avg,
          worst: avg,
          jitter: null,
        }))
        .filter((_, index) => targetIndex !== 0 || index !== 4),
    }));
    if (source === "globalping")
      fixture.runs[0].globalpingResults = results.map((r) => ({
        ...r,
        source,
      }));
    else fixture.runs[0].results = results;
    await page.route("**/api/session", (route) =>
      route.fulfill({ json: { configured: true, authenticated: true } }),
    );
    await page.route("**/api/dashboard", (route) =>
      route.fulfill({ json: fixture }),
    );
    await page.goto("/#country");
    await page.getByLabel("Country observation").selectOption("demo-0");
    await page
      .getByRole("radio", {
        name: source === "globalping" ? "Globalping" : "Ping.pe",
        exact: true,
      })
      .check();
    const firstHeader = page.locator("thead th").nth(1);
    const firstSort = firstHeader.getByRole("button");
    const locations = page.locator(
      "tbody tr td:first-child .location > span:last-child",
    );
    const expectOrder = async (indices: number[]) => {
      const text = await locations.allTextContents();
      expect(
        text.map((value) => Number(value.match(/Sort (\d+)/)![1])),
      ).toEqual(indices);
    };
    await firstSort.click();
    await expect(firstHeader).toHaveAttribute("aria-sort", "ascending");
    await expectOrder([1, 0, 2, 3, 4]);
    // Keyboard activation reverses sort; both null and absent readings remain last.
    await firstSort.press("Enter");
    await expect(firstHeader).toHaveAttribute("aria-sort", "descending");
    await expectOrder([2, 0, 1, 3, 4]);
    const pendingDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export comparison CSV" }).click();
    const stream = await (await pendingDownload).createReadStream();
    let csv = "";
    for await (const chunk of stream!) csv += chunk.toString();
    expect(csv.indexOf("Sort 2")).toBeLessThan(csv.indexOf("Sort 0"));
    expect(csv.indexOf("Sort 0")).toBeLessThan(csv.indexOf("Sort 1"));
    const secondHeader = page.locator("thead th").nth(2);
    await secondHeader.getByRole("button").click();
    await expect(secondHeader).toHaveAttribute("aria-sort", "ascending");
    await expect(firstHeader).toHaveAttribute("aria-sort", "none");
    await expectOrder([2, 0, 1, 3, 4]);
    await page.getByLabel("Find a location or network").fill("Sort 0");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expectOrder([0]);
  });

  test(`${source} excludes configured networks from existing runs, counts and CSV`, async ({
    page,
  }) => {
    const fixture = demoDashboard();
    fixture.settings = {
      ...fixture.settings,
      ignoredNetworks: [
        "KeFF Networks (AS41281)",
        "SiS Distribution (Thailand)",
      ],
    };
    for (const run of fixture.runs) {
      const results = run.results.map((result) => ({
        ...result,
        probes: [
          { id: "TH_keff", provider: "KeFF Networks (AS41281)", avg: 9000 },
          {
            id: "TH_sis",
            provider: "SiS Distribution (Thailand) (AS135381)",
            avg: 8000,
          },
          { id: "TH_included", provider: "Included network (AS123)", avg: 7 },
        ].map((probe) => ({
          ...probe,
          location: "Thailand, Bangkok",
          sent: 10,
          loss: 0,
          best: probe.avg,
          worst: probe.avg,
          jitter: 1,
        })),
      }));
      if (source === "globalping")
        run.globalpingResults = results.map((r) => ({ ...r, source }));
      else run.results = results;
    }
    await page.route("**/api/session", (route) =>
      route.fulfill({ json: { configured: true, authenticated: true } }),
    );
    await page.route("**/api/dashboard", (route) =>
      route.fulfill({ json: fixture }),
    );
    await page.goto("/#country");
    await page
      .getByRole("radio", {
        name: source === "globalping" ? "Globalping" : "Ping.pe",
        exact: true,
      })
      .check();
    await expect(page.locator(".target-metric strong")).toHaveText([
      "7.00",
      "7.00",
      "7.00",
    ]);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody")).toContainText("Included network");
    await expect(
      page.getByText(
        source === "globalping" ? "1 shared group" : "1 shared probe",
        { exact: true },
      ),
    ).toHaveCount(3);
    await page.getByLabel("Country observation").selectOption("demo-1");
    await expect(page.locator(".target-metric strong")).toHaveText([
      "7.00",
      "7.00",
      "7.00",
    ]);
    await page.getByLabel("Find a location or network").fill("KeFF");
    await expect(page.locator("tbody tr")).toHaveCount(0);
    await page.getByLabel("Find a location or network").fill("");
    const pendingDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export comparison CSV" }).click();
    const stream = await (await pendingDownload).createReadStream();
    let csv = "";
    for await (const chunk of stream!) csv += chunk.toString();
    expect(csv).toContain("Included network");
    expect(csv).not.toContain("KeFF");
    expect(csv).not.toContain("SiS Distribution");
    // Source switching and region navigation must not reintroduce ignored rows.
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
  });
}

for (const source of ["pingpe", "globalping"] as const) {
  test(`${source} paginates all 172 rows, exports every page, and resets pages when the view changes`, async ({
    page,
  }) => {
    await page.clock.install();
    const fixture = demoDashboard();
    fixture.runs = fixture.runs.slice(0, 4);
    for (const run of fixture.runs) {
      run.results = run.results.map((result) => ({
        ...result,
        probes: Array.from({ length: 172 }, (_, index) => ({
          id: `TH_pagination_${index}`,
          location: `Thailand, Pagination ${String(index + 1).padStart(3, "0")}`,
          provider: "Pagination network (AS123)",
          sent: 10,
          loss: 0,
          avg: index + 1,
          best: index + 1,
          worst: index + 1,
          jitter: 1,
        })),
      }));
      run.globalpingResults = run.results.map((result) => ({
        ...result,
        source: "globalping",
      }));
    }
    await page.route("**/api/session", (route) =>
      route.fulfill({ json: { configured: true, authenticated: true } }),
    );
    await page.route("**/api/dashboard", (route) =>
      route.fulfill({ json: fixture }),
    );
    await page.goto("/");
    await page
      .getByRole("radio", {
        name: source === "pingpe" ? "Ping.pe" : "Globalping",
        exact: true,
      })
      .check();
    const footer = page.locator(".table-footer");
    const pagination = page.getByRole("navigation", {
      name: "Probe table pagination",
    });
    const next = pagination.getByRole("button", { name: "Next probe page" });
    const previous = pagination.getByRole("button", {
      name: "Previous probe page",
    });
    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(50);
    await expect(footer).toContainText("1–50 of 172");
    await expect(footer).toContainText("4 tests · 7D average");
    await expect(previous).toBeDisabled();
    for (const [start, end, count] of [
      [51, 100, 50],
      [101, 150, 50],
      [151, 172, 22],
    ]) {
      await next.click();
      await expect(footer).toContainText(`${start}–${end} of 172`);
      await expect(rows).toHaveCount(count);
      await expect(rows.first()).toContainText(
        `Pagination ${String(start).padStart(3, "0")}`,
      );
      await expect(rows.last()).toContainText(
        `Pagination ${String(end).padStart(3, "0")}`,
      );
    }
    await expect(pagination).toContainText("Page 4 of 4");
    await expect(next).toBeDisabled();
    const pendingDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export comparison CSV" }).click();
    const stream = await (await pendingDownload).createReadStream();
    let csv = "";
    for await (const chunk of stream!) csv += chunk.toString();
    expect(csv.split("\r\n")).toHaveLength(173);
    expect(csv).toContain("Pagination 001");
    expect(csv).toContain("Pagination 051");
    expect(csv).toContain("Pagination 172");
    await previous.click();
    await expect(footer).toContainText("101–150 of 172");
    const firstSort = page.locator("thead th").nth(1).getByRole("button");
    await firstSort.click();
    await expect(footer).toContainText("1–50 of 172");
    await next.click();
    await expect(rows.first()).toContainText("Pagination 051");
    await firstSort.click();
    await expect(footer).toContainText("1–50 of 172");
    await expect(rows.first()).toContainText("Pagination 172");
    await next.click();
    await expect(rows.first()).toContainText("Pagination 122");
    const search = page.getByLabel("Find a location or network");
    await search.fill("Pagination 172");
    await expect(rows).toHaveCount(1);
    await expect(footer).toContainText("1–1 of 1");
    await expect(pagination).toHaveCount(0);
    await search.fill("no matching location");
    await expect(rows).toHaveCount(0);
    await expect(footer).toContainText("0–0 of 0");
    await search.fill("");
    await expect(footer).toContainText("1–50 of 172");
    await next.click();
    await page.getByRole("button", { name: "30D", exact: true }).click();
    await expect(footer).toContainText("1–50 of 172");
    await next.click();
    await page
      .getByLabel("Observation", { exact: true })
      .selectOption("demo-0");
    await expect(footer).toContainText("1–50 of 172");
    await next.click();
    await page
      .getByRole("button", { name: "Country dashboard", exact: true })
      .click();
    await expect(footer).toContainText("1–50 of 172");
    await next.click();
    await page
      .getByRole("radio", {
        name: source === "pingpe" ? "Globalping" : "Ping.pe",
        exact: true,
      })
      .check();
    await expect(footer).toContainText("1–50 of 172");
    await page.setViewportSize({ width: 320, height: 800 });
    await next.focus();
    await next.press("Enter");
    await expect(footer).toContainText("51–100 of 172");
    await expect(previous).toBeVisible();
    await expect(next).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/${source}-pagination-mobile.png`,
      fullPage: true,
    });
    // Background refreshes must preserve a valid page, but clamp it when rows disappear.
    await page.clock.fastForward(16_000);
    await expect(footer).toContainText("51–100 of 172");
    for (const run of fixture.runs) {
      for (const result of [...run.results, ...run.globalpingResults!])
        result.probes = result.probes.slice(0, 12);
    }
    await page.clock.fastForward(16_000);
    await expect(rows).toHaveCount(12);
    await expect(footer).toContainText("1–12 of 12");
    await expect(pagination).toHaveCount(0);
  });
}

test("7D and 30D average cards, locations and exports while individual observations stay inspectable", async ({
  page,
}) => {
  const fixture = demoDashboard();
  fixture.runs = fixture.runs.slice(0, 3);
  fixture.runs.forEach((run, index) => {
    run.startedAt = new Date(
      Date.now() - [1, 2, 12][index] * 86400_000,
    ).toISOString();
    run.results = run.results.map((result) => ({
      ...result,
      resolvedAddress: `203.0.113.${index + 1}`,
      probes: [
        {
          ...result.probes.find((p) => p.id.startsWith("TH_"))!,
          avg: [10, 30, 80][index],
          loss: [0, 10, 20][index],
        },
      ],
    }));
    run.globalpingResults = run.results.map((result) => ({
      ...result,
      source: "globalping",
      resolvedAddress: undefined,
      probes: result.probes.map((p) => ({
        ...p,
        id: `TH_globalping_${index}`,
        resolvedAddress: `203.0.113.${index + 10}`,
        avg: p.avg! + 100,
        jitter: null,
      })),
    }));
  });
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { configured: true, authenticated: true } }),
  );
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/#country");
  const observation = page.getByLabel("Country observation");
  await expect(observation).toHaveValue("");
  await expect(page.locator(".section-title")).toContainText(
    "7D average · 2 tests",
  );
  await expect(page.locator(".target-metric strong")).toHaveText([
    "20.00",
    "20.00",
    "20.00",
  ]);
  await expect(page.locator("tbody tr td:nth-child(2) .best-value")).toHaveText(
    "20.00",
  );
  await expect(
    page.locator("tbody tr td:nth-child(2) .destination-ip code"),
  ).toHaveText("203.0.113.1, 203.0.113.2");
  await page.getByRole("button", { name: "Packet loss", exact: true }).click();
  await expect(page.locator(".target-metric strong")).toHaveText([
    "5.0",
    "5.0",
    "5.0",
  ]);
  await page.getByRole("button", { name: "Latency", exact: true }).click();
  await observation.selectOption("demo-0");
  await expect(page.locator(".target-metric strong")).toHaveText([
    "10.00",
    "10.00",
    "10.00",
  ]);
  await page.getByRole("button", { name: "30D", exact: true }).click();
  await expect(observation).toHaveValue("");
  await expect(page.locator(".section-title")).toContainText(
    "30D average · 3 tests",
  );
  await expect(page.locator(".target-metric strong")).toHaveText([
    "40.00",
    "40.00",
    "40.00",
  ]);
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export comparison CSV" }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toContain("30d-average");
  let csv = "";
  for await (const chunk of (await download.createReadStream())!)
    csv += chunk.toString();
  expect(csv).toContain('"view_mode","window_days","test_count"');
  expect(csv).toContain('"average","30","3"');
  expect(csv).toContain("203.0.113.1; 203.0.113.2; 203.0.113.3");
  expect(csv).not.toContain('"demo-0"');
  await page.getByRole("radio", { name: "Globalping", exact: true }).check();
  await expect(page.locator(".target-metric strong")).toHaveText([
    "140.00",
    "140.00",
    "140.00",
  ]);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(
    page.locator("tbody tr td:nth-child(2) .destination-ip code"),
  ).toHaveText("203.0.113.10, 203.0.113.11, 203.0.113.12");
  await observation.selectOption("demo-1");
  await expect(page.locator(".target-metric strong")).toHaveText([
    "130.00",
    "130.00",
    "130.00",
  ]);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByLabel("Observation", { exact: true }).selectOption("");
  await expect(page.locator(".target-metric strong")).toHaveText([
    "140.00",
    "140.00",
    "140.00",
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
