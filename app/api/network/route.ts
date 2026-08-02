import { canonicalLines } from "@/lib/transport";

type TfLStop = { id: string; name: string; lat: number; lon: number };
type TfLSequence = { direction: string; branchId: number; stopPoint: TfLStop[] };
type TfLRoute = { stopPointSequences?: TfLSequence[] };

let networkCache: { expires: number; value: unknown } | null = null;

export async function GET() {
  if (networkCache && networkCache.expires > Date.now()) return Response.json(networkCache.value);

  const results = await Promise.allSettled(canonicalLines.map(async ([id, name, color]) => {
    const response = await fetch(`https://api.tfl.gov.uk/Line/${id}/Route/Sequence/all`, {
      next: { revalidate: 86400 }
    });
    if (!response.ok) throw new Error(`${id}: ${response.status}`);
    const data = await response.json() as TfLRoute;
    const branches = (data.stopPointSequences ?? [])
      .filter((sequence) => sequence.stopPoint.length > 1)
      .map((sequence, index) => ({
        id: `${id}-${sequence.direction}-${sequence.branchId}-${index}`,
        coordinates: sequence.stopPoint.map((stop) => [stop.lon, stop.lat] as [number, number])
      }));
    const stations = (data.stopPointSequences ?? []).flatMap((sequence) => sequence.stopPoint.map((stop) => ({
      id: stop.id,
      name: stop.name.replace(/ (Underground|Rail|DLR|Tram Stop|Overground) Station$/i, ""),
      coordinates: [stop.lon, stop.lat] as [number, number]
    })));
    return { id, name, color, branches, stations };
  }));

  const lines = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const stations = Array.from(new Map(lines.flatMap((line) => line.stations).map((station) => [station.id, station])).values());
  const value = { generatedAt: new Date().toISOString(), lines: lines.map(({ stations: _stations, ...line }) => line), stations };
  networkCache = { expires: Date.now() + 86400000, value };
  return Response.json(value, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
}
