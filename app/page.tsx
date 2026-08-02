"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, CloudRain, Crosshair, Expand, HeartPulse, LocateFixed, Minus, Plus, RefreshCcw, Search, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { TransportSnapshot } from "@/lib/transport";

type NetworkData = {
  lines: Array<{ id: string; name: string; color: string; branches: Array<{ id: string; coordinates: [number, number][] }> }>;
  stations: Array<{ id: string; name: string; coordinates: [number, number] }>;
};
type LiveTrain = { id: string; lineId: string; stationId: string; destination: string; secondsToStation: number };

const fallbackLines = [
  ["bakerloo", "Bakerloo", "#B36305"], ["central", "Central", "#E32017"], ["circle", "Circle", "#FFD300"], ["district", "District", "#00782A"],
  ["hammersmith-city", "Hammersmith & City", "#F3A9BB"], ["jubilee", "Jubilee", "#A0A5A9"], ["metropolitan", "Metropolitan", "#9B0056"], ["northern", "Northern", "#111827"],
  ["piccadilly", "Piccadilly", "#003688"], ["victoria", "Victoria", "#0098D4"], ["waterloo-city", "Waterloo & City", "#95CDBA"], ["elizabeth", "Elizabeth line", "#6950A1"],
  ["dlr", "DLR", "#00A4A7"], ["london-overground", "London Overground", "#EE7C0E"], ["tram", "Tram", "#84B817"]
];

export default function Home() {
  const [snapshot, setSnapshot] = useState<TransportSnapshot | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [openLeft, setOpenLeft] = useState<Record<string, boolean>>({ lines: false, updates: false, overview: false });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await fetch("/api/snapshot", { cache: "no-store" });
      const data = await res.json();
      if (alive) setSnapshot(data);
    };
    load();
    const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const lines = snapshot?.lines ?? fallbackLines.map(([id, name, color]) => ({ id, name, color, status: "Loading..." as any, updatedAt: "" }));
  const visibleLines = lines.filter((line) => line.name.toLowerCase().includes(query.toLowerCase()));
  const disruptions = snapshot?.disruptions ?? [];
  const statusText = snapshot?.connection === "Live" ? "LIVE" : snapshot?.connection ? `CONNECTION ${snapshot.connection.toUpperCase()}` : "CONNECTING";

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <PulseLogo score={snapshot?.stats.healthScore ?? 80} />
          <div><h1>London <span>Transport Pulse</span></h1></div>
        </div>
        <div className="header-metrics">
          <Metric icon={<span className={snapshot?.connection === "Live" ? "live-dot" : "warn-dot"} />} label={statusText} value={snapshot ? londonTime(snapshot.generatedAt) : "--:--:--"} />
          <Metric icon={<CloudRain />} label={snapshot?.weather.condition ?? "Weather"} value={snapshot?.weather.temperatureC == null ? "--" : `${Math.round(snapshot.weather.temperatureC)}°C`} />
          <Metric label="Network Health" value={`${snapshot?.stats.healthScore ?? "--"}/100`} accent={healthWord(snapshot?.stats.healthScore)} />
          <Metric label="Active Services" value={String(snapshot?.stats.activeServices ?? "--")} accent={`${snapshot?.stats.currentDisruptions ?? 0} disruptions`} />
        </div>
      </header>

      <section className="grid">
        <aside className="panel lines">
          <PanelTitle title="Controls" />
          <Collapsible title="Lines" meta={`${visibleLines.length}`} open={openLeft.lines} onToggle={() => setOpenLeft((value) => ({ ...value, lines: !value.lines }))}>
            <label className="search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search lines" /></label>
            <div className="line-actions"><button onClick={() => setSelected(lines.map((l) => l.id))}>Show all</button><button onClick={() => setSelected([])}>Hide all</button><button onClick={() => setSelected([])}><RefreshCcw size={14} /> Reset</button></div>
            <div className="lines-scroll">
              {visibleLines.map((line) => (
                <button className={`line-row ${selected.includes(line.id) ? "selected" : ""}`} key={line.id} onClick={() => setSelected((s) => s.includes(line.id) ? s.filter((x) => x !== line.id) : [...s, line.id])}>
                  <span className="line-roundel" style={{ "--line-color": line.color } as CSSProperties}><i /></span><span className="line-copy">{line.name}<small>{line.status}</small></span><b className={line.status === "Good Service" ? "ok" : "delay"} />
                </button>
              ))}
            </div>
          </Collapsible>
          <Collapsible title="Live Updates" meta={`${snapshot?.updates?.length ?? 0} alerts`} open={openLeft.updates} onToggle={() => setOpenLeft((value) => ({ ...value, updates: !value.updates }))}>
            <UpdatesList disruptions={snapshot?.updates ?? []} />
          </Collapsible>
          <Collapsible title="Network Overview" open={openLeft.overview} onToggle={() => setOpenLeft((value) => ({ ...value, overview: !value.overview }))}>
            <Overview snapshot={snapshot} embedded />
          </Collapsible>
        </aside>

        <section className="center">
          <div className="panel map-panel">
            <PanelTitle title="Live Network Map" subtitle="Vehicle markers are estimated from TfL predictions where GPS is unavailable." />
            <NetworkMap snapshot={snapshot} selected={selected} />
          </div>
          <div className="lower-grid">
            <Disruptions disruptions={disruptions} lines={lines} />
            <Crowding snapshot={snapshot} />
          </div>
        </section>
      </section>
      <footer>Data provided by Transport for London. Weather from Open-Meteo. Last successful sync: {snapshot ? londonTime(snapshot.lastSuccessfulSync) : "pending"}. App version 1.0.0. API health: {snapshot?.connection ?? "Connecting"}.</footer>
    </main>
  );
}

