"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import type { MapGeo } from "@/lib/collector/geo";
import { I } from "./icons";
import { CAT_COL, type Row } from "./lib";

export interface MapStation { id: string; name: string; kind: "aqi" | "rain" | "lake"; lat: number; lon: number; label: string }

export const STATION_STYLE: Record<MapStation["kind"], { color: string; letter: string; title: string }> = {
  aqi: { color: "#12925F", letter: "A", title: "Air quality station" },
  rain: { color: "#1560E8", letter: "R", title: "Rain gauge" },
  lake: { color: "#0891B2", letter: "L", title: "Lake / reservoir" }
};

interface Props {
  geo: MapGeo | null;
  /** incidents per zone, for the heat shading */
  zoneCounts: Record<string, number>;
  pins: Row[];
  zone: number | null;
  layers: Record<string, boolean>;
  stations: MapStation[];
  /** items from sources the Collector added that name a place (lat/lon of the place) */
  added: Row[];
  /** zones (GCC) or revenue taluks */
  mode: "zones" | "taluks";
  taluk: string | null;
  /** incident to fly to and ring */
  focus: { id: string; lat: number; lon: number } | null;
  onZone: (zone: number) => void;
  onTaluk: (taluk: string) => void;
  onPin: (id: string) => void;
  onStation: (s: MapStation) => void;
  onItem: (item: Row) => void;
  zoneTip: (zone: number) => string;
}

const HEAT = [
  { c: "#000000", o: 0 },
  { c: "#FFD666", o: 0.16 },
  { c: "#FFB020", o: 0.24 },
  { c: "#F2542D", o: 0.32 },
  { c: "#C0122C", o: 0.42 }
];
const TALUK_COL = ["#4D8DFF", "#FFB020", "#22C55E", "#E879F9", "#F97316", "#14B8A6", "#A78BFA", "#F43F5E", "#84CC16",
  "#06B6D4", "#EAB308", "#8B5CF6", "#EF4444", "#10B981", "#3B82F6", "#F59E0B", "#EC4899", "#64748B"];

interface State {
  L: typeof Leaflet;
  map: Leaflet.Map;
  wards: { zone: number; taluk: string | null; poly: Leaflet.Polygon }[];
  zoneLabels: Map<number, Leaflet.Marker>;
  talukLabels: Map<string, Leaflet.Marker>;
  outlines: Leaflet.Polyline[];
  sel: Leaflet.LayerGroup;
  pins: Leaflet.LayerGroup;
  stations: Leaflet.LayerGroup;
  added: Leaflet.LayerGroup;
  focus: Leaflet.LayerGroup;
  district: Leaflet.LatLngBounds;
  zoneBounds: Map<number, Leaflet.LatLngBounds>;
  talukBounds: Map<string, Leaflet.LatLngBounds>;
}

