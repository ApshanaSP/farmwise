/**
 * Chennai's 200 GCC wards and 15 zone outlines for the console's satellite map,
 * read once from the intelligence store and cached for the life of the server.
 */
import { RowDataPacket } from "mysql2";
import intelPool from "@/lib/collector/db";

type Ring = number[][];

function rings(geom: any): Ring[] {
  if (!geom) return [];
  if (geom.type === "Polygon") return geom.coordinates;
  if (geom.type === "MultiPolygon") return geom.coordinates.flat();
  if (geom.type === "LineString") return [geom.coordinates];
  if (geom.type === "MultiLineString") return geom.coordinates;
  return [];
}

// ------------------------------------------------------------ lat/lon --

export interface MapGeo {
  /** rings as [lat, lon] pairs, thinned to ~15 m */
  wards: { ward: number; zone: number; taluk: string | null; rings: [number, number][][] }[];
  zones: { zone: number; name: string; lat: number; lon: number; lines: [number, number][][] }[];
  /** revenue taluks: no boundary is supplied, so the map colours each ward by its taluk */
  taluks: { code: string; name: string; lat: number; lon: number }[];
}

declare global {
  // eslint-disable-next-line no-var
  var __collectorGeoV2: MapGeo | undefined;
}

/** Ward polygons and zone outlines for Leaflet, cached for the life of the server. */
export async function mapGeo(): Promise<MapGeo> {
  if (global.__collectorGeoV2) return global.__collectorGeoV2;
  const [wardRows] = await intelPool.query<RowDataPacket[]>(
    `SELECT ward_no, zone_no, zone_name, taluk_code, centroid_lat, centroid_lon, geometry FROM ref_wards ORDER BY ward_no`
  );
  const [zoneRows] = await intelPool.query<RowDataPacket[]>(`SELECT zone_no, zone_name, outline FROM ref_zones`);
  const [talukRows] = await intelPool.query<RowDataPacket[]>(`SELECT taluk_code, name, lat, lon FROM ref_taluks WHERE in_district = 1`);
  const parse = (g: any) => (typeof g === "string" ? JSON.parse(g) : g);
  const thin = (r: Ring): [number, number][] => {
    const out: [number, number][] = [];
    for (const [lon, lat] of r) {
      const p: [number, number] = [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5];
      const q = out[out.length - 1];
      if (!q || Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) > 0.00014) out.push(p);
    }
    return out;
  };
  const zc = new Map<number, { name: string; lat: number[]; lon: number[] }>();
  for (const w of wardRows) {
    const z = zc.get(w.zone_no) ?? { name: String(w.zone_name), lat: [], lon: [] };
    z.lat.push(Number(w.centroid_lat));
    z.lon.push(Number(w.centroid_lon));
    zc.set(w.zone_no, z);
  }
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const outline = new Map(zoneRows.map((z) => [z.zone_no, parse(z.outline)]));
  const geo: MapGeo = {
    wards: wardRows.map((w) => ({ ward: w.ward_no, zone: w.zone_no, taluk: w.taluk_code ?? null, rings: rings(parse(w.geometry)).map(thin) })),
    zones: [...zc.entries()].sort((a, b) => a[0] - b[0]).map(([zone, z]) => ({
      zone, name: z.name, lat: avg(z.lat), lon: avg(z.lon), lines: rings(outline.get(zone)).map(thin)
    })),
    taluks: talukRows.map((t) => ({ code: t.taluk_code, name: t.name, lat: Number(t.lat), lon: Number(t.lon) }))
  };
  global.__collectorGeoV2 = geo;
  return geo;
}
