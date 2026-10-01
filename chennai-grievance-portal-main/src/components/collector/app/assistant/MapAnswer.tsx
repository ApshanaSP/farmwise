"use client";

/**
 * Map answers, in the console map's style (Leaflet over Esri imagery, white zone outlines):
 * zones shaded by a value (one hue, light to dark), located points, or hotspots sized by how
 * many incidents they hold. Hover shows the value; clicking a zone filters the console.
 */
import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import type { MapGeo } from "@/lib/collector/geo";
import { fmtValue } from "@/lib/assistant/chartspec";
import type { ChartSpec, Dataset } from "@/lib/assistant/answer";
import { esc } from "../SatMap";

const RAMP = ["#CDE2FB", "#86B6EF", "#3987E5", "#1560E8", "#0B3FA8"];

export default function MapAnswer({ spec, ds, geo, height, onZone }: {
  spec: ChartSpec; ds: Dataset; geo: MapGeo | null; height: number; onZone?: (zone: number) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const cb = useRef(onZone);
  cb.current = onZone;

  useEffect(() => {
    if (!geo || !el.current) return;
    let map: Leaflet.Map | null = null;
    let dead = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (dead || !el.current) return;
      map = L.map(el.current, { zoomControl: true, attributionControl: true, minZoom: 9, maxZoom: 17, scrollWheelZoom: false });
      map.attributionControl.setPrefix(false);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics"
      }).addTo(map);
      const y = spec.y[0];
      const f = ds.fields.find((x) => x.key === y);
      const fmt = (v: number | null) => fmtValue(v, f?.format ?? "integer", f?.unit ?? null);
      const bounds = L.latLngBounds([]);

      if (spec.type === "map_zones") {
        const byZone = new Map(ds.rows.map((r) => [Number(r.zone), Number(r[y] ?? 0)]));
        const name = new Map(ds.rows.map((r) => [Number(r.zone), String(r.name ?? r[spec.x ?? "name"] ?? `Zone ${r.zone}`)]));
        const max = Math.max(1, ...byZone.values());
        const top = [...byZone.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        for (const w of geo.wards) {
          const v = byZone.get(w.zone) ?? 0;
          const step = v <= 0 ? -1 : Math.min(RAMP.length - 1, Math.floor((v / max) * RAMP.length - 1e-9));
          const poly = L.polygon(w.rings, { color: "#FFFFFF", weight: 0.4, opacity: 0.5, fillColor: step < 0 ? "#FFFFFF" : RAMP[step], fillOpacity: step < 0 ? 0.05 : 0.62 })
            .bindTooltip(`<b>${esc(name.get(w.zone) ?? `Zone ${w.zone}`)}</b>${esc(f?.label ?? y)}: ${esc(fmt(v))}<br><span style="opacity:.7">Click to filter the console</span>`,
              { sticky: true, className: "dtip", direction: "top", offset: [0, -8] })
            .on("click", () => cb.current?.(w.zone))
            .addTo(map);
          bounds.extend(poly.getBounds());
        }
        for (const z of geo.zones) L.polyline(z.lines, { color: "#FFFFFF", weight: z.zone === top ? 3.4 : 1.8, opacity: 0.95, interactive: false }).addTo(map);
        // the leading zone carries its value as a label
        const tz = geo.zones.find((z) => z.zone === top);
        if (tz) L.marker([tz.lat, tz.lon], { interactive: false, icon: L.divIcon({ className: "aq-maplabel", html: `<b>${esc(name.get(top!) ?? "")}</b>${esc(fmt(byZone.get(top!) ?? 0))}`, iconSize: [0, 0] }) }).addTo(map);
        addLegend(L, map, fmt, max, f?.label ?? y);
      } else if (spec.type === "map_wards") {
        // wards shaded by the value; wards without a row stay clear
        const wk = ds.fields.find((x) => x.key === "ward" || x.key === "ward_no")?.key ?? "ward";
        const byWard = new Map(ds.rows.filter((r) => r[wk] != null && Number.isFinite(Number(r[wk]))).map((r) => [Number(r[wk]), Number(r[y] ?? 0)]));
        const max = Math.max(1, ...byWard.values());
        for (const w of geo.wards) {
          const v = byWard.get(w.ward);
          const step = v == null || v <= 0 ? -1 : Math.min(RAMP.length - 1, Math.floor((v / max) * RAMP.length - 1e-9));
          const poly = L.polygon(w.rings, { color: "#FFFFFF", weight: 0.5, opacity: 0.6, fillColor: step < 0 ? "#FFFFFF" : RAMP[step], fillOpacity: step < 0 ? 0.05 : 0.66 })
            .bindTooltip(`<b>Ward ${w.ward}</b>${esc(f?.label ?? y)}: ${esc(v == null ? "no data" : fmt(v))}<br><span style="opacity:.7">Zone ${w.zone} · click to filter the console</span>`,
              { sticky: true, className: "dtip", direction: "top", offset: [0, -8] })
            .on("click", () => cb.current?.(w.zone))
            .addTo(map);
          bounds.extend(poly.getBounds());
        }
        for (const z of geo.zones) L.polyline(z.lines, { color: "#FFFFFF", weight: 1.6, opacity: 0.9, interactive: false }).addTo(map);
        addLegend(L, map, fmt, max, f?.label ?? y);
      } else {
        for (const z of geo.zones) L.polyline(z.lines, { color: "#FFFFFF", weight: 1.6, opacity: 0.85, interactive: false }).addTo(map);
        const vals = ds.rows.map((r) => Number(r[y] ?? 1));
        const max = Math.max(1, ...vals);
        const label = spec.x ?? ds.fields.find((x) => x.kind === "category")?.key ?? "";
        // located incidents are coloured by severity, most severe drawn last (on top)
        const bySev = ds.fields.some((x) => x.key === "sev");
        const rank = (s: unknown) => ["Low", "Medium", "High", "Severe"].indexOf(String(s));
        const rows = ds.rows.slice(0, 2000).filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon)));
        if (bySev) rows.sort((a, b) => rank(a.sev) - rank(b.sev));
        const pts = L.latLngBounds([]);
        for (const r of rows) {
          const lat = Number(r.lat), lon = Number(r.lon);
          const v = Number(r[y] ?? 1);
          const radius = spec.type === "map_hotspots" ? 5 + 13 * Math.sqrt(v / max) : bySev && r.sev === "Severe" ? 7 : 5;
          const fill = spec.type === "map_hotspots" ? "#E0730D" : bySev ? SEV[String(r.sev)] ?? "#1560E8" : "#1560E8";
          const place = r.place && r.place !== r[label] ? `<br>${esc(String(r.place))}` : "";
          L.circleMarker([lat, lon], { radius, color: "#FFFFFF", weight: 2, fillColor: fill, fillOpacity: 0.88 })
            .bindTooltip(`<b>${esc(String(r[label] ?? ""))}</b>${place}${bySev && r.sev ? `<br>${esc(String(r.sev))}` : ""}${f && y !== "priority" ? `<br>${esc(f.label)}: ${esc(fmt(v))}` : ""}`
              + `${r.open != null && y !== "open" && typeof r.open !== "boolean" ? `<br>Open: ${esc(String(r.open))}` : ""}`,
              { className: "dtip", direction: "top", offset: [0, -6] })
            .addTo(map);
          pts.extend([lat, lon]);
        }
        // the answer's own area, not the whole district: fit to the points (a lone point gets a street-level view)
        if (pts.isValid()) bounds.extend(pts.pad(rows.length > 1 ? 0.12 : 0.02));
        else for (const w of geo.wards) bounds.extend(L.polygon(w.rings).getBounds());
        if (bySev) addSevLegend(L, map);
      }
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [8, 8], maxZoom: 15 });
      else map.setView([13.05, 80.23], 11);
    })();
    return () => { dead = true; map?.remove(); };
  }, [geo, spec, ds]);

  if (!geo) return <div className="aq-map aq-map-wait" style={{ height }}>Loading the map…</div>;
  return <div ref={el} className="aq-map" style={{ height }} role="img" aria-label={spec.title} />;
}

const SEV: Record<string, string> = { Severe: "#D92D35", High: "#E0730D", Medium: "#EDA100", Low: "#12925F" };

function addSevLegend(L: typeof Leaflet, map: Leaflet.Map) {
  const Legend = L.Control.extend({
    onAdd() {
      const d = L.DomUtil.create("div", "aq-maplegend sev");
      d.innerHTML = Object.entries(SEV).map(([k, c]) => `<em><b style="background:${c}"></b>${k}</em>`).join("");
      return d;
    }
  });
  new Legend({ position: "bottomleft" }).addTo(map);
}

function addLegend(L: typeof Leaflet, map: Leaflet.Map, fmt: (v: number) => string, max: number, label: string) {
  const Legend = L.Control.extend({
    onAdd() {
      const d = L.DomUtil.create("div", "aq-maplegend");
      d.innerHTML = `<span>${esc(label)}</span><i>${RAMP.map((c) => `<b style="background:${c}"></b>`).join("")}</i><small>0</small><small>${esc(fmt(max))}</small>`;
      return d;
    }
  });
  new Legend({ position: "bottomleft" }).addTo(map);
}