/** Satellite map of the district: ward heat or taluk colours, zone outlines, incident pins and stations. */
export default function SatMap(props: Props) {
  const { geo, zoneCounts, pins, zone, layers, stations, added, mode, taluk, focus } = props;
  const el = useRef<HTMLDivElement>(null);
  const st = useRef<State | null>(null);
  const cb = useRef(props);
  cb.current = props;
  const [ready, setReady] = useState(0);

  // ---- create the map once the outlines are loaded
  useEffect(() => {
    if (!geo || !el.current) return;
    let dead = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (dead || !el.current) return;
      const map = L.map(el.current, { zoomControl: false, zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 9, maxZoom: 18, attributionControl: true });
      map.attributionControl.setPrefix(false);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics"
      }).addTo(map);
      // Road and place names once zoomed in, so the district view stays uncluttered.
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19, minZoom: 13, opacity: 0.55
      }).addTo(map);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19, minZoom: 13, opacity: 0.9
      }).addTo(map);

      const talukName = new Map(geo.taluks.map((t) => [t.code, t.name]));
      const zoneBounds = new Map<number, Leaflet.LatLngBounds>();
      const talukBounds = new Map<string, Leaflet.LatLngBounds>();
      const grow = <K,>(m: Map<K, Leaflet.LatLngBounds>, k: K, b: Leaflet.LatLngBounds) =>
        m.set(k, m.get(k)?.extend(b) ?? L.latLngBounds(b.getSouthWest(), b.getNorthEast()));
      const wards = geo.wards.map((w) => {
        const poly = L.polygon(w.rings, { color: "#FFFFFF", weight: 0.7, opacity: 0.55, fillOpacity: 0 })
          .on("click", () => {
            if (cb.current.mode === "taluks") { if (w.taluk) cb.current.onTaluk(w.taluk); }
            else cb.current.onZone(w.zone);
          })
          .bindTooltip(() => cb.current.mode === "taluks"
            ? `<b>${esc(talukName.get(w.taluk ?? "") ?? "Taluk not known")} taluk</b><span style="opacity:.7">Ward ${w.ward} · click to filter to this taluk</span>`
            : cb.current.zoneTip(w.zone) + `<span style="opacity:.7">Ward ${w.ward}</span>`,
          { sticky: true, className: "dtip", direction: "top", offset: [0, -10] })
          .addTo(map);
        const b = poly.getBounds();
        grow(zoneBounds, w.zone, b);
        if (w.taluk) grow(talukBounds, w.taluk, b);
        return { zone: w.zone, taluk: w.taluk, poly };
      });
      const outlines = geo.zones.map((z) => L.polyline(z.lines, { color: "#FFFFFF", weight: 2.2, opacity: 0.95, interactive: false }).addTo(map));
      const zoneLabels = new Map<number, Leaflet.Marker>();
      for (const z of geo.zones) {
        zoneLabels.set(z.zone, L.marker([z.lat, z.lon], {
          icon: L.divIcon({ className: "", html: `<div class="zlbl">${esc(z.name)}</div>`, iconSize: [0, 0] }), interactive: false, keyboard: false
        }));
      }
      const talukLabels = new Map<string, Leaflet.Marker>();
      for (const t of geo.taluks) {
        const b = talukBounds.get(t.code);
        const at = b ? b.getCenter() : L.latLng(t.lat, t.lon);
        talukLabels.set(t.code, L.marker(at, {
          icon: L.divIcon({ className: "", html: `<div class="zlbl tlbl">${esc(t.name)}</div>`, iconSize: [0, 0] }), interactive: false, keyboard: false
        }));
      }
      const district = L.latLngBounds([]);
      zoneBounds.forEach((b) => district.extend(b));
      map.fitBounds(district, { padding: [8, 8] });

      st.current = {
        L, map, wards, zoneLabels, talukLabels, outlines, zoneBounds, talukBounds, district,
        sel: L.layerGroup().addTo(map),
        pins: L.layerGroup().addTo(map),
        stations: L.layerGroup().addTo(map),
        added: L.layerGroup().addTo(map),
        focus: L.layerGroup().addTo(map)
      };
      ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(el.current);
      setReady((n) => n + 1);
    })();
    return () => {
      dead = true;
      ro?.disconnect();
      st.current?.map.remove();
      st.current = null;
    };
  }, [geo]);

  // ---- shading, labels and the selected zone or taluk
  useEffect(() => {
    const s = st.current;
    if (!s || !geo) return;
    const talukIx = new Map(geo.taluks.map((t, k) => [t.code, k]));
    const mx = Math.max(1, ...Object.values(zoneCounts));
    const level = (z: number) => {
      const c = zoneCounts[z] || 0;
      return c === 0 ? 0 : Math.min(4, 1 + Math.floor((c / mx) * 3.999));
    };
    for (const w of s.wards) {
      if (mode === "taluks") {
        const col = TALUK_COL[(talukIx.get(w.taluk ?? "") ?? 17) % TALUK_COL.length];
        if (taluk && w.taluk !== taluk) w.poly.setStyle({ fillColor: "#020814", fillOpacity: 0.5, opacity: 0.2, color: "#FFFFFF", weight: 0.6 });
        else w.poly.setStyle({ fillColor: col, fillOpacity: taluk ? 0.12 : 0.34, opacity: 0.35, color: "#FFFFFF", weight: 0.5 });
      } else if (zone && w.zone !== zone) w.poly.setStyle({ fillColor: "#020814", fillOpacity: 0.5, opacity: 0.25 });
      else if (zone) w.poly.setStyle({ fillColor: "#FFE08A", fillOpacity: 0.06, opacity: 0.7 });
      else {
        const h = HEAT[level(w.zone)];
        w.poly.setStyle({ fillColor: h.c, fillOpacity: h.o, opacity: 0.55 });
      }
    }
    for (const o of s.outlines) o.setStyle({ opacity: mode === "taluks" ? 0.35 : 0.95, weight: mode === "taluks" ? 1.2 : 2.2 });
    s.zoneLabels.forEach((m, z) => {
      if (mode === "zones") {
        m.addTo(s.map);
        const e = m.getElement()?.firstElementChild as HTMLElement | undefined;
        if (e) {
          e.className = `zlbl${zone === z ? " zsel" : ""}`;
          e.style.opacity = zone && zone !== z ? "0.45" : "1";
        }
      } else m.remove();
    });
    s.talukLabels.forEach((m, code) => {
      if (mode === "taluks") {
        m.addTo(s.map);
        const e = m.getElement()?.firstElementChild as HTMLElement | undefined;
        if (e) {
          e.className = `zlbl tlbl${taluk === code ? " zsel" : ""}`;
          e.style.opacity = taluk && taluk !== code ? "0.45" : "1";
        }
      } else m.remove();
    });
    s.sel.clearLayers();
    let target: Leaflet.LatLngBounds | undefined;
    if (mode === "taluks" && taluk) target = s.talukBounds.get(taluk);
    else if (zone) {
      const g = geo.zones.find((z) => z.zone === zone);
      if (g) s.L.polyline(g.lines, { color: "#FFD24A", weight: 4, opacity: 1, interactive: false }).addTo(s.sel);
      target = s.zoneBounds.get(zone);
    }
    if (!cb.current.focus) s.map.flyToBounds(target ?? s.district, { padding: target ? [24, 24] : [8, 8], duration: 0.6 });
  }, [ready, zoneCounts, zone, geo, mode, taluk]);

  // ---- incident pins
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    s.pins.clearLayers();
    const shown = pins.filter((p) => p.lat != null && layers[p.cat]).slice(0, 150).reverse();
    for (const p of shown) {
      const open = Number(p.open) === 1;
      const size = p.sev === "Severe" ? 18 : 13;
      const html = `<div class="mpin${open ? "" : " faded"}${open && p.sev === "Severe" ? " pulse" : ""}" style="width:${size}px;height:${size}px;background:${CAT_COL[p.cat]}"></div>`;
      s.L.marker([Number(p.lat), Number(p.lon)], {
        icon: s.L.divIcon({ className: "", html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        zIndexOffset: p.sev === "Severe" ? 500 : 0
      })
        .on("click", () => cb.current.onPin(p.id))
        .bindTooltip(`<b>${esc(p.title ?? "Incident")}</b>${esc(p.sev)} · ${esc(p.status)}`, { className: "dtip", direction: "top", offset: [0, -8] })
        .addTo(s.pins);
    }
  }, [ready, pins, layers]);

  // ---- items from added sources: violet diamonds; items naming the same place fan out slightly
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    s.added.clearLayers();
    if (!layers.added) return;
    const at = new Map<string, number>();
    for (const i of added) {
      const k = `${i.lat},${i.lon}`;
      const n = at.get(k) ?? 0;
      at.set(k, n + 1);
      const lat = Number(i.lat) + (n ? 0.0012 * Math.sin(n * 2.1) : 0), lon = Number(i.lon) + (n ? 0.0012 * Math.cos(n * 2.1) : 0);
      s.L.marker([lat, lon], {
        icon: s.L.divIcon({ className: "", html: `<div class="madd${i.is_incident ? "" : " gen"}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] }),
        zIndexOffset: 300
      })
        .on("click", () => cb.current.onItem(i))
        .bindTooltip(`<b>${esc(i.title)}</b>${esc(i.source)} · ${esc(i.place ?? i.zone_name ?? "")}<br><span style="opacity:.7">From an added source · click to open</span>`,
          { className: "dtip", direction: "top", offset: [0, -8] })
        .addTo(s.added);
    }
  }, [ready, added, layers.added]);

  // ---- the incident chosen in a list: fly to it and ring it
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    s.focus.clearLayers();
    if (!focus) return;
    s.L.marker([focus.lat, focus.lon], {
      icon: s.L.divIcon({ className: "", html: `<div class="mfocus"></div>`, iconSize: [44, 44], iconAnchor: [22, 22] }), interactive: false, zIndexOffset: 1000
    }).addTo(s.focus);
    s.map.flyTo([focus.lat, focus.lon], Math.max(s.map.getZoom(), 14.5), { duration: 0.7 });
  }, [ready, focus]);

  // ---- environment stations
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    s.stations.clearLayers();
    if (!layers.stations) return;
    for (const x of stations) {
      const sty = STATION_STYLE[x.kind];
      s.L.marker([x.lat, x.lon], {
        icon: s.L.divIcon({ className: "", html: `<div class="mst" style="background:${sty.color}">${sty.letter}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] })
      })
        .on("click", () => cb.current.onStation(x))
        .bindTooltip(`<b>${esc(x.name)}</b>${sty.title} · ${esc(x.label)}`, { className: "dtip", direction: "top", offset: [0, -10] })
        .addTo(s.stations);
    }
  }, [ready, stations, layers.stations]);

  const fitView = () => {
    const s = st.current;
    if (!s) return;
    s.focus.clearLayers();
    const b = mode === "taluks" && taluk ? s.talukBounds.get(taluk) : zone ? s.zoneBounds.get(zone) : undefined;
    s.map.flyToBounds(b ?? s.district, { padding: [8, 8], duration: 0.5 });
  };
  const m = () => st.current?.map;
  return (
    <>
      <div ref={el} style={{ position: "absolute", inset: 0 }} aria-label="Satellite map of Chennai district. Click a zone or taluk to filter, a pin to open the incident." />
      {!geo && <div className="empty" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#DCE6FA" }}>Loading the map…</div>}
      <div className="map-tools">
        <button onClick={() => m()?.zoomIn()} title="Zoom in" aria-label="Zoom in">+</button>
        <button onClick={() => m()?.zoomOut()} title="Zoom out" aria-label="Zoom out">−</button>
        <button onClick={fitView} title="Fit the view" aria-label="Fit the view"><I n="expand" /></button>
      </div>
    </>
  );
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}
