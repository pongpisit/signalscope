import type { ObservationCadence } from "./schedule";

export type Target = {
  id: string;
  name: string;
  url: string;
  hostname: string;
};
export type Settings = {
  targets: Target[];
  enabled: boolean;
  sampleSeconds: number;
  cadence?: ObservationCadence;
  // Server-managed boundary: saving/enabling a schedule starts at its next slot.
  scheduleNotBefore?: string;
  // ISO 3166-1 alpha-2 code of the country whose probes Globalping runs and
  // the country dashboard filters to.
  country?: string;
  // IANA time zone for schedule alignment and displayed times.
  timezone?: string;
  // Provider names or ASNs hidden from analysis, counts, trends and CSV.
  ignoredNetworks?: string[];
  // Globalping probes per target (1–50).
  globalpingLimit?: number;
};
export type Probe = {
  testCount?: number;
  // Transient multi-test view; original measurements keep their single IP field.
  destinationIps?: { address: string; scope: "probe" | "page" }[];
  resolvedAddress?: string | null;
  id: string;
  location: string;
  provider: string;
  sent: number;
  loss: number | null;
  avg: number | null;
  best: number | null;
  worst: number | null;
  jitter: number | null;
};
export type EvidenceFile = {
  kind: "png" | "pdf" | "json";
  key: string;
  sha256: string;
  bytes: number;
};
export type Result = {
  // Ping.pe page-level target address; not an independent DNS answer per probe.
  resolvedAddress?: string | null;
  source?: "pingpe" | "globalping";
  measurementId?: string;
  targetId: string;
  targetName: string;
  hostname: string;
  status: "complete" | "partial" | "failed";
  capturedAt: string;
  sourceUrl: string;
  probes: Probe[];
  evidence: EvidenceFile[];
  error?: string;
};
export type Run = {
  id: string;
  startedAt: string;
  completedAt: string | null;
  source: "manual" | "scheduled";
  status: "queued" | "running" | "complete" | "partial" | "failed";
  targets: Target[];
  // Country and time zone recorded when the run launched, so changing the
  // configuration later never repaints earlier observations.
  country?: string;
  timezone?: string;
  results: Result[];
  globalpingResults?: Result[];
  error?: string;
};
export type Summary = {
  avg: number | null;
  loss: number | null;
  jitter: number | null;
  reporting: number;
  total: number;
  reachable: number;
};
export type Dashboard = {
  settings: Settings;
  runs: Run[];
  timezone: string;
  schedule: string[];
};
