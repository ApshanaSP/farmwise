/**
 * Derives an area -> ward mapping and loads it into `area_wards`.
 *
 * WHY THIS IS DERIVED, NOT VERIFIED
 * ---------------------------------
 * GCC publishes no area-to-ward mapping (its boundary chain carries no ward
 * numbers at all). This script approximates one:
 *
 *   1. Geocode each GCC area name against OpenStreetMap (Nominatim) to get a
 *      representative point and a bounding box.
 *   2. Any ward polygon intersecting that bounding box becomes a candidate.
 *   3. The ward actually containing the point is marked `is_primary`.
 *
 * The result is good enough to shrink a 200-item dropdown to a short list, and
 * NOT good enough to decide which ward a complaint belongs to. Every row is
 * stored with confidence = 'derived', the form labels the list as approximate,
 * and a ward resolved by point-in-polygon from a real map pin always wins.
 *
 * Nominatim's usage policy requires a descriptive User-Agent and at most one
 * request per second; both are respected below. ~250 areas takes ~5 minutes.
 *
 *   node scripts/derive-area-wards.js
 *   node scripts/derive-area-wards.js --limit 20    # quick trial run
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { getDbConfig, describeDb } = require("./db-config");

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "gcc-grievance-portal/1.0 (area-to-ward derivation)";
const RATE_MS = 1100;
const BOUNDARY = path.join(__dirname, "..", "data", "boundaries", "gcc-wards.geojson");
const META = path.join(__dirname, "..", "data", "boundaries", "gcc-wards.meta.json");

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bboxOf(rings) {
  let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < minLng) minLng = c[0];
      if (c[0] > maxLng) maxLng = c[0];
      if (c[1] < minLat) minLat = c[1];
      if (c[1] > maxLat) maxLat = c[1];
    } else c.forEach(walk);
  };
  walk(rings);
  return { minLng, minLat, maxLng, maxLat };
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * A plain search often returns the enclosing GCC *zone* (a large administrative
 * polygon), which would drag in every ward of that zone. Ask for several
 * results and prefer neighbourhood-scale ones, then fall back to the smallest
 * box available.
 */
const PLACE_RANK = {
  neighbourhood: 0, quarter: 1, suburb: 2, residential: 3,
  village: 4, town: 5, city_district: 6
};

async function geocode(name) {
  const url =
    NOMINATIM +
    "?format=json&limit=6&countrycodes=in&q=" +
    encodeURIComponent(name + ", Chennai, Tamil Nadu");
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const j = await res.json();
  if (!Array.isArray(j) || j.length === 0) return null;

  const area = (h) => {
    const b = h.boundingbox.map(Number);
    return (b[1] - b[0]) * (b[3] - b[2]);
  };
  const scored = j.map((h) => ({
    h,
    rank: PLACE_RANK[h.type] ?? (h.class === "place" ? 7 : 20),
    size: area(h)
  }));
  // Neighbourhood-scale first; among equals, the tightest bounding box.
  scored.sort((a, b) => a.rank - b.rank || a.size - b.size);
  const hit = scored[0].h;

  const bb = hit.boundingbox.map(Number); // [south, north, west, east]
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    box: { minLat: bb[0], maxLat: bb[1], minLng: bb[2], maxLng: bb[3] },
    label: hit.display_name,
    kind: hit.class + "/" + hit.type
  };
}

