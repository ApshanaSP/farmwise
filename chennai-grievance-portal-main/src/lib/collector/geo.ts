/**
 * Chennai's 200 GCC wards as SVG paths for the console's map. Projected once on
 * the server (equirectangular around the city's mid-latitude) and cached, so the
 * browser receives ready-made paths plus the projection to place incident pins.
 */
import { RowDataPacket } from "mysql2";
import intelPool from "@/lib/collector/db";

export interface MapShapes {
  width: number;
  height: number;
  /** lon/lat -> x/y: x = (lon - lon0) * kx, y = (lat0 - lat) * ky */
  proj: { lon0: number; lat0: number; kx: number; ky: number };
  wards: { ward: number; zone: number; d: string }[];
  zones: { zone: number; name: string; x: number; y: number; d: string }[];
  sea: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __collectorShapes: MapShapes | undefined;
}

const W = 560;
const H = 545;
const PAD = 14;

type Ring = number[][];

function rings(geom: any): Ring[] {
  if (!geom) return [];
  if (geom.type === "Polygon") return geom.coordinates;
  if (geom.type === "MultiPolygon") return geom.coordinates.flat();
  if (geom.type === "LineString") return [geom.coordinates];
  if (geom.type === "MultiLineString") return geom.coordinates;
  return [];
}

export async function mapShapes(): Promise<MapShapes> {
  if (global.__collectorShapes) return global.__collectorShapes;

  const [wardRows] = await intelPool.query<RowDataPacket[]>(
    `SELECT ward_no, zone_no, zone_name, centroid_lat, centroid_lon, geometry FROM ref_wards ORDER BY ward_no`
  );
  const [zoneRows] = await intelPool.query<RowDataPacket[]>(`SELECT zone_no, zone_name, outline FROM ref_zones`);

  const parse = (g: any) => (typeof g === "string" ? JSON.parse(g) : g);
  const wards: Record<string, any>[] = wardRows.map((w) => ({ ...w, geometry: parse(w.geometry) }));

  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const w of wards)
    for (const r of rings(w.geometry))
      for (const [lon, lat] of r) {
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }
  const midLat = (minLat + maxLat) / 2;
  const cos = Math.cos((midLat * Math.PI) / 180);
  // Leave room on the right for the sea, as in the design.
  const k = Math.min((W * 0.78 - 2 * PAD) / ((maxLon - minLon) * cos), (H - 2 * PAD) / (maxLat - minLat));
  const kx = k * cos;
  const ky = k;
  const offX = PAD + 8;
  const offY = (H - (maxLat - minLat) * ky) / 2;
  const lon0 = minLon - offX / kx;
  const lat0 = maxLat + offY / ky;
  const px = (lon: number) => (lon - lon0) * kx;
  const py = (lat: number) => (lat0 - lat) * ky;

  const path = (rs: Ring[], close = true) =>
    rs
      .map((r) => {
        let last = "";
        const pts: string[] = [];
        for (const [lon, lat] of r) {
          const p = `${px(lon).toFixed(1)} ${py(lat).toFixed(1)}`;
          if (p !== last) pts.push(p);
          last = p;
        }
        return "M" + pts.join("L") + (close ? "Z" : "");
      })
      .join("");

  // The sea: east of the easternmost ward edge, sampled in horizontal bands.
  const bands = 60;
  const east: number[] = Array(bands + 1).fill(-Infinity);
  for (const w of wards)
    for (const r of rings(w.geometry))
      for (const [lon, lat] of r) {
        const b = Math.round((py(lat) / H) * bands);
        if (b >= 0 && b <= bands) east[b] = Math.max(east[b], px(lon));
      }
  for (let b = 0; b <= bands; b++) if (!Number.isFinite(east[b])) east[b] = NaN;
  // Fill gaps north and south of the city by extending the nearest coast point.
  const firstIdx = east.findIndex((v) => !Number.isNaN(v));
  const lastIdx = bands - [...east].reverse().findIndex((v) => !Number.isNaN(v));
  for (let b = 0; b < firstIdx; b++) east[b] = east[firstIdx];
  for (let b = lastIdx + 1; b <= bands; b++) east[b] = east[lastIdx];
  for (let b = 0; b <= bands; b++) if (Number.isNaN(east[b])) east[b] = east[b - 1];
  const coast = east.map((x, b) => `${(x + 3).toFixed(1)},${((b / bands) * H).toFixed(1)}`);
  const sea = [...coast, `${W},${H}`, `${W},0`].join(" ");

  const zoneMap = new Map<number, { name: string; xs: number[]; ys: number[] }>();
  for (const w of wards) {
    const z = zoneMap.get(w.zone_no) ?? { name: String(w.zone_name), xs: [] as number[], ys: [] as number[] };
    z.xs.push(px(w.centroid_lon));
    z.ys.push(py(w.centroid_lat));
    zoneMap.set(w.zone_no, z);
  }
  const outlines = new Map(zoneRows.map((z) => [z.zone_no, parse(z.outline)]));
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

  const shapes: MapShapes = {
    width: W,
    height: H,
    proj: { lon0, lat0, kx, ky },
    wards: wards.map((w) => ({ ward: w.ward_no, zone: w.zone_no, d: path(rings(w.geometry)) })),
    zones: [...zoneMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([zone, z]) => ({
        zone,
        name: z.name,
        x: Math.round(avg(z.xs)),
        y: Math.round(avg(z.ys)),
        d: path(rings(outlines.get(zone)), false)
      })),
    sea
  };
  global.__collectorShapes = shapes;
  return shapes;
}
