"use client";

import type { MapShapes } from "@/lib/collector/geo";
import { CAT_COL, SEV_COL, type Row } from "./lib";

interface Props {
  shapes: MapShapes;
  /** incidents per zone, for the density shading */
  zoneCounts: Record<string, number>;
  pins: Row[];
  zone: number | null;
  /** overview: colour by category and honour layers; department: colour by severity */
  mode: "overview" | "dept";
  layers?: Record<string, boolean>;
  fresh?: string | null;
  onZone: (zone: number) => void;
  onPin: (id: string) => void;
  onTip: (html: string | null, e?: React.MouseEvent) => void;
  zoneTip: (zone: number) => string;
}

export default function MapSvg({ shapes, zoneCounts, pins, zone, mode, layers, fresh, onZone, onPin, onTip, zoneTip }: Props) {
  const mx = Math.max(1, ...Object.values(zoneCounts));
  const level = (z: number) => {
    const c = zoneCounts[z] || 0;
    return c === 0 ? 0 : Math.min(4, 1 + Math.floor((c / mx) * 3.999));
  };
  const { proj } = shapes;
  const X = (lon: number) => (lon - proj.lon0) * proj.kx;
  const Y = (lat: number) => (proj.lat0 - lat) * proj.ky;

  const shown = pins
    .filter((p) => p.lat != null && (mode === "dept" || !layers || layers[p.cat]))
    .slice(0, zone ? 60 : 90)
    .reverse(); // most important drawn last, on top

  return (
    <svg viewBox={`0 0 ${shapes.width} ${shapes.height}`} className="map-svg" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Chennai district map by zone" onMouseLeave={() => onTip(null)}>
      <rect width={shapes.width} height={shapes.height} fill="var(--map-out)" />
      <polygon fill="url(#gSea)" points={shapes.sea} />
      {Array.from({ length: 7 }, (_, k) => (
        <path key={k} d={`M${478 + (k % 2) * 22} ${50 + k * 70} q9 -6 18 0 t18 0`} fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="1.3" />
      ))}
      <g>
        {shapes.wards.map((w) => (
          <path key={w.ward} d={w.d}
            className={`ward lv${level(w.zone)}${zone === w.zone ? " sel" : ""}${zone && zone !== w.zone ? " dim" : ""}`}
            onClick={() => onZone(w.zone)}
            onMouseMove={(e) => onTip(zoneTip(w.zone), e)} />
        ))}
      </g>
      <g>
        {shapes.zones.map((z) => (
          <path key={z.zone} d={z.d} className="zone-edge" />
        ))}
      </g>
      {shapes.zones.map((z) => (
        <text key={z.zone} className={`rl${zone === z.zone ? " selr" : ""}`} x={z.x} y={z.y} textAnchor="middle"
          style={{ fontSize: zone === z.zone ? 13 : 9 }}>
          {z.name}
        </text>
      ))}
      <text className="sea-l" x="510" y="265" textAnchor="middle">Bay of</text>
      <text className="sea-l" x="510" y="284" textAnchor="middle">Bengal</text>
      <g transform="translate(522,120)">
        <circle r="17" fill="#fff" fillOpacity=".85" />
        <path d="M0 -12 L6 6 L0 2 L-6 6Z" fill="#0B3FA8" />
        <text y="-19" textAnchor="middle" fontSize="11" fontWeight="800" fill="#0B3FA8" style={{ fontFamily: "var(--dic-display)" }}>N</text>
      </g>
      {shown.map((p) => {
        const col = mode === "dept" ? SEV_COL[p.sev] : CAT_COL[p.cat];
        const open = Number(p.open) === 1;
        const hot = (open && p.sev === "Severe") || p.id === fresh;
        return (
          <g key={p.id} className={`pin${open ? "" : " faded"}`}
            transform={`translate(${X(p.lon).toFixed(1)},${Y(p.lat).toFixed(1)}) scale(${p.sev === "Severe" ? 0.95 : 0.8})`}
            onClick={(e) => {
              e.stopPropagation();
              onPin(p.id);
            }}
            onMouseMove={(e) => {
              e.stopPropagation();
              onTip(`<b>${esc(p.title ?? "Incident")}</b>${esc(p.sev)} · ${esc(p.status)}`, e);
            }}>
            {hot && <circle className="pulse" cy="-1" r="7" fill={col} />}
            <path d="M0 0C-4 -6 -8 -9.5 -8 -14a8 8 0 0 1 16 0c0 4.5-4 8-8 14z" fill={col} stroke="#fff" strokeWidth="1.8" />
            <circle cy="-14" r="3" fill="#fff" />
          </g>
        );
      })}
    </svg>
  );
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

export function MapScale() {
  return (
    <div className="map-scale">
      <span>Incident density</span>
      <div>
        {["--m0", "--m1", "--m2", "--m3", "--m4"].map((c) => (
          <i key={c} style={{ background: `var(${c})` }} />
        ))}
      </div>
      <span style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Low</span>
        <span>High</span>
      </span>
    </div>
  );
}
