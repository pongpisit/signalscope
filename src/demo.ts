import type { Dashboard, Probe, Target } from "../shared/types";

const targets: Target[] = [
  {
    id: "target-1",
    name: "Orbit",
    url: "https://orbit.example",
    hostname: "orbit.example",
  },
  {
    id: "target-2",
    name: "Nova",
    url: "https://nova.example",
    hostname: "nova.example",
  },
  {
    id: "target-3",
    name: "Pulsar",
    url: "https://pulsar.example",
    hostname: "pulsar.example",
  },
];
const locations = [
  ["CN_1", "China, Beijing", "China Telecom", 36],
  ["CN_2", "China, Shanghai", "China Unicom", 42],
  ["CN_3", "China, Guangzhou", "China Mobile", 49],
  ["CN_4", "China, Chengdu", "Tencent", 62],
  ["TH_1", "Thailand, Bangkok", "Sample network", 18],
  ["TH_2", "Thailand, Chiang Mai", "Sample network", 24],
  ["TH_3", "Thailand, Phuket", "Sample network", 31],
  ["SG_1", "Singapore", "Sample network", 27],
  ["JP_1", "Japan, Tokyo", "Sample network", 55],
  ["HK_1", "Hong Kong", "Sample network", 32],
  ["DE_1", "Germany, Frankfurt", "Sample network", 173],
  ["GB_1", "United Kingdom, London", "Sample network", 181],
  ["US_1", "USA, Los Angeles", "Sample network", 194],
  ["US_2", "USA, New York", "Sample network", 231],
] as const;

export function demoDashboard(): Dashboard {
  const today = new Date();
  today.setUTCMinutes(0, 0, 0);
  today.setUTCHours(10);
  if (today > new Date()) today.setUTCDate(today.getUTCDate() - 1);
  return {
    settings: {
      targets,
      enabled: true,
      sampleSeconds: 45,
      cadence: "twice-daily",
      country: "TH",
      timezone: "Asia/Bangkok",
      ignoredNetworks: [],
      globalpingLimit: 30,
    },
    timezone: "Asia/Bangkok",
    schedule: ["08:00", "17:00"],
    runs: Array.from({ length: 14 }, (_, i) => {
      const time = new Date(today);
      time.setUTCDate(time.getUTCDate() - Math.floor(i / 2));
      time.setUTCHours(i % 2 ? 1 : 10);
      const startedAt = time.toISOString();
      return {
        id: `demo-${i}`,
        startedAt,
        completedAt: new Date(+time + 180_000).toISOString(),
        source: "scheduled",
        status: "complete",
        targets,
        results: targets.map((t, j) => ({
          targetId: t.id,
          targetName: t.name,
          hostname: t.hostname,
          status: "complete",
          capturedAt: startedAt,
          sourceUrl: `https://ping.pe/${t.hostname}`,
          evidence: [],
          probes: locations.map(([id, location, provider, base], k): Probe => {
            const avg =
              base * [0.75, 1.14, 1.42][j] +
              Math.sin(i * 1.5 + k) * (j + 2) +
              j * 9;
            return {
              id,
              location,
              provider,
              sent: 9,
              avg,
              best: avg - 3,
              worst: avg + 6,
              loss: j === 2 && (k + i) % 7 === 0 ? 11.1 : 0,
              jitter: 1.2 + j * 1.7 + Math.abs(Math.cos(i + k)) * 2,
            };
          }),
        })),
      };
    }),
  };
}
