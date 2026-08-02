import { canonicalLines } from "@/lib/transport";

type Arrival = {
  vehicleId?: string;
  lineId: string;
  naptanId: string;
  stationName?: string;
  destinationName?: string;
  timeToStation: number;
};

let cache: { expires: number; value: unknown } | null = null;
let lastGood: { generatedAt: string; trains: unknown[] } | null = null;

export async function GET() {
  if (cache && cache.expires > Date.now()) return Response.json(cache.value);
  const batches = await Promise.allSettled(canonicalLines.map(async ([lineId]) => {
    const response = await fetch(`https://api.tfl.gov.uk/Line/${lineId}/Arrivals`, { cache: "no-store" });
    if (!response.ok) return [];
    return await response.json() as Arrival[];
  }));
  const arrivals = batches.flatMap((batch) => batch.status === "fulfilled" ? batch.value : []);
  const trains = Array.from(new Map(arrivals.filter((arrival) => arrival.vehicleId).map((arrival) => [`${arrival.lineId}-${arrival.vehicleId}`, arrival])).values())
    .map((arrival) => ({ id: `${arrival.lineId}-${arrival.vehicleId}`, lineId: arrival.lineId, stationId: arrival.naptanId, destination: arrival.destinationName ?? "Destination unavailable", secondsToStation: arrival.timeToStation }));
  const fresh = { generatedAt: new Date().toISOString(), trains };
  if (trains.length) lastGood = fresh;
  const value = trains.length ? fresh : (lastGood ?? fresh);
  cache = { expires: Date.now() + (trains.length ? 12000 : 30000), value };
  return Response.json(value, { headers: { "Cache-Control": "no-store" } });
}