function NetworkMap({ snapshot, selected }: { snapshot: TransportSnapshot | null; selected: string[] }) {
  const el = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; focus: [number, number] } | null>(null);
  const [network, setNetwork] = useState<NetworkData | null>(null);
  const [liveTrains, setLiveTrains] = useState<LiveTrain[]>([]);
  const [zoom, setZoom] = useState(1.16);
  const [focus, setFocus] = useState<[number, number]>([520, 276]);
  useEffect(() => {
    fetch("/api/network").then((response) => response.json()).then(setNetwork).catch(() => setNetwork(null));
  }, []);
  useEffect(() => {
    let active = true;
    const load = () => fetch("/api/vehicles").then((response) => response.json()).then((data) => { if (active) setLiveTrains(data.trains ?? []); }).catch(() => undefined);
    load();
    const timer = setInterval(load, 15000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const project = ([lon, lat]: [number, number]) => {
    const x = ((lon + .75) / 1.1) * 1000;
    const y = ((51.72 - lat) / .47) * 560;
    const core: [number, number] = [555, 285];
    const dx = x - core[0];
    const dy = y - core[1];
    const distance = Math.hypot(dx, dy);
    const expansion = 1 + .55 * Math.max(0, 1 - distance / 270);
    return [core[0] + dx * expansion, core[1] + dy * expansion] as const;
  };
  const trainPoints = network ? liveTrains.flatMap((train) => {
      const line = network.lines.find((item) => item.id === train.lineId);
      const station = network.stations.find((item) => item.id === train.stationId);
      if (!line || !station || (selected.length && !selected.includes(train.lineId))) return [];
      const branch = line.branches.find((item) => item.coordinates.some((point) => point[0] === station.coordinates[0] && point[1] === station.coordinates[1]));
      const stationIndex = branch?.coordinates.findIndex((point) => point[0] === station.coordinates[0] && point[1] === station.coordinates[1]) ?? -1;
      const destination = station.coordinates;
      const previous = branch && stationIndex > 0 ? branch.coordinates[stationIndex - 1] : destination;
      const progress = Math.max(.08, 1 - Math.min(train.secondsToStation / 150, .92));
      const coordinates: [number, number] = [previous[0] + (destination[0] - previous[0]) * progress, previous[1] + (destination[1] - previous[1]) * progress];
      return [{ ...train, lineName: line.name, color: line.color, coordinates: project(coordinates) }];
    }) : [];
  const fallbackTrainPoints = !network || liveTrains.length ? [] : network.lines.flatMap((line) => line.branches.flatMap((branch, index) => {
    if (branch.coordinates.length < 2 || (selected.length && !selected.includes(line.id))) return [];
    const point = branch.coordinates[Math.floor(((index * 0.37 + .42) % 1) * (branch.coordinates.length - 1))];
    return [{ id: `estimated-${branch.id}`, lineName: line.name, destination: "Estimated movement", color: line.color, coordinates: project(point) }];
  }));
  const displayedTrains = trainPoints.length ? trainPoints : fallbackTrainPoints;
  const viewWidth = 1000 / zoom;
  const viewHeight = 560 / zoom;
  const viewBox = `${focus[0] - viewWidth / 2} ${focus[1] - viewHeight / 2} ${viewWidth} ${viewHeight}`;
  const startDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, focus };
  };
  const moveDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId || !el.current) return;
    const bounds = el.current.getBoundingClientRect();
    const dx = ((event.clientX - drag.current.x) / bounds.width) * viewWidth;
    const dy = ((event.clientY - drag.current.y) / bounds.height) * viewHeight;
    setFocus([drag.current.focus[0] - dx, drag.current.focus[1] - dy]);
  };
  const endDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current?.id === event.pointerId) drag.current = null;
  };
  return (
    <div className="map-wrap" ref={el}>
      <svg className="network-svg" viewBox={viewBox} role="img" aria-label="Full London transport network map" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerLeave={endDrag}>
        <g className="route-casings">{network?.lines.flatMap((line) => line.branches.map((branch) => <polyline key={branch.id} points={branch.coordinates.map((point) => project(point).join(",")).join(" ")} className={selected.length && !selected.includes(line.id) ? "dim" : ""} />))}</g>
        <g className="network-routes">{network?.lines.flatMap((line) => line.branches.map((branch) => <polyline key={branch.id} points={branch.coordinates.map((point) => project(point).join(",")).join(" ")} stroke={line.color} className={selected.length && !selected.includes(line.id) ? "dim" : ""} />))}</g>
        <g className="network-stations">{network?.stations.map((station) => { const [x,y] = project(station.coordinates); return <g className="station-node" key={station.id}><circle className="station-hit" cx={x} cy={y} r="8" /><circle className="station-dot" cx={x} cy={y} r={zoom > 1.5 ? 1.9 : 1.25} /><text x={x + 5} y={y - 5}>{station.name}</text></g>; })}</g>
        <g className="network-trains">{displayedTrains.map((vehicle) => <rect key={vehicle.id} x={vehicle.coordinates[0] - 5} y={vehicle.coordinates[1] - 2.4} width="10" height="4.8" rx="2" fill={vehicle.color}><title>{vehicle.lineName} toward {vehicle.destination}</title></rect>)}</g>
      </svg>
      {!network && <div className="map-loading">Loading the full TfL network...</div>}
      <div className="map-controls"><button title="Zoom in" onClick={() => setZoom((value) => Math.min(3.2, value + .35))}><Plus /></button><button title="Zoom out" onClick={() => setZoom((value) => Math.max(1, value - .35))}><Minus /></button><button title="Reset map" onClick={() => { setZoom(1.16); setFocus([520,276]); }}><Crosshair /></button><button title="Central London" onClick={() => { setZoom(2.05); setFocus([555,285]); }}><LocateFixed /></button><button title="Full screen" onClick={() => el.current?.requestFullscreen()}><Expand /></button></div>
      <div className="legend"><HeartPulse size={18} /><span><b>Live movement</b><small>Trains update every 15 seconds</small></span></div>
    </div>
  );
}

