"use client";

import { useEffect, useRef, useState } from "react";
import type { Overview } from "@/lib/collector/queries";
import { SEVERITY_STYLE } from "@/components/collector/ui";

type Layer = "open_incidents" | "open_past_deadline" | "low_lying_index";

const LAYERS: { key: Layer; label: string }[] = [
  { key: "open_incidents", label: "Open incidents" },
  { key: "open_past_deadline", label: "Past deadline" },
  { key: "low_lying_index", label: "Low-lying" }
];

// Sequential navy ramp, light to dark.
const RAMP = ["#EEF3FC", "#CFDDF6", "#9DBAEB", "#5B86D4", "#1F4FA8", "#0A3175"];

function breaks(values: number[]): number[] {
  const v = values.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (v.length === 0) return [0];
  return [0.2, 0.4, 0.6, 0.8, 0.95].map((q) => v[Math.floor(q * (v.length - 1))]);
}

function colorFor(value: number, cuts: number[]): string {
  let i = 0;
  while (i < cuts.length && value > cuts[i]) i++;
  return RAMP[i];
}

interface Props {
  wards: Overview["wards"];
  pins: Overview["pins"];
  onOpenIncident: (id: string) => void;
}

export default function WardMap({ wards, pins, onOpenIncident }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layersRef = useRef<{ wards?: any; pins?: any }>({});
  const [layer, setLayer] = useState<Layer>("open_incidents");
  const [showPins, setShowPins] = useState(true);
  const [ready, setReady] = useState(false);
  const fittedRef = useRef(false);
  const openRef = useRef(onOpenIncident);
  openRef.current = onOpenIncident;

  // Map and base tiles, once.
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, { zoomControl: true, scrollWheelZoom: false, preferCanvas: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        opacity: 0.55,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(map);
      mapRef.current = map;
      observer = new ResizeObserver(() => map.invalidateSize());
      observer.observe(containerRef.current);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Ward choropleth.
  useEffect(() => {
    (async () => {
      const map = mapRef.current;
      if (!map) return;
      const L = (await import("leaflet")).default;
      layersRef.current.wards?.remove();
      const cuts = breaks(wards.map((w) => Number(w[layer] ?? 0)));
      const fc = {
        type: "FeatureCollection" as const,
        features: wards
          .filter((w) => w.geometry)
          .map((w) => ({ type: "Feature" as const, geometry: w.geometry, properties: w }))
      };
      const g = L.geoJSON(fc as any, {
        style: (f: any) => ({
          color: "#ffffff",
          weight: 1,
          fillOpacity: 0.78,
          fillColor: colorFor(Number(f.properties[layer] ?? 0), cuts)
        }),
        onEachFeature: (f: any, lyr: any) => {
          const p = f.properties;
          lyr.bindTooltip(
            `<b>Ward ${p.ward_no}</b> · ${p.zone_name}<br/>Open incidents: ${p.open_incidents ?? 0}` +
              `<br/>Past deadline: ${p.open_past_deadline ?? 0}<br/>Low-lying index: ${Number(p.low_lying_index ?? 0).toFixed(2)}`,
            { sticky: true }
          );
          lyr.on("mouseover", () => lyr.setStyle({ weight: 2.5, color: "#0B3D91" }));
          lyr.on("mouseout", () => lyr.setStyle({ weight: 1, color: "#ffffff" }));
        }
      }).addTo(map);
      layersRef.current.wards = g;
      if (!fittedRef.current) {
        map.invalidateSize();
        map.fitBounds(g.getBounds(), { padding: [6, 6] });
        fittedRef.current = true;
      }
      layersRef.current.pins?.bringToFront?.();
    })();
  }, [ready, wards, layer]);

  // Incident pins.
  useEffect(() => {
    (async () => {
      const map = mapRef.current;
      if (!map) return;
      const L = (await import("leaflet")).default;
      layersRef.current.pins?.remove();
      if (!showPins) return;
      const group = L.layerGroup();
      for (const p of pins) {
        const s = SEVERITY_STYLE[p.severity_level] ?? SEVERITY_STYLE.High;
        L.circleMarker([p.lat, p.lon], {
          radius: p.severity_level === "Severe" ? 6 : 4.5,
          color: "#fff",
          weight: 1.2,
          fillColor: s.color,
          fillOpacity: 0.95
        })
          .bindTooltip(`<b>${escapeHtml(p.title ?? p.category_label)}</b><br/>${p.severity_level} · Ward ${p.ward_no ?? "?"}`)
          .on("click", () => openRef.current(p.incident_id))
          .addTo(group);
      }
      group.addTo(map);
      layersRef.current.pins = group;
    })();
  }, [ready, pins, showPins, layer]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {LAYERS.map((l) => (
          <button
            key={l.key}
            onClick={() => setLayer(l.key)}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
              layer === l.key ? "bg-navy text-white" : "bg-canvas-sunken text-ink-muted hover:text-navy"
            }`}
          >
            {l.label}
          </button>
        ))}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-ink-muted">
          <input type="checkbox" checked={showPins} onChange={(e) => setShowPins(e.target.checked)} />
          Severe and high incidents
        </label>
      </div>
      <div ref={containerRef} className="relative z-0 min-h-[320px] flex-1 overflow-hidden rounded-xl border border-canvas-border" />
      <div className="flex items-center gap-2 text-2xs text-ink-subtle">
        <span>Fewer</span>
        <span className="flex">
          {RAMP.map((c) => (
            <i key={c} className="block h-2 w-5" style={{ background: c }} />
          ))}
        </span>
        <span>More</span>
        <span className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1">
            <i className="block h-2 w-2 rounded-full" style={{ background: SEVERITY_STYLE.Severe.color }} /> Severe
          </span>
          <span className="flex items-center gap-1">
            <i className="block h-2 w-2 rounded-full" style={{ background: SEVERITY_STYLE.High.color }} /> High
          </span>
        </span>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}