(async () => {
  if (!fs.existsSync(BOUNDARY)) {
    console.error("Ward boundaries missing. Run: node scripts/import-ward-boundaries.js");
    process.exit(1);
  }
  const geo = JSON.parse(fs.readFileSync(BOUNDARY, "utf8"));
  const meta = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, "utf8")) : {};

  const wards = geo.features.map((f) => ({
    wardNo: f.properties.ward_no,
    rings: f.geometry.coordinates,
    bbox: bboxOf(f.geometry.coordinates)
  }));
  console.log("Loaded " + wards.length + " ward polygons");

  console.log("Database: " + describeDb());
  const conn = await mysql.createConnection(getDbConfig());
  const [areas] = await conn.query("SELECT id, name FROM gcc_areas ORDER BY name");
  const todo = areas.slice(0, LIMIT);
  console.log("Geocoding " + todo.length + " areas at ~1/sec (Nominatim usage policy)\n");

  const rows = [];
  let resolved = 0;
  let missed = 0;
  const failures = [];

  for (let i = 0; i < todo.length; i++) {
    const area = todo[i];
    let g = null;
    try {
      g = await geocode(area.name);
    } catch (err) {
      failures.push({ area: area.name, error: err.message });
    }
    await sleep(RATE_MS);

    if (!g) {
      missed++;
      if (!failures.find((f) => f.area === area.name)) {
        failures.push({ area: area.name, error: "no geocoding result" });
      }
      continue;
    }

    // Candidates: ward polygons whose bbox overlaps the area's bbox.
    const candidates = wards.filter(
      (w) =>
        w.bbox.minLng <= g.box.maxLng &&
        w.bbox.maxLng >= g.box.minLng &&
        w.bbox.minLat <= g.box.maxLat &&
        w.bbox.maxLat >= g.box.minLat
    );
    // Primary: the ward actually containing the point.
    const primary = wards.find(
      (w) =>
        g.lng >= w.bbox.minLng && g.lng <= w.bbox.maxLng &&
        g.lat >= w.bbox.minLat && g.lat <= w.bbox.maxLat &&
        pointInRing(g.lng, g.lat, w.rings[0])
    );

    const set = new Set(candidates.map((c) => c.wardNo));
    if (primary) set.add(primary.wardNo);

    if (set.size === 0) {
      missed++;
      failures.push({ area: area.name, error: "geocoded outside every ward polygon" });
      continue;
    }

    for (const wardNo of set) {
      rows.push([
        area.id,
        wardNo,
        primary && primary.wardNo === wardNo ? 1 : 0,
        "derived",
        "OpenStreetMap/Nominatim geocode x GCC ward polygons",
        meta.fetchedAt || null
      ]);
    }
    resolved++;

    if ((i + 1) % 25 === 0 || i === todo.length - 1) {
      console.log(
        "  " + (i + 1) + "/" + todo.length + "  resolved=" + resolved +
        " missed=" + missed + " rows=" + rows.length
      );
    }
  }

  if (rows.length) {
    await conn.query("DELETE FROM area_wards WHERE confidence = 'derived'");
    for (let i = 0; i < rows.length; i += 500) {
      await conn.query(
        `INSERT INTO area_wards
           (area_id, ward_number, is_primary, confidence, source, source_version)
         VALUES ?
         ON DUPLICATE KEY UPDATE
           is_primary = VALUES(is_primary), source = VALUES(source),
           source_version = VALUES(source_version)`,
        [rows.slice(i, i + 500)]
      );
    }
  }

  const avg = resolved ? (rows.length / resolved).toFixed(1) : "0";
  console.log(
    "\nDone. " + resolved + " areas mapped, " + missed + " unmapped, " +
    rows.length + " area/ward pairs (avg " + avg + " wards per area)."
  );
  if (failures.length) {
    console.log("Unmapped areas keep the full 200-ward list in the form:");
    failures.slice(0, 15).forEach((f) => console.log("  - " + f.area + ": " + f.error));
    if (failures.length > 15) console.log("  ... and " + (failures.length - 15) + " more");
  }

  await conn.query(
    `INSERT INTO reference_data_sources
       (dataset, source_url, source_label, is_official, fetched_at, row_count, notes)
     VALUES ('area_wards', ?, ?, 0, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       source_url = VALUES(source_url), source_label = VALUES(source_label),
       fetched_at = VALUES(fetched_at), row_count = VALUES(row_count),
       notes = VALUES(notes)`,
    [
      NOMINATIM,
      "Derived: OpenStreetMap geocode of GCC area names x GCC ward polygons",
      rows.length,
      "DERIVED, NOT AUTHORITATIVE. GCC publishes no area-to-ward mapping. Areas are " +
        "geocoded against OpenStreetMap and intersected with ward polygons to narrow the " +
        "ward dropdown. " + missed + " of " + todo.length + " areas could not be mapped and " +
        "fall back to the full ward list. A ward resolved from a map pin always overrides this."
    ]
  );

  await conn.end();
})().catch((err) => {
  console.error("Derivation failed:", err);
  process.exit(1);
});