function Disruptions({ disruptions, lines }: any) {
  return <div className="panel"><PanelTitle title="Disruptions" />{disruptions.length ? disruptions.slice(0, 4).map((d: any) => {
    const color = lines.find((line: any) => line.id === d.lineId)?.color ?? "#f59e0b";
    return <div className="data-row disruption-row" key={d.id}><span className="line-roundel" style={{ "--line-color": color } as CSSProperties}><i /></span><span><b>{d.lineName}</b><small>{d.description}</small></span><em>{d.severity}</em></div>;
  }) : <p className="empty">No disruptions currently reported.</p>}</div>;
}

function Crowding({ snapshot }: any) {
  return <div className="panel"><PanelTitle title="Line Crowding" subtitle="Estimated from service conditions and time of day" />{(snapshot?.crowding ?? []).map((c: any) => <div className="crowd" key={c.id}><span>{c.name}</span><i><b style={{ width: `${c.value}%` }} /></i><em>{c.level}</em></div>)}</div>;
}

function LiveUpdates({ disruptions }: any) {
  const [open, setOpen] = useState(false);
  return <div className={`panel updates-panel ${open ? "open" : ""}`}><button className="updates-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span>Live Updates</span><small>{disruptions.length} alerts</small><ChevronDown size={17} /></button><AnimatePresence initial={false}>{open && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="updates-content"><UpdatesList disruptions={disruptions} /></motion.div>}</AnimatePresence></div>;
}

