import fs from "fs";
import path from "path";

/**
 * Ward resolution from coordinates, by point-in-polygon against GCC ward
 * boundary polygons.
 *
 * Deliberately does NOT derive a ward from a PIN code, from the nearest ward
 * centroid, or from the text of a geocoded address: none of those respects the
 * actual boundary, and all of them produce confident-looking wrong answers near
 * a ward edge. If the point is not inside a polygon, this module says so.
 *
 * Boundary data is loaded from data/boundaries/ (see
 * scripts/import-ward-boundaries.js). When that file is absent the module
 * reports `available: false` and callers must degrade honestly rather than
 * guess.
 */

export interface WardFeature {
  wardNo: number;
  zoneNumber: number | null;
  zoneName: string | null;
  /** [minLng, minLat, maxLng, maxLat] — a cheap pre-filter, not the test. */
  bbox: [number, number, number, number];
  /** Outer ring first, then any holes. */
  rings: number[][][];
}

export interface WardDataset {
  available: boolean;
  features: WardFeature[];
  meta: {
    source?: string;
    sourceLabel?: string;
    official?: boolean;
    fetchedAt?: string;
    wardCount?: number;
    complete?: boolean;
    bbox?: { minLng: number; minLat: number; maxLng: number; maxLat: number };
    overlappingZoneSpans?: unknown[];
    officialSourceNote?: string;
  };
  /** Why the dataset is unavailable, when it is. */
  problem?: string;
}

const BOUNDARY_DIR = path.join(process.cwd(), "data", "boundaries");
const GEOJSON_PATH = path.join(BOUNDARY_DIR, "gcc-wards.geojson");
const META_PATH = path.join(BOUNDARY_DIR, "gcc-wards.meta.json");

let cached: WardDataset | null = null;

function ringBbox(rings: number[][][]): [number, number, number, number] {
  let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** Parses the boundary files once per process. */
export function loadWardDataset(): WardDataset {
  if (cached) return cached;

  if (!fs.existsSync(GEOJSON_PATH)) {
    cached = {
      available: false,
      features: [],
      meta: {},
      problem:
        "Ward boundary data is not installed. Run: node scripts/import-ward-boundaries.js"
    };
    return cached;
  }

  try {
    const gj = JSON.parse(fs.readFileSync(GEOJSON_PATH, "utf8"));
    const meta = fs.existsSync(META_PATH)
      ? JSON.parse(fs.readFileSync(META_PATH, "utf8"))
      : {};

    const features: WardFeature[] = [];
    for (const f of gj.features || []) {
      const g = f.geometry;
      if (!g) continue;
      // Normalise Polygon and MultiPolygon into a flat list of ring sets.
      const polygons: number[][][][] =
        g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      for (const rings of polygons) {
        features.push({
          wardNo: f.properties.ward_no,
          zoneNumber: f.properties.zone_number ?? null,
          zoneName: f.properties.zone_name ?? null,
          bbox: ringBbox(rings),
          rings
        });
      }
    }

    cached = { available: features.length > 0, features, meta };
    if (features.length === 0) cached.problem = "Ward boundary file contains no usable polygons.";
    return cached;
  } catch (err) {
    cached = {
      available: false,
      features: [],
      meta: {},
      problem: "Ward boundary file could not be read: " + (err as Error).message
    };
    return cached;
  }
}

/**
 * Ray-casting point-in-polygon on a single ring.
 * Returns true when the point lies inside the ring.
 */
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    // Does the horizontal ray at `lat` cross this edge, and is the crossing
    // to the right of the point?
    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and outside every hole. */
function pointInPolygon(lng: number, lat: number, rings: number[][][]): boolean {
  if (rings.length === 0) return false;
  if (!pointInRing(lng, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lng, lat, rings[i])) return false;
  }
  return true;
}

export type WardLookup =
  | {
      status: "resolved";
      wardNo: number;
      zoneNumber: number | null;
      zoneName: string | null;
      /** True when more than one polygon claimed the point (data overlap). */
      ambiguous: boolean;
      candidates?: number[];
      source: { label?: string; official?: boolean; fetchedAt?: string };
    }
  | {
      status: "outside_boundary";
      message: string;
      source: { label?: string; official?: boolean; fetchedAt?: string };
    }
  | { status: "unavailable"; message: string };

/**
 * Resolves the GCC ward containing a coordinate.
 *
 * `outside_boundary` means the point is genuinely not inside any GCC ward
 * polygon — which is also the service-eligibility answer, since the union of
 * the 200 ward polygons IS the municipal area. A bounding box is never used as
 * the boundary test.
 */
export function resolveWard(lat: number, lng: number): WardLookup {
  const ds = loadWardDataset();
  if (!ds.available) {
    return {
      status: "unavailable",
      message: ds.problem || "Ward boundary data is unavailable."
    };
  }

  const source = {
    label: ds.meta.sourceLabel,
    official: ds.meta.official,
    fetchedAt: ds.meta.fetchedAt
  };

  const hits: WardFeature[] = [];
  for (const f of ds.features) {
    const [minLng, minLat, maxLng, maxLat] = f.bbox;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    if (pointInPolygon(lng, lat, f.rings)) hits.push(f);
  }

  if (hits.length === 0) {
    return {
      status: "outside_boundary",
      message:
        "That location is outside the Greater Chennai Corporation area, so it cannot be " +
        "handled through this portal.",
      source
    };
  }

  const wardNumbers = Array.from(new Set(hits.map((h) => h.wardNo)));
  const first = hits[0];

  return {
    status: "resolved",
    wardNo: first.wardNo,
    zoneNumber: first.zoneNumber,
    zoneName: first.zoneName,
    ambiguous: wardNumbers.length > 1,
    candidates: wardNumbers.length > 1 ? wardNumbers : undefined,
    source
  };
}

/** Provenance for the UI, so the app never implies the data is official. */
export function wardDataProvenance() {
  const ds = loadWardDataset();
  return {
    available: ds.available,
    problem: ds.problem,
    sourceLabel: ds.meta.sourceLabel ?? null,
    sourceUrl: ds.meta.source ?? null,
    official: ds.meta.official ?? false,
    fetchedAt: ds.meta.fetchedAt ?? null,
    wardCount: ds.meta.wardCount ?? null,
    complete: ds.meta.complete ?? false,
    note: ds.meta.officialSourceNote ?? null
  };
}
