import { z } from "zod";

export type ServiceStatus =
  | "Good Service"
  | "Minor Delays"
  | "Severe Delays"
  | "Part Suspended"
  | "Suspended"
  | "Part Closure"
  | "Planned Closure"
  | "Service Closed";

export type LineStatus = {
  id: string;
  name: string;
  color: string;
  status: ServiceStatus;
  reason?: string;
  updatedAt: string;
};

export type Departure = {
  id: string;
  lineId: string;
  lineName: string;
  destination: string;
  platform: string;
  expectedArrival: string;
  secondsToArrival: number;
  status: "Live" | "Predicted" | "Estimated" | "Cached";
};

export type Disruption = {
  id: string;
  lineId: string;
  lineName: string;
  severity: ServiceStatus;
  description: string;
  affectedStops: string[];
  timestamp: string;
};

export type Vehicle = {
  id: string;
  lineId: string;
  lineName: string;
  color: string;
  from: [number, number];
  to: [number, number];
  progress: number;
  destination: string;
  nextStation: string;
  status: "Predicted" | "Estimated";
};

export type TransportSnapshot = {
  generatedAt: string;
  lastSuccessfulSync: string;
  connection: "Live" | "Delayed" | "Offline" | "Cached";
  apiLatencyMs: number;
  sourceMode: "TfL" | "Mock";
  lines: LineStatus[];
  departures: Departure[];
  disruptions: Disruption[];
  vehicles: Vehicle[];
  stats: {
    healthScore: number;
    monitoredStations: number;
    monitoredServices: number;
    activeServices: number;
    currentDisruptions: number;
    severeDisruptions: number;
    plannedClosures: number;
    linesGood: number;
    linesDelayed: number;
  };
  crowding: Array<{ id: string; name: string; lineId: string; level: string; value: number; label: "Estimated" | "Historical" }>;
  updates: Disruption[];
  weather: { temperatureC: number | null; condition: string; windKph?: number; source: "Open-Meteo" | "Unavailable" };
};

export const canonicalLines = [
  ["bakerloo", "Bakerloo", "#B36305"],
  ["central", "Central", "#E32017"],
  ["circle", "Circle", "#FFD300"],
  ["district", "District", "#00782A"],
  ["hammersmith-city", "Hammersmith & City", "#F3A9BB"],
  ["jubilee", "Jubilee", "#A0A5A9"],
  ["metropolitan", "Metropolitan", "#9B0056"],
  ["northern", "Northern", "#000000"],
  ["piccadilly", "Piccadilly", "#003688"],
  ["victoria", "Victoria", "#0098D4"],
  ["waterloo-city", "Waterloo & City", "#95CDBA"],
  ["elizabeth", "Elizabeth line", "#6950A1"],
  ["dlr", "DLR", "#00A4A7"],
  ["london-overground", "London Overground", "#EE7C0E"],
  ["tram", "Tram", "#84B817"]
] as const;

const statusSchema = z.array(z.object({
  id: z.string(),
  name: z.string(),
  lineStatuses: z.array(z.object({
    statusSeverityDescription: z.string(),
    reason: z.string().optional()
  })).optional()
}));

const arrivalsSchema = z.array(z.object({
  id: z.string().optional(),
  lineId: z.string(),
  lineName: z.string(),
  destinationName: z.string().optional(),
  platformName: z.string().optional(),
  expectedArrival: z.string(),
  timeToStation: z.number(),
  stationName: z.string().optional()
}));

const cache = new Map<string, { expires: number; value: unknown }>();
let lastSnapshot: TransportSnapshot | null = null;

async function cached<T>(key: string, ttlMs: number, factory: () => Promise<T>) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await factory();
  cache.set(key, { expires: Date.now() + ttlMs, value });
  return value;
}

async function tfl<T>(path: string, schema: z.ZodType<T>) {
  const params = new URLSearchParams();
  if (process.env.TFL_APP_ID) params.set("app_id", process.env.TFL_APP_ID);
  if (process.env.TFL_APP_KEY) params.set("app_key", process.env.TFL_APP_KEY);
  const url = `https://api.tfl.gov.uk${path}${params.size ? `?${params}` : ""}`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`TfL ${res.status}`);
  return schema.parse(await res.json());
}

function score(lines: LineStatus[]) {
  const penalty: Record<string, number> = {
    "Minor Delays": 2,
    "Severe Delays": 6,
    "Part Suspended": 8,
    "Suspended": 15,
    "Part Closure": 8,
    "Planned Closure": 4,
    "Service Closed": 12,
    "Good Service": 0
  };
  return Math.max(0, Math.min(100, 100 - lines.reduce((sum, line) => sum + (penalty[line.status] ?? 3), 0)));
}

function makeVehicles(lines: LineStatus[]): Vehicle[] {
  const now = Date.now() / 1000;
  const points: [number, number][] = [[-0.33, 51.515], [-0.18, 51.53], [-0.09, 51.505], [0.02, 51.52], [0.16, 51.505], [-0.13, 51.48], [-0.02, 51.56]];
  return lines.slice(0, 12).flatMap((line, i) => [0, 1].map((n) => {
    const from = points[(i + n) % points.length];
    const to = points[(i + n + 2) % points.length];
    return { id: `${line.id}-${n}`, lineId: line.id, lineName: line.name, color: line.color, from, to, progress: (Math.sin(now / 18 + i + n) + 1) / 2, destination: "Central London", nextStation: "Estimated next stop", status: "Estimated" as const };
  }));
}

