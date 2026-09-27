"use client";

import { useEffect, useRef, useState } from "react";
import type { MapShapes } from "@/lib/collector/geo";
import { I } from "./icons";
import { CAT_COL, type Row } from "./lib";

export interface MapStation { id: string; name: string; kind: "aqi" | "rain" | "lake"; lat: number; lon: number; label: string }

export const STATION_STYLE: Record<MapStation["kind"], { color: string; letter: string; title: string }> = {
  aqi: { color: "#16A06A", letter: "A", title: "Air quality station" },
  rain: { color: "#1560E8", letter: "R", title: "Rain gauge" },
  lake: { color: "#0891B2", letter: "L", title: "Lake / reservoir" }
};

interface Props {
  shapes: MapShapes;
  /** incidents per zone, for the density shading */
  zoneCounts: Record<string, number>;
  pins: Row[];
  zone: number | null;
  layers: Record<string, boolean>;
  stations: MapStation[];
  onZone: (zone: number) => void;
  onPin: (id: string) => void;
  onStation: (s: MapStation) => void;
  onTip: (html: string | null, e?: React.MouseEvent) => void;
  zoneTip: (zone: number) => string;
}

interface View { k: number; x: number; y: number }
const HOME: View = { k: 1, x: 0, y: 0 };
const MAX_K = 10;

