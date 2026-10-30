import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileImage,
  FileJson,
  FileText,
  Globe2,
  History,
  Layers3,
  LockKeyhole,
  LogOut,
  MapPin,
  Orbit,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  Dashboard,
  Probe,
  Result,
  Run,
  Settings,
  Target,
} from "../shared/types";
import {
  excludedNetwork,
  mean,
  nextScheduled,
  summarize,
} from "../shared/metrics";
import { countries, countryFlag, countryName } from "../shared/countries";
import { timeZoneOffsetLabel } from "../shared/time";
import { demoDashboard } from "./demo";
import DatasetSelector from "./DatasetSelector";
import { destinationIps } from "../shared/addresses";
import { averageRuns, commonIds } from "../shared/comparisons";
import {
  cadenceLabel,
  cadenceOptions,
  defaultCadence,
  defaultTimeZone,
  scheduleTimes,
  type ObservationCadence,
} from "../shared/schedule";

const Globe = lazy(() => import("./Globe"));
const colors = ["#98ddff", "#cab5ff", "#f3c98c"];
const probesPerPage = 50;
// Used only when the browser lacks Intl.supportedValuesOf("timeZone").
const commonTimeZones = [
  "UTC",
  "Pacific/Honolulu",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Manila",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];
const date = (value: string | Date, full = false, timeZone = defaultTimeZone) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    ...(full ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(new Date(value));
const time = (value: string | Date, timeZone = defaultTimeZone) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
const format = (value: number | null | undefined, digits = 1) =>
  value == null ? "—" : value.toFixed(digits);
const busyRun = (run?: Run) =>
  run?.status === "queued" || run?.status === "running";
const evidenceUrl = (
  run: Run,
  result: Result,
  kind: string,
  download = false,
) =>
  `/api/evidence/${run.id}/${result.targetId}/${kind}?source=${result.source ?? "pingpe"}${download ? "&download=1" : ""}`;

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data;
}
function inRegion(probe: Probe, region: string, country: string) {
  const code = probe.id.split("_")[0];
  // The configured country drives both the country dashboard and its region
  // filter option, wherever those probes come from.
  if (region === "country") return code === country;
  if (region === "china") return code === "CN";
  if (region === "apac")
    return [
      "CN",
      "HK",
      "TW",
      "TH",
      "SG",
      "JP",
      "KR",
      "IN",
      "ID",
      "MY",
      "VN",
      "AU",
      "NZ",
      "PH",
      "BD",
      "PK",
      "MN",
    ].includes(code);
  if (region === "europe")
    return [
      "GB",
      "UK",
      "DE",
      "FR",
      "NL",
      "IT",
      "ES",
      "PL",
      "SE",
      "NO",
      "FI",
      "CH",
      "AT",
      "CZ",
      "RO",
      "IE",
      "PT",
      "BE",
      "DK",
      "UA",
      "RU",
    ].includes(code);
  if (region === "americas")
    return ["US", "CA", "BR", "MX", "AR", "CL", "CO", "PE"].includes(code);
  return true;
}
export default function App() {
  const [session, setSession] = useState<{
    configured: boolean;
    authenticated: boolean;
  } | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  const [demo, setDemo] = useState(false);
  const [page, setPage] = useState(() =>
    window.location.hash === "#country" ? "country" : "overview",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [region, setRegion] = useState("all");
  const [source, setSource] = useState<"pingpe" | "globalping">("pingpe");
  const [metric, setMetric] = useState<"avg" | "loss" | "jitter">("avg");
  const [days, setDays] = useState("7");
  const [query, setQuery] = useState("");
  const [probePage, setProbePage] = useState(0);
  const [tableSort, setTableSort] = useState<{
    targetId: string;
    direction: "ascending" | "descending";
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const refreshVersion = useRef(0);
  const [viewer, setViewer] = useState<{ run: Run; result: Result } | null>(
    null,
  );
  const [clock, setClock] = useState(new Date());
  const countryOnly = page === "country";
  const activeRegion =
    countryOnly || source === "globalping" ? "country" : region;
  const sourceLabel = source === "globalping" ? "Globalping" : "Ping.pe";
  const tz = data?.settings.timezone ?? data?.timezone ?? defaultTimeZone;
  const tzOffset = timeZoneOffsetLabel(tz, clock);
  const configuredCountry = data?.settings.country ?? "TH";
  const countryLabel = countryName(configuredCountry);
  const ignored = data?.settings.ignoredNetworks ?? [];
  const visibleResults = (results: Result[]): Result[] =>
    results.map((result) => ({
      ...result,
      error:
        source === "globalping" &&
        result.error === "Some Globalping probes failed or went offline."
          ? undefined
          : result.error,
      probes: result.probes.filter((p) => !excludedNetwork(p, ignored)),
    }));
  const sourceResults = (run: Run) =>
    visibleResults(
      source === "globalping" ? (run.globalpingResults ?? []) : run.results,
    );
  const navigate = (nextPage: string) => {
    setPage(nextPage);
    setQuery("");
    window.history.replaceState(
      null,
      "",
      nextPage === "overview"
        ? window.location.pathname + window.location.search
        : `#${nextPage}`,
    );
  };
  const load = useCallback(async () => {
    const version = ++refreshVersion.current;
    try {
      const next = await api<Dashboard>("/dashboard");
      if (version !== refreshVersion.current) return;
      setData(next);
      setError("");
    } catch (e) {
      if (version === refreshVersion.current) setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    api<{ configured: boolean; authenticated: boolean }>("/session")
      .then(setSession)
      .catch(() => setSession({ configured: false, authenticated: false }));
  }, []);
  useEffect(() => {
    if (session?.authenticated && !demo) void load();
  }, [session, demo, load]);
  useEffect(() => {
    const interval = setInterval(() => {
      setClock(new Date());
      if (session?.authenticated && !demo && !document.hidden) void load();
    }, 15_000);
    return () => clearInterval(interval);
  }, [session, demo, load]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const preview = () => {
    setDemo(true);
    setData(demoDashboard());
    setSelectedId("");
    setError("");
  };
  const connect = () => {
    setDemo(false);
    setData(null);
    setSelectedId("");
    navigate("overview");
  };
  const run = data?.runs.find((r) => r.id === selectedId) ?? data?.runs[0];
  const averaging = !selectedId;
  const targets =
    averaging && data?.settings.targets.length === 3
      ? data.settings.targets
      : (run?.targets ?? data?.settings.targets ?? []);
  const aggregate = useMemo(
    () =>
      averageRuns(
        data?.runs ?? [],
        targets,
        source,
        Number(days),
        clock.getTime(),
        (p) => inRegion(p, activeRegion, configuredCountry),
        ignored,
      ),
    [
      data,
      targets,
      source,
      days,
      clock,
      activeRegion,
      configuredCountry,
      ignored,
    ],
  );
  const results = averaging
    ? visibleResults(aggregate.results)
    : run
      ? sourceResults(run)
      : [];
  const shared = useMemo(() => commonIds(results), [results]);
  const relevant = (result?: Result) =>
    result?.probes.filter(
      (p) => shared.has(p.id) && inRegion(p, activeRegion, configuredCountry),
    ) ?? [];
  const summaries = averaging
    ? aggregate.summaries
    : targets.map((t) =>
        summarize(relevant(results.find((r) => r.targetId === t.id))),
      );
  const hasComparison =
    shared.size > 0 && summaries.every((s) => s[metric] !== null);
  const best = hasComparison
    ? summaries.reduce(
        (index, s, i) => (s[metric]! < summaries[index][metric]! ? i : index),
        0,
      )
    : -1;
  const comparisonCount = summaries[0]?.reporting ?? 0;
  const chartData = (data?.runs ?? [])
    .filter(
      (r) =>
        !busyRun(r) &&
        Date.now() - Date.parse(r.startedAt) < Number(days) * 86400_000,
    )
    .slice()
    .reverse()
    .map((r) => {
      const runResults = sourceResults(r);
      const ids = commonIds(runResults);
      const values: Record<string, number | string | null> = {
        id: r.id,
        timestamp: r.startedAt,
        label: `${date(r.startedAt)} ${time(r.startedAt)}`,
      };
      targets.forEach((t) => {
        const result = runResults.find((v) => v.hostname === t.hostname);
        values[t.id] = result
          ? summarize(
              result.probes.filter(
                (p) =>
                  ids.has(p.id) && inRegion(p, activeRegion, configuredCountry),
              ),
            )[metric]
          : null;
      });
      return values;
    });
  const tableProbes = results
    .flatMap((r) => r.probes)
    .filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i)
    .filter(
      (p) =>
        inRegion(p, activeRegion, configuredCountry) &&
        `${p.location} ${p.provider}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  if (tableSort) {
    const selectedResult = results.find(
      (r) => r.targetId === tableSort.targetId,
    );
    const averages = new Map(selectedResult?.probes.map((p) => [p.id, p.avg]));
    tableProbes.sort((a, b) => {
      const left = averages.get(a.id);
      const right = averages.get(b.id);
      const leftMissing = left == null || !Number.isFinite(left);
      const rightMissing = right == null || !Number.isFinite(right);
      // Missing samples stay last for both directions; ties retain source order.
      if (leftMissing || rightMissing)
        return Number(leftMissing) - Number(rightMissing);
      return (left! - right!) * (tableSort.direction === "ascending" ? 1 : -1);
    });
  }
  const active = data?.runs.find(busyRun);
  const probePageCount = Math.max(
    1,
    Math.ceil(tableProbes.length / probesPerPage),
  );
  const currentProbePage = Math.min(probePage, probePageCount - 1);
  const probePageStart = currentProbePage * probesPerPage;
  const probePageEnd = Math.min(
    probePageStart + probesPerPage,
    tableProbes.length,
  );
  useEffect(() => {
    setProbePage(0);
  }, [page, source, activeRegion, query, selectedId, days, tableSort, demo]);
  useEffect(() => {
    setProbePage((current) => Math.min(current, probePageCount - 1));
  }, [probePageCount]);
  const latest = data?.runs[0];
  const cadence = data?.settings.cadence ?? defaultCadence;
  const next = nextScheduled(clock, cadence, tz);

  async function runNow() {
    if (demo) {
      setNotice(
        "Demo preview — connect your account to collect real measurements.",
      );
      return;
    }
    setPending(true);
    setError("");
    try {
      await api("/runs", "POST");
      setSelectedId("");
      await load();
      setNotice(
        "Observation started. Results will appear as each target is captured.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  async function clearHistoryData() {
    setClearingHistory(true);
    setError("");
    try {
      if (!demo) await api("/history", "DELETE");
      ++refreshVersion.current;
      setSelectedId("");
      setViewer(null);
      setQuery("");
      setClearDialogOpen(false);
      if (demo)
        setData((current) => (current ? { ...current, runs: [] } : current));
      else await load();
      setNotice("History cleared. Run an observation to collect fresh data.");
    } catch (e) {
      setError((e as Error).message);
      setClearDialogOpen(false);
    } finally {
      setClearingHistory(false);
    }
  }
  function exportCsv() {
    const cell = (value: unknown) =>
      `"${String(value ?? "")
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""')}"`;
    const rows: unknown[][] = [
      [
        "run_id",
        "measurement_source",
        "started_local",
        "location",
        "provider",
        "view_mode",
        "window_days",
        "test_count",
        ...targets.flatMap((t) => [
          `${t.name} latency_ms`,
          `${t.name} loss_pct`,
          `${t.name} jitter_ms`,
          `${t.name} resolved_ip`,
          `${t.name} resolved_ip_scope`,
          `${t.name} tests`,
        ]),
      ],
    ];
    tableProbes.forEach((p) =>
      rows.push([
        averaging ? "" : run?.id,
        sourceLabel,
        !averaging && run ? date(run.startedAt, true, tz) : "",
        p.location,
        p.provider,
        averaging ? "average" : "individual",
        averaging ? days : "",
        averaging ? aggregate.testCount : 1,
        ...targets.flatMap((t) => {
          const result = results.find((r) => r.targetId === t.id);
          const probe = result?.probes.find((q) => q.id === p.id);
          const destinations = destinationIps(result, probe);
          return [
            probe?.avg,
            probe?.loss,
            probe?.jitter,
            destinations.map((d) => d.address).join("; "),
            [...new Set(destinations.map((d) => d.scope))].join("; ") ||
              "unavailable",
            averaging ? (probe?.testCount ?? 0) : probe ? 1 : 0,
          ];
        }),
      ]),
    );
    const url = URL.createObjectURL(
      new Blob([rows.map((row) => row.map(cell).join(",")).join("\r\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${demo ? "DEMO-" : ""}${source}-${activeRegion === "country" ? `${configuredCountry.toLowerCase()}-` : ""}${averaging ? `${days}d-average` : (run?.id ?? "comparison")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!demo && !session?.authenticated)
    return (
      <Login
        session={session}
        onPreview={preview}
        onLogin={() => setSession({ configured: true, authenticated: true })}
      />
    );
  return (
    <div className="app-shell" data-source={source}>
      <aside className="rail">
        <a
          className="brand-mark"
          href="#"
          aria-label="SignalScope home"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <Orbit size={28} />
        </a>
        <div className="rail-nav">
          {[
            ["overview", Activity, "Overview"],
            ["country", MapPin, "Country dashboard"],
            ["evidence", Layers3, "Evidence library"],
            ["history", History, "Run history"],
          ].map(([id, Icon, label]) => {
            const I = Icon as typeof Activity;
            return (
              <button
                key={String(id)}
                className={`rail-button ${page === id ? "selected" : ""}`}
                title={String(label)}
                aria-label={String(label)}
                aria-current={page === id ? "page" : undefined}
                onClick={() => navigate(String(id))}
              >
                <I size={21} />
              </button>
            );
          })}
        </div>
        <div className="rail-bottom">
          <button
            className="rail-button"
            title="Configure targets"
            aria-label="Configure targets"
            disabled={!data}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={21} />
          </button>
          <span className="avatar">
            S<span />
          </span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="wordmark">
            SignalScope <span>observability</span>
            <span className="version">/ 01</span>
          </div>
          <div className="topbar-right">
            <span className="zone">
              <Globe2 size={14} /> {tz}{" "}
              <span className="clock">{time(clock, tz)}</span>
            </span>
            <span className={`connection ${demo ? "preview" : ""}`}>
              <i />
              {demo ? "Demo preview" : "Connected"}
            </span>
            <button
              className="icon-button"
              title={demo ? "Connect dashboard" : "Sign out"}
              aria-label={demo ? "Connect dashboard" : "Sign out"}
              onClick={async () => {
                if (!demo) {
                  try {
                    await api("/logout", "POST");
                  } catch {
                    setError("Sign out failed. Try again.");
                    return;
                  }
                  setSession((s) => (s ? { ...s, authenticated: false } : s));
                }
                connect();
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main>
          {demo && (
            <div className="demo-banner">
              <span>
                <Radio size={14} /> Preview environment{" "}
                <b>
                  All measurements are synthetic. No real evidence is stored.
                </b>
              </span>
              <button onClick={connect}>
                Connect dashboard <ArrowRight size={14} />
              </button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="small-line" /> NETWORK INTELLIGENCE
              </div>
              <h1>
                {page === "overview" ? (
                  <>
                    A clearer view.
                    <br className="mobile-break" /> Every connection.
                  </>
                ) : countryOnly ? (
                  `${countryLabel}, in focus.`
                ) : page === "evidence" ? (
                  "Evidence, preserved."
                ) : (
                  "Every observation."
                )}
              </h1>
              <p>
                {page === "overview"
                  ? "Three targets. Your observation schedule. One source of truth."
                  : countryOnly
                    ? `Latency and packet loss from ${sourceLabel} probes located in ${countryLabel}.`
                    : page === "evidence"
                      ? "Ping.pe captures and Globalping API evidence, with timestamps and integrity checksums."
                      : "A timeline of scheduled and on-demand measurements."}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button secondary clear-history-button"
                disabled={
                  !data?.runs.length ||
                  Boolean(active) ||
                  pending ||
                  clearingHistory
                }
                title={
                  active
                    ? "Wait for the current observation to finish"
                    : "Remove all saved runs and evidence"
                }
                onClick={() => setClearDialogOpen(true)}
              >
                <Trash2 size={15} />
                {clearingHistory ? "Clearing…" : "Clear history"}
              </button>
              <button
                className="button secondary"
                disabled={!data}
                onClick={() => setSettingsOpen(true)}
              >
                <SlidersHorizontal size={15} /> Configure
              </button>
              <button
                className="button primary"
                disabled={
                  pending ||
                  clearingHistory ||
                  Boolean(active) ||
                  (!demo && targets.length !== 3)
                }
                onClick={runNow}
              >
                <Play size={14} fill="currentColor" />
                {active
                  ? "Observing…"
                  : pending
                    ? "Starting…"
                    : "Run observation"}
              </button>
            </div>
          </div>
          <section className="schedule-strip">
            <div className="schedule-label">
              <Clock3 size={16} />
              <span>OBSERVATION CADENCE</span>
            </div>
            <div className="schedule-times">
              {cadence === "twice-daily" ? (
                <>
                  <span>{scheduleTimes(cadence)[0]}</span>
                  <span className="schedule-divider" />
                  <span>{scheduleTimes(cadence)[1]}</span>
                </>
              ) : (
                <span>{cadenceLabel(cadence)}</span>
              )}
              <small>
                {tz} · {tzOffset}
              </small>
            </div>
            <div className="schedule-next">
              <i
                className={data?.settings.enabled ? "live-dot" : "paused-dot"}
              />
              {data?.settings.enabled ? (
                <>
                  Next observation{" "}
                  <strong>
                    {date(next)} · {time(next)}
                  </strong>
                </>
              ) : (
                <span>Schedule paused · enable in Configure</span>
              )}
            </div>
            <span className="schedule-status">
              {data?.settings.enabled ? "AUTOMATED" : "PAUSED"}
            </span>
          </section>
          <DatasetSelector
            source={source}
            history={page === "history"}
            countryName={countryLabel}
            globalpingLimit={data?.settings.globalpingLimit ?? 30}
            onChange={(nextSource) => {
              setSource(nextSource);
              setQuery("");
            }}
          />
          {!data ? (
            <div className="empty-state">
              <RefreshCw className="spin" />
              <h2>Connecting to SignalScope</h2>
              <button className="button secondary" onClick={load}>
                Retry connection
              </button>
            </div>
          ) : targets.length === 0 ? (
            <div className="empty-state">
              <Orbit size={45} />
              <div className="eyebrow">YOUR FIRST OBSERVATION STARTS HERE</div>
              <h2>Give your network a point of reference.</h2>
              <p>
                Add three named URLs, choose your observation window,
                <br />
                and choose your country, time zone, and schedule.
              </p>
              <button
                className="button primary"
                onClick={() => setSettingsOpen(true)}
              >
                Configure three targets <ArrowRight size={15} />
              </button>
            </div>
          ) : (
            <>
              {(page === "overview" || countryOnly) && (
                <>
                  <div className="section-top">
                    <div className="section-title">
                      <span className="section-square" /> Target comparison{" "}
                      <span className="muted">
                        /{" "}
                        {averaging
                          ? `${days}D average · ${aggregate.testCount} tests`
                          : run
                            ? `${date(run.startedAt, true, tz)} ${tzOffset}`
                            : "Awaiting first run"}
                      </span>
                    </div>
                    <div className="country-view-controls">
                      {data.runs.length > 0 && (
                        <label className="select-wrap">
                          <Clock3 size={14} />
                          <select
                            aria-label={
                              countryOnly
                                ? "Country observation"
                                : "Observation"
                            }
                            value={selectedId}
                            onChange={(e) => setSelectedId(e.target.value)}
                          >
                            <option value="">Average of tests · {days}D</option>
                            {data.runs.map((r) => (
                              <option key={r.id} value={r.id}>
                                {date(r.startedAt, true, tz)} {tzOffset}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={12} />
                        </label>
                      )}
                      {countryOnly ? (
                        <span className="country-badge">
                          <MapPin size={12} /> {countryFlag(configuredCountry)}{" "}
                          {configuredCountry} ONLY
                        </span>
                      ) : (
                        <label className="select-wrap">
                          <Globe2 size={14} />
                          <select
                            aria-label="Probe region"
                            value={source === "globalping" ? "country" : region}
                            disabled={source === "globalping"}
                            onChange={(e) => setRegion(e.target.value)}
                          >
                            <option value="all">All regions</option>
                            <option value="country">{countryLabel}</option>
                            <option value="china">Mainland China</option>
                            <option value="apac">Asia Pacific</option>
                            <option value="europe">Europe</option>
                            <option value="americas">Americas</option>
                          </select>
                          <ChevronDown size={12} />
                        </label>
                      )}
                    </div>
                  </div>
                  {averaging && (
                    <p className="method-note average-context">
                      <Layers3 size={14} /> Each test counts equally. Location
                      rows average the tests available for that location
                      {source === "globalping" ? " and network" : ""}. Select an
                      observation to inspect a single run.
                    </p>
                  )}
                  <div className="target-grid">
                    {targets.map((target, i) => (
                      <TargetCard
                        key={target.id}
                        target={target}
                        color={colors[i]}
                        summary={summaries[i]}
                        result={results.find((r) => r.targetId === target.id)}
                        winner={best === i}
                        hasComparison={hasComparison}
                        metric={metric}
                        showDetails={countryOnly}
                        grouped={averaging && source === "globalping"}
                      />
                    ))}
                  </div>
                  {countryOnly && (
                    <p className="country-context">
                      <MapPin size={14} />
                      {countryLabel} probes → your three target hostnames. Uses
                      the same scheduled observations and {sourceLabel}{" "}
                      evidence.
                    </p>
                  )}
                  <div className="analysis-grid">
                    <section className="panel trend-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow">
                            THE LONGER VIEW{" "}
                            <span className="dataset-inline-label">
                              {sourceLabel}
                            </span>
                          </div>
                          <h2>
                            {countryOnly
                              ? `${countryLabel} performance over time`
                              : "Performance over time"}
                          </h2>
                        </div>
                        <div className="segmented">
                          {["7", "30"].map((n) => (
                            <button
                              key={n}
                              className={days === n ? "active" : ""}
                              onClick={() => {
                                setDays(n);
                                setSelectedId("");
                              }}
                            >
                              {n}D
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="chart-controls">
                        <div className="metric-tabs">
                          {(
                            [
                              ["avg", "Latency"],
                              ["loss", "Packet loss"],
                              ["jitter", "Jitter"],
                            ] as const
                          ).map(([id, label]) => (
                            <button
                              key={id}
                              onClick={() => setMetric(id)}
                              className={metric === id ? "active" : ""}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <span className="unit-label">
                          {metric === "loss"
                            ? "PERCENT · LOWER IS BETTER"
                            : "MILLISECONDS · LOWER IS BETTER"}
                        </span>
                      </div>
                      <div className="chart-area">
                        {chartData.some((d) =>
                          targets.some((t) => d[t.id] != null),
                        ) ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart
                              data={chartData}
                              margin={{
                                top: 15,
                                right: 15,
                                bottom: 5,
                                left: -23,
                              }}
                              onClick={(state) => {
                                const id =
                                  state.activeTooltipIndex != null
                                    ? chartData[
                                        Number(state.activeTooltipIndex)
                                      ]?.id
                                    : undefined;
                                if (typeof id === "string") setSelectedId(id);
                              }}
                            >
                              <CartesianGrid
                                vertical={false}
                                stroke="#223148"
                                strokeDasharray="3 6"
                              />
                              <XAxis
                                dataKey="timestamp"
                                tickFormatter={(v) => date(v)}
                                tick={{ fill: "#73859b", fontSize: 10 }}
                                axisLine={false}
                                tickLine={false}
                                minTickGap={45}
                              />
                              <YAxis
                                tick={{ fill: "#73859b", fontSize: 10 }}
                                axisLine={false}
                                tickLine={false}
                                width={56}
                              />
                              <Tooltip
                                labelFormatter={(label) =>
                                  `${date(String(label), true, tz)} ${tzOffset}`
                                }
                                formatter={(v, name) => [
                                  `${format(Number(v), metric === "loss" ? 1 : 2)} ${metric === "loss" ? "%" : "ms"}`,
                                  name,
                                ]}
                                contentStyle={{
                                  background: "#122036",
                                  border: "1px solid #30435b",
                                  borderRadius: 10,
                                  fontSize: 12,
                                }}
                              />
                              {targets.map((t, i) => (
                                <Line
                                  key={t.id}
                                  name={t.name}
                                  type="monotone"
                                  dataKey={t.id}
                                  stroke={colors[i]}
                                  strokeWidth={2.5}
                                  dot={false}
                                  activeDot={{
                                    r: 5,
                                    stroke: "#101c2e",
                                    strokeWidth: 3,
                                  }}
                                  connectNulls={false}
                                  isAnimationActive={
                                    !window.matchMedia(
                                      "(prefers-reduced-motion: reduce)",
                                    ).matches
                                  }
                                />
                              ))}
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="chart-empty">
                            <Activity size={27} />
                            <span>
                              {active
                                ? "Collecting your first observation…"
                                : countryOnly
                                  ? `No matched ${countryLabel} samples in this time range. Run an observation or select another date range.`
                                  : "Run an observation to start your performance timeline."}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="chart-footer">
                        <div className="legend">
                          {targets.map((t, i) => (
                            <span key={t.id}>
                              <i style={{ background: colors[i] }} />
                              {t.name}
                            </span>
                          ))}
                        </div>
                        <span>
                          Click a point to inspect its run{" "}
                          <ArrowUpRight size={12} />
                        </span>
                      </div>
                    </section>
                    <section className="panel coverage-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow">A SHARED PERSPECTIVE</div>
                          <h2>
                            {countryOnly
                              ? `Across ${countryLabel}`
                              : "Across the network"}
                          </h2>
                        </div>
                        <span className="small-badge">
                          <i />
                          {sourceLabel.toUpperCase()}
                        </span>
                      </div>
                      {countryOnly ? (
                        <div
                          className="globe country-signal"
                          role="img"
                          aria-label={`${countryLabel} probe coverage`}
                        >
                          <div>
                            <MapPin size={34} />
                            <span>{configuredCountry}</span>
                            <small>{countryLabel.toUpperCase()}</small>
                          </div>
                        </div>
                      ) : (
                        <Suspense
                          fallback={<div className="globe globe-fallback" />}
                        >
                          <Globe />
                        </Suspense>
                      )}
                      <div className="globe-caption">
                        {countryOnly
                          ? `PROBES LOCATED IN ${countryLabel.toUpperCase()}`
                          : "ILLUSTRATIVE NETWORK TOPOLOGY"}
                      </div>
                      <div className="coverage-data">
                        <div>
                          <strong>{comparisonCount || "—"}</strong>
                          <span>
                            matched probes
                            <br />
                            {countryOnly
                              ? `in ${countryLabel}`
                              : "in selected region"}
                          </span>
                        </div>
                        <div>
                          {countryOnly ? (
                            <strong>
                              {
                                new Set(
                                  relevant(results[0]).map((p) => p.provider),
                                ).size
                              }
                            </strong>
                          ) : (
                            <strong>
                              3<span>/3</span>
                            </strong>
                          )}
                          <span>
                            {countryOnly ? "matched" : "configured"}
                            <br />
                            {countryOnly
                              ? "probe networks"
                              : "comparison targets"}
                          </span>
                        </div>
                      </div>
                      <p className="method-note">
                        <ShieldCheck size={14} /> Averages use the same
                        reporting probes across all three targets.
                      </p>
                    </section>
                  </div>
                  <section className="panel probes-panel">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow">
                          LOCATION BY LOCATION{" "}
                          <span className="dataset-inline-label">
                            {sourceLabel}
                          </span>
                        </div>
                        <h2>
                          {countryOnly
                            ? `${countryLabel} locations & networks`
                            : "Where the difference lives"}
                        </h2>
                      </div>
                      <div className="table-actions">
                        <label className="search">
                          <Search size={14} />
                          <input
                            placeholder="Find a location or network"
                            aria-label="Find a location or network"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </label>
                        <button
                          className="icon-button export-button"
                          disabled={!tableProbes.length}
                          aria-label="Export comparison CSV"
                          title="Export comparison CSV"
                          onClick={exportCsv}
                        >
                          <ArrowDownToLine size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>PROBE LOCATION / NETWORK</th>
                            {targets.map((t, i) => (
                              <th
                                key={t.id}
                                aria-sort={
                                  tableSort?.targetId === t.id
                                    ? tableSort.direction
                                    : "none"
                                }
                              >
                                <button
                                  className="table-sort"
                                  aria-label={`Sort ${t.name} by average latency`}
                                  title="Sort by average latency; click again to reverse"
                                  onClick={() =>
                                    setTableSort((current) => ({
                                      targetId: t.id,
                                      direction:
                                        current?.targetId === t.id &&
                                        current.direction === "ascending"
                                          ? "descending"
                                          : "ascending",
                                    }))
                                  }
                                >
                                  <span className="table-target">
                                    <i style={{ background: colors[i] }} />
                                    {t.name.toUpperCase()}
                                    {tableSort?.targetId === t.id ? (
                                      tableSort.direction === "ascending" ? (
                                        <ArrowUp size={12} />
                                      ) : (
                                        <ArrowDown size={12} />
                                      )
                                    ) : (
                                      <ArrowUpDown size={12} />
                                    )}
                                  </span>
                                  <small>
                                    {countryOnly
                                      ? "AVG MS / LOSS % / JITTER MS"
                                      : "AVG MS / LOSS %"}
                                  </small>
                                </button>
                              </th>
                            ))}
                            <th>COMPARISON</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableProbes
                            .slice(probePageStart, probePageEnd)
                            .map((probe) => {
                              const samples = targets.map((t) =>
                                results
                                  .find((r) => r.targetId === t.id)
                                  ?.probes.find((p) => p.id === probe.id),
                              );
                              const valid = samples.map((p) => p?.avg ?? null);
                              const min = Math.min(
                                ...valid.filter((v): v is number => v !== null),
                              );
                              return (
                                <tr key={probe.id}>
                                  <td>
                                    <span className="location">
                                      <span className="country-code">
                                        {probe.id.split("_")[0]}
                                      </span>
                                      <span>
                                        {probe.location}
                                        <small>{probe.provider}</small>
                                        {averaging && (
                                          <small>
                                            {probe.testCount ?? 0} tests
                                          </small>
                                        )}
                                      </span>
                                    </span>
                                  </td>
                                  {samples.map((p, i) => (
                                    <td key={i}>
                                      <span
                                        className={
                                          shared.has(probe.id) && p?.avg === min
                                            ? "best-value"
                                            : "numeric"
                                        }
                                      >
                                        {format(p?.avg, 2)}
                                      </span>
                                      <span
                                        className={`loss-value ${(p?.loss ?? 0) > 0 ? "lossy" : ""}`}
                                      >
                                        {format(p?.loss)}%
                                      </span>
                                      {countryOnly && (
                                        <span className="jitter-value">
                                          Jitter {format(p?.jitter, 2)} ms
                                        </span>
                                      )}
                                      <span
                                        className="destination-ip"
                                        title={
                                          source === "globalping"
                                            ? "Destination IP reported by this Globalping probe during the measurement."
                                            : "Target IP recorded in Ping.pe page metadata; not per-probe DNS resolution."
                                        }
                                      >
                                        <span>
                                          {source === "globalping"
                                            ? "Resolved IP"
                                            : "Page target IP"}
                                        </span>
                                        <code>
                                          {destinationIps(
                                            results.find(
                                              (r) =>
                                                r.targetId === targets[i].id,
                                            ),
                                            p,
                                          )
                                            .map((d) => d.address)
                                            .join(", ") || "unavailable"}
                                        </code>
                                      </span>
                                    </td>
                                  ))}
                                  <td>
                                    <span
                                      className={`match-status ${shared.has(probe.id) ? "matched" : ""}`}
                                    >
                                      {shared.has(probe.id) ? (
                                        <>
                                          <Check size={12} /> Matched
                                        </>
                                      ) : (
                                        "Incomplete"
                                      )}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                    {!tableProbes.length && (
                      <div className="table-empty">
                        {query
                          ? "No probes match this search."
                          : active
                            ? "Waiting for probe results. This usually takes a few minutes."
                            : countryOnly && run
                              ? `No ${countryLabel} probes were returned in this observation. Select another run or start a new observation.`
                              : "No probe data yet. Start your first observation."}
                      </div>
                    )}
                    <div className="table-footer">
                      <span role="status" aria-live="polite" aria-atomic="true">
                        {tableProbes.length ? probePageStart + 1 : 0}–
                        {probePageEnd} of {tableProbes.length}{" "}
                        {averaging && source === "globalping"
                          ? "location / network groups"
                          : "probes"}{" "}
                        ·{" "}
                        {averaging
                          ? `${aggregate.testCount} tests · ${days}D average`
                          : (run?.status ?? "No run")}
                        {tableProbes.length > probesPerPage
                          ? " · Export CSV for all rows"
                          : ""}
                      </span>
                      {probePageCount > 1 && (
                        <nav
                          className="probe-pagination"
                          aria-label="Probe table pagination"
                        >
                          <button
                            type="button"
                            className="button secondary"
                            aria-label="Previous probe page"
                            disabled={currentProbePage === 0}
                            onClick={() => setProbePage(currentProbePage - 1)}
                          >
                            <ChevronLeft size={14} /> Previous
                          </button>
                          <span>
                            Page {currentProbePage + 1} of {probePageCount}
                          </span>
                          <button
                            type="button"
                            className="button secondary"
                            aria-label="Next probe page"
                            disabled={currentProbePage === probePageCount - 1}
                            onClick={() => setProbePage(currentProbePage + 1)}
                          >
                            Next <ChevronRight size={14} />
                          </button>
                        </nav>
                      )}
                      <span className="table-sort-hint">
                        Click a target header to sort by AVG MS · Missing
                        samples last
                      </span>
                    </div>
                    <p className="method-note destination-note">
                      IPs come from the saved measurement: Globalping reports
                      each probe’s destination; Ping.pe shows its page-level
                      target IP, not per-location DNS answers. Older runs
                      without a stored address show unavailable.{" "}
                      {averaging &&
                        "Average views list all stored IPs observed in the included tests."}
                    </p>
                  </section>
                </>
              )}
              {page === "evidence" && (
                <EvidenceLibrary
                  data={{
                    ...data,
                    runs: data.runs.map((r) => ({
                      ...r,
                      results: sourceResults(r),
                    })),
                  }}
                  source={source}
                  demo={demo}
                  onView={(r, v) => setViewer({ run: r, result: v })}
                />
              )}
              {page === "history" && (
                <section className="panel history-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">RUN LEDGER</div>
                      <h2>Observation history</h2>
                    </div>
                    <span className="muted">Latest 60 runs · {tz}</span>
                  </div>
                  <div className="run-list">
                    {data.runs.map((r) => (
                      <button
                        key={r.id}
                        className="run-row"
                        onClick={() => {
                          setSelectedId(r.id);
                          navigate("overview");
                        }}
                      >
                        <span className={`run-status-icon ${r.status}`}>
                          <Activity size={18} />
                        </span>
                        <span>
                          <strong>
                            {date(r.startedAt, true, tz)}{" "}
                            <small>{tzOffset}</small>
                          </strong>
                          <small>
                            {r.source === "scheduled"
                              ? "Scheduled observation"
                              : "On-demand observation"}{" "}
                            · {r.results.length}/3 targets captured
                            {" · "}
                            {r.globalpingResults?.length ?? 0}/3 Globalping
                            measurements
                          </small>
                          {r.error && (
                            <small className="lossy">{r.error}</small>
                          )}
                        </span>
                        <span className={`status-chip ${r.status}`}>
                          {r.status}
                        </span>
                        <ArrowUpRight size={17} />
                      </button>
                    ))}
                    {!data.runs.length && (
                      <div className="table-empty">
                        Your first observation will appear here.
                      </div>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
          <footer className="footer">
            <span>
              <Orbit size={14} /> SignalScope · Every signal. In sight.
            </span>
            <span>
              {latest
                ? `Last observation ${date(latest.startedAt, true, tz)} ${tzOffset}`
                : "Awaiting first observation"}
              <span className="footer-dot">·</span>Powered by Cloudflare Workers
            </span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {settingsOpen && (
        <SettingsModal
          settings={
            data?.settings ?? { targets: [], enabled: false, sampleSeconds: 45 }
          }
          demo={demo}
          onClose={() => setSettingsOpen(false)}
          onSave={async (settings) => {
            await api("/settings", "PUT", settings);
            await load();
            setSelectedId("");
            setSettingsOpen(false);
            setNotice("Targets and schedule saved.");
          }}
        />
      )}
      {viewer && <EvidenceViewer {...viewer} onClose={() => setViewer(null)} />}
      {clearDialogOpen && (
        <Modal
          title="Clear observation history?"
          onClose={() => {
            if (!clearingHistory) setClearDialogOpen(false);
          }}
        >
          <div className="clear-history-content">
            <p className="modal-description">
              Removes all saved runs and their PNG, PDF, and JSON evidence from
              both the global and country views. Your three targets and schedule
              are kept.
            </p>
            <div className="modal-actions">
              <button
                className="button secondary"
                disabled={clearingHistory}
                onClick={() => setClearDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                className="button danger"
                disabled={clearingHistory}
                onClick={clearHistoryData}
              >
                <Trash2 size={15} />
                {clearingHistory ? "Clearing…" : "Clear history"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TargetCard({
  target,
  color,
  summary,
  result,
  winner,
  hasComparison,
  metric,
  showDetails = false,
  grouped = false,
}: {
  target: Target;
  color: string;
  summary: ReturnType<typeof summarize>;
  result?: Result;
  winner: boolean;
  hasComparison: boolean;
  metric: "avg" | "loss" | "jitter";
  showDetails?: boolean;
  grouped?: boolean;
}) {
  return (
    <article
      className={`target-card ${winner ? "winner" : ""} ${showDetails ? "with-details" : ""}`}
      style={{ "--target-color": color } as React.CSSProperties}
    >
      <div className="target-card-top">
        <span className="target-name">
          <i />
          {target.name}
        </span>
        {winner ? (
          <span className="winner-label">
            <Zap size={11} />
            {metric === "loss"
              ? "LOWEST LOSS"
              : metric === "jitter"
                ? "LOWEST JITTER"
                : "LOWEST LATENCY"}
          </span>
        ) : (
          <span className="target-state">
            {result?.status ?? "AWAITING DATA"}
          </span>
        )}
      </div>
      <div className="target-host">
        {target.hostname}
        <ArrowUpRight size={12} />
      </div>
      <div className="target-metric">
        <strong>{format(summary[metric], metric === "loss" ? 1 : 2)}</strong>
        <span>{metric === "loss" ? "%" : "ms"}</span>
        <span className="micro-wave">
          <svg viewBox="0 0 100 35" aria-hidden="true">
            <path d="M0 23h18l5-6 8 12 9-23 9 25 6-10h45" />
          </svg>
        </span>
      </div>
      {showDetails && (
        <div className="target-secondary-metrics">
          <div>
            <span>LATENCY</span>
            <strong>
              {format(summary.avg, 2)}
              <small> ms</small>
            </strong>
          </div>
          <div>
            <span>PACKET LOSS</span>
            <strong>
              {format(summary.loss)}
              <small> %</small>
            </strong>
          </div>
          <div>
            <span>JITTER</span>
            <strong>
              {format(summary.jitter, 2)}
              <small> ms</small>
            </strong>
          </div>
        </div>
      )}
      <div className="target-card-bottom">
        <span>
          {metric === "avg"
            ? "Average latency"
            : metric === "loss"
              ? "Average packet loss"
              : "Average jitter"}
        </span>
        <span>
          {hasComparison
            ? `${summary.reporting} shared ${grouped ? (summary.reporting === 1 ? "group" : "groups") : summary.reporting === 1 ? "probe" : "probes"}`
            : "No matched samples"}
        </span>
      </div>
      {result?.error && <p className="capture-error">{result.error}</p>}
    </article>
  );
}

function Login({
  session,
  onPreview,
  onLogin,
}: {
  session: { configured: boolean; authenticated: boolean } | null;
  onPreview: () => void;
  onLogin: () => void;
}) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      await api("/login", "POST", { token });
      setToken("");
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-orbit orbit-one" />
      <div className="login-orbit orbit-two" />
      <div className="login-layout">
        <section className="login-story">
          <div className="login-brand">
            <Orbit size={31} /> SignalScope <span>observability</span>
          </div>
          <div className="eyebrow">LESS NOISE. MORE SIGNAL.</div>
          <h1>
            See the distance
            <br />
            between
            <br />
            <span>fast and faster.</span>
          </h1>
          <p>
            An evidence-backed perspective on three network targets.
            <br />
            Your probes, your country, your time zone.
          </p>
          <div className="login-cadence">
            <Clock3 size={17} />
            <strong>08:05</strong>
            <span>/</span>
            <strong>17:10</strong>
            <small>DEFAULT · CONFIGURABLE</small>
          </div>
        </section>
        <section className="login-card">
          <span className="login-icon">
            <LockKeyhole size={23} />
          </span>
          <h2>Your network, in focus.</h2>
          <p>
            Sign in to configure targets, compare results,
            <br />
            and inspect the evidence behind every run.
          </p>
          <form onSubmit={submit}>
            <label htmlFor="password">Dashboard password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter your dashboard password"
              required
              maxLength={1024}
            />
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary" disabled={pending}>
              {pending ? "Connecting…" : "Enter SignalScope"}
              <ArrowRight size={16} />
            </button>
          </form>
          {session && !session.configured && (
            <p className="setup-hint">
              Password setup is incomplete. In Cloudflare → Workers & Pages →
              signalscope → Settings → Variables and Secrets, set{" "}
              <code>DASHBOARD_TOKEN</code> to any non-empty password and deploy.
              Then sign in here with that same password.
            </p>
          )}
          <div className="login-separator">
            <span />
            or explore first
            <span />
          </div>
          <button className="button demo-button" onClick={onPreview}>
            Explore interactive demo <ArrowUpRight size={15} />
          </button>
          <div className="login-footnote">
            <ShieldCheck size={13} /> Evidence and measurements stay behind
            sign-in.
          </div>
        </section>
      </div>
      <footer className="login-footer">
        <span>SIGNALSCOPE · EVERY SIGNAL. IN SIGHT.</span>
        <span>Powered by Cloudflare Workers</span>
      </footer>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const all = focusable(),
          first = all[0],
          last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">OBSERVATORY CONTROLS</div>
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function SettingsModal({
  settings,
  demo,
  onClose,
  onSave,
}: {
  settings: Settings;
  demo: boolean;
  onClose: () => void;
  onSave: (s: Settings) => Promise<void>;
}) {
  const [targets, setTargets] = useState(
    Array.from({ length: 3 }, (_, i) => ({
      name: settings.targets[i]?.name ?? "",
      url: settings.targets[i]?.url ?? "",
    })),
  );
  const [enabled, setEnabled] = useState(settings.enabled);
  const [seconds, setSeconds] = useState(settings.sampleSeconds);
  const [cadence, setCadence] = useState<ObservationCadence>(
    settings.cadence ?? defaultCadence,
  );
  const [country, setCountry] = useState(settings.country ?? "US");
  const [timezone, setTimezone] = useState(
    settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [limit, setLimit] = useState(settings.globalpingLimit ?? 30);
  const [ignoredText, setIgnoredText] = useState(
    (settings.ignoredNetworks ?? []).join("\n"),
  );
  const times = scheduleTimes(cadence);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const timezoneOptions = useMemo(() => {
    const zones: string[] =
      (
        Intl as unknown as {
          supportedValuesOf?: (key: string) => string[];
        }
      ).supportedValuesOf?.("timeZone") ?? [];
    return zones.length
      ? zones
      : [...new Set([timezone, ...commonTimeZones])].sort();
  }, [timezone]);
  return (
    <Modal title="Configure your observations" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (demo) {
            setError(
              "These are preview settings. Connect your dashboard to save real targets.",
            );
            return;
          }
          setPending(true);
          setError("");
          try {
            await onSave({
              targets: targets as Target[],
              enabled,
              sampleSeconds: seconds,
              cadence,
              country,
              timezone,
              globalpingLimit: limit,
              ignoredNetworks: ignoredText
                .split("\n")
                .map((entry) => entry.trim())
                .filter(Boolean),
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        <p className="modal-description">
          Add three different hostnames. Ping.pe measures ICMP network latency;
          paths and page-load speed are not tested.
        </p>
        <div className="target-fields">
          {targets.map((target, i) => (
            <fieldset key={i}>
              <legend>
                <i style={{ background: colors[i] }} />
                TARGET {String.fromCharCode(65 + i)}
              </legend>
              <div className="target-field-row">
                <label>
                  Display name
                  <input
                    value={target.name}
                    maxLength={60}
                    placeholder="Target name"
                    required
                    onChange={(e) =>
                      setTargets((old) =>
                        old.map((t, j) =>
                          i === j ? { ...t, name: e.target.value } : t,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  URL or hostname
                  <input
                    value={target.url}
                    placeholder="https://your-domain.com"
                    required
                    maxLength={2048}
                    onChange={(e) =>
                      setTargets((old) =>
                        old.map((t, j) =>
                          i === j ? { ...t, url: e.target.value } : t,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            </fieldset>
          ))}
        </div>
        <div className="settings-section">
          <div>
            <strong>Scheduled observations</strong>
            <p>Run automatically, even when this dashboard is closed.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Enable scheduled observations"
            className={`toggle ${enabled ? "on" : ""}`}
            onClick={() => setEnabled(!enabled)}
          >
            <span />
          </button>
        </div>
        <div className="settings-section">
          <div>
            <strong>Probe country</strong>
            <p>
              Globalping runs probes located in this country; the country
              dashboard filters Ping.pe results to it.
            </p>
          </div>
          <select
            aria-label="Probe country"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
          >
            {countries.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name} {countryFlag(entry.code)}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-section">
          <div>
            <strong>Time zone</strong>
            <p>Schedule times and displayed dates use this zone.</p>
          </div>
          <select
            aria-label="Time zone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          >
            {timezoneOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-section schedule-frequency">
          <div>
            <strong>Observation frequency</strong>
            <p>
              All times use {timezone} ({timeZoneOffsetLabel(timezone)}).
            </p>
          </div>
          <select
            aria-label="Observation frequency"
            value={cadence}
            onChange={(event) =>
              setCadence(event.target.value as ObservationCadence)
            }
          >
            {cadenceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="schedule-preview">
          <Clock3 size={15} />
          <div>
            <strong>
              {cadence === "every-1h"
                ? "Minutes past every hour, alternating :05 and :10"
                : `${times.join(" · ")} (${timeZoneOffsetLabel(timezone)})`}
            </strong>
            <p>
              {times.length}{" "}
              {times.length === 1 ? "observation" : "observations"}/day · up to{" "}
              {(times.length * 3 * limit).toLocaleString("en-US")} Globalping
              tests/day when enabled.
            </p>
          </div>
        </div>
        <div className="settings-section">
          <div>
            <strong>Globalping probes per target</strong>
            <p>
              1–50. Higher counts give broader coverage and cost more tests.
            </p>
          </div>
          <select
            aria-label="Globalping probes per target"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          >
            {[5, 10, 15, 20, 25, 30, 40, 50].map((n) => (
              <option key={n} value={n}>
                {n} probes
              </option>
            ))}
          </select>
        </div>
        <div className="settings-section">
          <div>
            <strong>Observation window</strong>
            <p>Per target, followed by a PNG and PDF capture.</p>
          </div>
          <select
            aria-label="Observation window"
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
          >
            {[20, 30, 45, 60, 90].map((n) => (
              <option key={n} value={n}>
                {n} seconds
              </option>
            ))}
          </select>
        </div>
        <div className="settings-section ignored-networks-section">
          <div>
            <strong>Ignored networks</strong>
            <p>
              One provider name or ASN per line (for example “KeFF Networks
              (AS41281)” or “41281”). Hidden from analysis and exports; stored
              evidence keeps all probes.
            </p>
          </div>
          <textarea
            aria-label="Ignored networks"
            rows={3}
            spellCheck={false}
            value={ignoredText}
            placeholder={"Example network (AS123)\n1234"}
            onChange={(event) => setIgnoredText(event.target.value)}
          />
        </div>
        <p className="settings-note">
          Targets are observed sequentially with Ping.pe, followed by Globalping
          ping measurements using up to {limit} {countryName(country)} probes
          and 10 packets per target. Globalping uses up to {3 * limit}{" "}
          probe-tests per run; repeated manual runs can reach the
          unauthenticated 250 tests/hour allowance. The observation window
          controls Ping.pe only. Scheduled runs start a few minutes past the
          hour, alternating :05 and :10 between consecutive slots, so
          back-to-back Globalping runs never share one rate-limit minute. Saving
          a schedule takes effect at its next matching slot. Overlapping
          observations are skipped.
        </p>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={pending}>
            {pending ? "Saving…" : "Save configuration"}
            <Check size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EvidenceLibrary({
  data,
  source,
  demo,
  onView,
}: {
  data: Dashboard;
  source: "pingpe" | "globalping";
  demo: boolean;
  onView: (run: Run, result: Result) => void;
}) {
  const [selected, setSelected] = useState("");
  const runs = data.runs.filter((r) => r.results.length);
  const run = runs.find((r) => r.id === selected) ?? runs[0];
  const tz = data.timezone ?? defaultTimeZone;
  const tzOffset = timeZoneOffsetLabel(tz);
  return (
    <>
      <div className="section-top">
        <div className="section-title">
          <ShieldCheck size={16} />{" "}
          {source === "globalping"
            ? "Globalping API evidence"
            : "Original page captures"}{" "}
          <span className="muted">
            {source === "globalping" ? "/ JSON" : "/ PNG + PDF + JSON"}
          </span>
        </div>
        <label className="select-wrap">
          <Clock3 size={14} />
          <select
            aria-label="Evidence run"
            value={run?.id ?? ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {date(r.startedAt, true, tz)} {tzOffset}
              </option>
            ))}
          </select>
          <ChevronDown size={12} />
        </label>
      </div>
      <div className="evidence-grid">
        {run?.results.map((result, i) => (
          <article className="panel evidence-card" key={result.targetId}>
            <div className="evidence-thumbnail">
              {demo ? (
                <div className="demo-evidence">
                  <FileImage size={35} />
                  <span>Demo preview</span>
                  <small>Real captures appear after your first run.</small>
                </div>
              ) : result.evidence.some((e) => e.kind === "png") ? (
                <button
                  onClick={() => onView(run, result)}
                  aria-label={`View ${result.targetName} screenshot`}
                >
                  <img
                    loading="lazy"
                    src={evidenceUrl(run, result, "png")}
                    alt={`Original Ping.pe capture for ${result.hostname}`}
                  />
                </button>
              ) : (
                <div className="demo-evidence">
                  <FileImage size={30} />
                  <span>
                    {source === "globalping"
                      ? "Globalping API result"
                      : "Capture unavailable"}
                  </span>
                  <small>
                    {result.error ??
                      (source === "globalping"
                        ? "Raw API response and normalized probe data in JSON."
                        : "")}
                  </small>
                </div>
              )}
              <span className="capture-tag">
                {demo
                  ? "SYNTHETIC PREVIEW"
                  : source === "globalping"
                    ? "GLOBALPING API"
                    : "PING.PE ORIGINAL"}
              </span>
            </div>
            <div className="evidence-info">
              <div className="target-name">
                <i style={{ background: colors[i] }} />
                {result.targetName}
                <span className={`status-chip ${result.status}`}>
                  {result.status}
                </span>
              </div>
              <p>{result.hostname}</p>
              <div className="evidence-meta">
                <span>CAPTURED</span>
                <strong>
                  {date(result.capturedAt, true, tz)} {tzOffset}
                </strong>
              </div>
              <div className="evidence-downloads">
                {(["png", "pdf", "json"] as const)
                  .filter((kind) => source !== "globalping" || kind === "json")
                  .map((kind) => {
                    const Icon =
                      kind === "png"
                        ? FileImage
                        : kind === "pdf"
                          ? FileText
                          : FileJson;
                    return result.evidence.some((e) => e.kind === kind) &&
                      !demo ? (
                      <a
                        className="button secondary"
                        key={kind}
                        href={evidenceUrl(run, result, kind, true)}
                      >
                        <Icon size={14} />
                        {kind.toUpperCase()}
                        <ArrowDownToLine size={12} />
                      </a>
                    ) : (
                      <button className="button secondary" disabled key={kind}>
                        <Icon size={14} />
                        {kind.toUpperCase()}
                      </button>
                    );
                  })}
              </div>
              {!demo && result.evidence.length > 0 && (
                <button
                  className="text-button"
                  onClick={() => onView(run, result)}
                >
                  Inspect capture & checksums <ArrowRight size={13} />
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!run && (
        <div className="empty-state">
          <Layers3 size={38} />
          <h2>Evidence starts with an observation.</h2>
          <p>
            {source === "globalping"
              ? "Globalping JSON evidence will appear after a new observation."
              : "PNG, PDF, and JSON files will appear here after your first run."}
          </p>
        </div>
      )}
      <div className="evidence-method">
        <ShieldCheck size={22} />
        <div>
          <h3>A clear chain of evidence.</h3>
          <p>
            Each real observation stores a frozen copy of the Ping.pe results as
            a full-page screenshot and a PDF, plus a JSON manifest containing
            probe data, source URL, capture time, and file checksums. SHA-256
            checks detect file changes; they are not third-party authentication.{" "}
            Globalping measurements store the API response and normalized
            results as JSON evidence, with no screenshots or PDF captures.
          </p>
        </div>
      </div>
    </>
  );
}
function EvidenceViewer({
  run,
  result,
  onClose,
}: {
  run: Run;
  result: Result;
  onClose: () => void;
}) {
  // Show times in the zone the run was launched with, falling back to the
  // original deployment default for runs recorded before snapshots existed.
  const tz = run.timezone ?? defaultTimeZone;
  const tzOffset = timeZoneOffsetLabel(tz);
  return (
    <Modal
      title={`${result.targetName} · capture details`}
      onClose={onClose}
      wide
    >
      <div className="evidence-detail">
        <div className="evidence-detail-meta">
          <span>
            <strong>Source</strong>
            <a href={result.sourceUrl} target="_blank" rel="noreferrer">
              {result.sourceUrl}
              <ArrowUpRight size={12} />
            </a>
          </span>
          <span>
            <strong>Captured</strong>
            {date(result.capturedAt, true, tz)} {tzOffset}
          </span>
        </div>
        {result.evidence.some((e) => e.kind === "png") && (
          <a
            className="full-capture"
            href={evidenceUrl(run, result, "png")}
            target="_blank"
            rel="noreferrer"
          >
            <img
              src={evidenceUrl(run, result, "png")}
              alt={`Full Ping.pe screenshot for ${result.hostname}`}
            />
          </a>
        )}
        <div className="checksum-list">
          {result.evidence.map((file) => (
            <div key={file.kind}>
              <div>
                <span>
                  {file.kind.toUpperCase()} · {(file.bytes / 1024).toFixed(1)}{" "}
                  KB
                </span>
                <a href={evidenceUrl(run, result, file.kind, true)}>
                  Download <ArrowDownToLine size={13} />
                </a>
              </div>
              <code>SHA-256 {file.sha256}</code>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