async function weather() {
  try {
    const data = await cached("weather", 600000, async () => {
      const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=51.5072&longitude=-0.1276&current=temperature_2m,weather_code,wind_speed_10m");
      if (!res.ok) throw new Error("weather");
      return res.json();
    }) as { current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number } };
    return { temperatureC: data.current?.temperature_2m ?? null, condition: weatherCode(data.current?.weather_code), windKph: data.current?.wind_speed_10m, source: "Open-Meteo" as const };
  } catch {
    return { temperatureC: null, condition: "Weather unavailable", source: "Unavailable" as const };
  }
}

function weatherCode(code?: number) {
  if (code === undefined) return "Unavailable";
  if (code < 3) return "Clear";
  if (code < 50) return "Cloudy";
  if (code < 70) return "Rain";
  if (code < 80) return "Snow";
  return "Showers";
}

export async function getSnapshot(): Promise<TransportSnapshot> {
  if (process.env.USE_MOCK_DATA === "true") return mockSnapshot();
  const started = Date.now();
  try {
    const [rawLines, rawArrivals, wx] = await Promise.all([
      cached("line-status", 20000, () => tfl("/Line/Mode/tube,dlr,overground,elizabeth-line,tram/Status", statusSchema)),
      cached("arrivals-kx", 10000, () => tfl("/StopPoint/940GZZLUKSX/Arrivals", arrivalsSchema)),
      weather()
    ]);
    const color = new Map<string, string>(canonicalLines.map(([id, , c]) => [id, c]));
    const lines = rawLines.map((line) => ({
      id: line.id,
      name: line.name,
      color: color.get(line.id) ?? "#5eead4",
      status: (line.lineStatuses?.[0]?.statusSeverityDescription ?? "Good Service") as ServiceStatus,
      reason: line.lineStatuses?.[0]?.reason,
      updatedAt: new Date().toISOString()
    }));
    const departures = rawArrivals.sort((a, b) => a.timeToStation - b.timeToStation).slice(0, 8).map((a) => ({
      id: a.id ?? `${a.lineId}-${a.expectedArrival}`,
      lineId: a.lineId,
      lineName: a.lineName,
      destination: a.destinationName ?? "Check front of train",
      platform: a.platformName ?? "TBC",
      expectedArrival: a.expectedArrival,
      secondsToArrival: a.timeToStation,
      status: "Predicted" as const
    }));
    const disruptions = lines.filter((l) => l.status !== "Good Service").map((l) => ({ id: l.id, lineId: l.id, lineName: l.name, severity: l.status, description: l.reason ?? l.status, affectedStops: [], timestamp: l.updatedAt }));
    const snapshot = finalize(lines, departures, disruptions, wx, Date.now() - started, "TfL", "Live");
    lastSnapshot = snapshot;
    return snapshot;
  } catch {
    if (lastSnapshot) return { ...lastSnapshot, generatedAt: new Date().toISOString(), connection: "Cached" };
    return mockSnapshot("Delayed");
  }
}

function finalize(lines: LineStatus[], departures: Departure[], disruptions: Disruption[], wx: TransportSnapshot["weather"], latency: number, sourceMode: "TfL" | "Mock", connection: TransportSnapshot["connection"]): TransportSnapshot {
  const healthScore = score(lines);
  return {
    generatedAt: new Date().toISOString(),
    lastSuccessfulSync: new Date().toISOString(),
    connection,
    apiLatencyMs: latency,
    sourceMode,
    lines,
    departures,
    disruptions,
    vehicles: makeVehicles(lines),
    updates: disruptions.slice(0, 6),
    crowding: lines.slice(0, 5).map((l, i) => ({ id: l.id, name: l.name, lineId: l.id, level: ["Quiet", "Moderate", "Busy", "Very Busy", "Moderate"][i], value: [31, 56, 72, 88, 54][i], label: "Estimated" })),
    weather: wx,
    stats: {
      healthScore,
      monitoredStations: 272,
      monitoredServices: lines.length,
      activeServices: lines.filter((l) => l.status !== "Service Closed" && l.status !== "Suspended").length,
      currentDisruptions: disruptions.length,
      severeDisruptions: disruptions.filter((d) => d.severity.includes("Severe") || d.severity.includes("Suspended")).length,
      plannedClosures: disruptions.filter((d) => d.severity.includes("Closure")).length,
      linesGood: lines.filter((l) => l.status === "Good Service").length,
      linesDelayed: lines.filter((l) => l.status !== "Good Service").length
    }
  };
}

export function mockSnapshot(connection: TransportSnapshot["connection"] = "Live"): TransportSnapshot {
  const statuses: ServiceStatus[] = ["Good Service", "Minor Delays", "Good Service", "Good Service", "Good Service", "Severe Delays"];
  const lines = canonicalLines.map(([id, name, color], i) => ({ id, name, color, status: statuses[(i + Math.floor(Date.now() / 45000)) % statuses.length], reason: undefined, updatedAt: new Date().toISOString() }));
  const disruptions = lines.filter((l) => l.status !== "Good Service").map((l) => ({ id: `mock-${l.id}`, lineId: l.id, lineName: l.name, severity: l.status, description: `${l.status} reported by mock mode for UI development.`, affectedStops: ["Central London"], timestamp: new Date().toISOString() }));
  const departures = lines.slice(0, 7).map((l, i) => ({ id: `dep-${l.id}`, lineId: l.id, lineName: l.name, destination: ["Abbey Wood", "Walthamstow Central", "Edgware Road", "High Barnet"][i % 4], platform: `${(i % 5) + 1}`, expectedArrival: new Date(Date.now() + (i + 1) * 60000).toISOString(), secondsToArrival: (i + 1) * 60, status: "Estimated" as const }));
  return finalize(lines, departures, disruptions, { temperatureC: 16, condition: "Light Rain", windKph: 11, source: "Open-Meteo" }, 12, "Mock", connection);
}