export default function MapSvg({ shapes, zoneCounts, pins, zone, layers, stations, onZone, onPin, onStation, onTip, zoneTip }: Props) {
  const W = shapes.width, H = shapes.height;
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>(HOME);
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const mx = Math.max(1, ...Object.values(zoneCounts));
  const level = (z: number) => {
    const c = zoneCounts[z] || 0;
    return c === 0 ? 0 : Math.min(4, 1 + Math.floor((c / mx) * 3.999));
  };
  const { proj } = shapes;
  const X = (lon: number) => (lon - proj.lon0) * proj.kx;
  const Y = (lat: number) => (proj.lat0 - lat) * proj.ky;

  const clamp = (v: View): View => {
    const k = Math.max(1, Math.min(MAX_K, v.k));
    // keep at least a quarter of the map on screen
    const x = Math.min(W * 0.75, Math.max(W * 0.25 - W * k, v.x));
    const y = Math.min(H * 0.75, Math.max(H * 0.25 - H * k, v.y));
    return k === 1 && Math.abs(x) < 1 && Math.abs(y) < 1 ? HOME : { k, x, y };
  };

  /** Screen point -> SVG user units (handles letterboxing from preserveAspectRatio="meet"). */
  const toSvg = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const s = Math.min(r.width / W, r.height / H);
    return { x: (cx - r.left - (r.width - W * s) / 2) / s, y: (cy - r.top - (r.height - H * s) / 2) / s, s };
  };

  const zoomAt = (px: number, py: number, factor: number) =>
    setView((v) => {
      const k = Math.max(1, Math.min(MAX_K, v.k * factor));
      const f = k / v.k;
      return clamp({ k, x: px - (px - v.x) * f, y: py - (py - v.y) * f });
    });

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      zoomAt(p.x, p.y, e.deltaY < 0 ? 1.25 : 0.8);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Zoom to the selected zone; back to the whole district when cleared.
  useEffect(() => {
    const z = zone ? shapes.zones.find((s) => s.zone === zone) : null;
    if (!z) { setView(HOME); return; }
    const [x0, y0, x1, y1] = z.box;
    const k = Math.min(MAX_K, Math.max(1, Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.7));
    setView(clamp({ k, x: W / 2 - ((x0 + x1) / 2) * k, y: H / 2 - ((y0 + y1) / 2) * k }));
  }, [zone, shapes]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
    const s = toSvg(0, 0).s;
    setView(clamp({ k: d.v.k, x: d.v.x + dx / s, y: d.v.y + dy / s }));
    onTip(null);
  };
  const onPointerUp = () => {
    if (drag.current?.moved) {
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
    }
    drag.current = null;
  };
  const click = (fn: () => void) => () => { if (!suppressClick.current) fn(); };

  const k = view.k;
  const shown = pins.filter((p) => p.lat != null && layers[p.cat]).slice(0, k > 2 ? 150 : 90).reverse();
  const pinScale = (sev: string) => (sev === "Severe" ? 0.95 : 0.8) / Math.sqrt(k);

  return (
    <>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="map-svg" preserveAspectRatio="xMidYMid meet" role="img"
        aria-label="Chennai district map by zone. Scroll or use the buttons to zoom, drag to move."
        style={{ cursor: drag.current?.moved ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onMouseLeave={() => onTip(null)}>
        <rect width={W} height={H} fill="var(--map-out)" />
        <g transform={`translate(${view.x.toFixed(2)},${view.y.toFixed(2)}) scale(${k.toFixed(4)})`}>
          <polygon fill="url(#gSea)" points={shapes.sea} />
          {k === 1 && Array.from({ length: 7 }, (_, n) => (
            <path key={n} d={`M${478 + (n % 2) * 22} ${50 + n * 70} q9 -6 18 0 t18 0`} fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="1.3" />
          ))}
          <g>
            {shapes.wards.map((w) => (
              <path key={w.ward} d={w.d} vectorEffect="non-scaling-stroke"
                className={`ward lv${level(w.zone)}${zone === w.zone ? " sel" : ""}${zone && zone !== w.zone ? " dim" : ""}`}
                onClick={click(() => onZone(w.zone))}
                onMouseMove={(e) => !drag.current && onTip(zoneTip(w.zone) + (k > 2.5 ? `<br><span style="opacity:.7">Ward ${w.ward}</span>` : ""), e)} />
            ))}
          </g>
          <g>{shapes.zones.map((z) => <path key={z.zone} d={z.d} className="zone-edge" vectorEffect="non-scaling-stroke" />)}</g>
          {shapes.zones.map((z) => (
            <text key={z.zone} className={`rl${zone === z.zone ? " selr" : ""}`} x={z.x} y={z.y} textAnchor="middle"
              style={{ fontSize: (zone === z.zone ? 13 : 9) / Math.sqrt(k), strokeWidth: 2.5 / Math.sqrt(k) }}>
              {z.name}
            </text>
          ))}
          {k === 1 && (
            <>
              <text className="sea-l" x="510" y="265" textAnchor="middle">Bay of</text>
              <text className="sea-l" x="510" y="284" textAnchor="middle">Bengal</text>
            </>
          )}
          {shown.map((p) => {
            const col = CAT_COL[p.cat];
            const open = Number(p.open) === 1;
            return (
              <g key={p.id} className={`pin${open ? "" : " faded"}`}
                transform={`translate(${X(p.lon).toFixed(1)},${Y(p.lat).toFixed(1)}) scale(${pinScale(p.sev).toFixed(3)})`}
                onClick={(e) => { e.stopPropagation(); if (!suppressClick.current) onPin(p.id); }}
                onMouseMove={(e) => { e.stopPropagation(); if (!drag.current) onTip(`<b>${esc(p.title ?? "Incident")}</b>${esc(p.sev)} · ${esc(p.status)}`, e); }}>
                {open && p.sev === "Severe" && <circle className="pulse" cy="-1" r="7" fill={col} />}
                <path d="M0 0C-4 -6 -8 -9.5 -8 -14a8 8 0 0 1 16 0c0 4.5-4 8-8 14z" fill={col} stroke="#fff" strokeWidth="1.8" />
                <circle cy="-14" r="3" fill="#fff" />
              </g>
            );
          })}
          {layers.stations && stations.map((st) => {
            const sty = STATION_STYLE[st.kind];
            const sc = 1 / Math.sqrt(k);
            return (
              <g key={st.kind + st.id} transform={`translate(${X(st.lon).toFixed(1)},${Y(st.lat).toFixed(1)}) scale(${sc.toFixed(3)})`}
                style={{ cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); if (!suppressClick.current) onStation(st); }}
                onMouseMove={(e) => { e.stopPropagation(); if (!drag.current) onTip(`<b>${esc(st.name)}</b>${sty.title} · ${esc(st.label)}`, e); }}>
                <rect x="-7" y="-7" width="14" height="14" rx="3.5" fill={sty.color} stroke="#fff" strokeWidth="1.8" />
                <text y="3.6" textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#fff" style={{ fontFamily: "var(--dic-display)", pointerEvents: "none" }}>
                  {sty.letter}
                </text>
              </g>
            );
          })}
        </g>
        {k === 1 && (
          <g transform="translate(522,120)" style={{ pointerEvents: "none" }}>
            <circle r="17" fill="#fff" fillOpacity=".85" />
            <path d="M0 -12 L6 6 L0 2 L-6 6Z" fill="#0B3FA8" />
            <text y="-19" textAnchor="middle" fontSize="11" fontWeight="800" fill="#0B3FA8" style={{ fontFamily: "var(--dic-display)" }}>N</text>
          </g>
        )}
      </svg>
      <div className="map-tools">
        <button onClick={() => zoomAt(W / 2, H / 2, 1.5)} title="Zoom in" aria-label="Zoom in" disabled={k >= MAX_K}><I n="plus" /></button>
        <button onClick={() => zoomAt(W / 2, H / 2, 1 / 1.5)} title="Zoom out" aria-label="Zoom out" disabled={k <= 1}><span className="zminus" /></button>
        <button onClick={() => setView(HOME)} title="Show the whole district" aria-label="Reset zoom" disabled={k === 1}><I n="expand" /></button>
      </div>
      {k > 1 && <div className="map-zoom-note">{k.toFixed(1)}× · drag to move</div>}
    </>
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