function UpdatesList({ disruptions }: any) {
  return disruptions.length ? disruptions.map((d: any) => <motion.div layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="update" key={d.id}><XCircle size={16} /><strong>{d.lineName}</strong><time>{londonTime(d.timestamp).slice(0, 5)}</time><p>{d.description}</p></motion.div>) : <p className="empty">No active service alerts.</p>;
}

function Overview({ snapshot, embedded }: { snapshot: TransportSnapshot | null; embedded?: boolean }) {
  const s = snapshot?.stats;
  const content = <>{[["Stations", s?.monitoredStations], ["Services", s?.monitoredServices], ["Active services", s?.activeServices], ["Disruptions", s?.currentDisruptions], ["Severe", s?.severeDisruptions], ["API latency", snapshot ? `${snapshot.apiLatencyMs}ms` : "--"]].map(([k, v]) => <p key={k as string}><span>{k}</span><b>{v ?? "--"}</b></p>)}</>;
  return embedded ? <div className="overview embedded">{content}</div> : <div className="panel overview"><PanelTitle title="Network Overview" />{content}</div>;
}

function PulseLogo({ score }: { score: number }) {
  return <div className="pulse-logo" style={{ "--intensity": `${Math.max(1, (100 - score) / 15)}s` } as any}><img src="/transport-roundel.png" alt="" /></div>;
}
function Metric({ icon, label, value, accent }: any) { return <div className="metric">{icon}<span>{label}</span><b>{value}</b>{accent && <small>{accent}</small>}</div>; }
function PanelTitle({ title, subtitle }: { title: string; subtitle?: string }) { return <div className="panel-title"><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>; }
function Collapsible({ title, meta, open, onToggle, children }: any) { return <section className={`collapse ${open ? "open" : ""}`}><button className="collapse-toggle" onClick={onToggle} aria-expanded={open}><span>{title}</span><small>{meta ?? ""}</small><ChevronDown size={16} /></button><AnimatePresence initial={false}>{open && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="collapse-content">{children}</motion.div>}</AnimatePresence></section>; }
function Row({ color, title, text, right, warn }: any) { return <div className="data-row"><i style={{ background: color ?? (warn ? "#f59e0b" : "#38bdf8") }} /><span><b>{title}</b><small>{text}</small></span><em>{right}</em></div>; }
function londonTime(iso: string) { return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso)); }
function healthWord(score?: number) { return score == null ? "syncing" : score > 89 ? "Good" : score > 70 ? "Watch" : "Disrupted"; }
