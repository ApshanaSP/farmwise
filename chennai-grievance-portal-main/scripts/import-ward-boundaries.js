/**
 * Downloads and validates Greater Chennai Corporation ward boundary polygons,
 * writing them to data/boundaries/gcc-wards.geojson with provenance.
 *
 * PROVENANCE / ACCURACY NOTE
 * --------------------------
 * The default source is the DataMeet "Municipal Spatial Data" community
 * dataset. It is openly licensed and widely used, but it is NOT an official
 * Greater Chennai Corporation publication and carries no accuracy guarantee.
 *
 * GCC runs an official ArcGIS server at
 *   https://gis.chennaicorporation.gov.in/server/rest/services/
 * but its TLS certificate had EXPIRED at import time, so this script does not
 * fetch from it (that would require disabling certificate verification). If you
 * obtain an official GCC ward layer, run:
 *   node scripts/import-ward-boundaries.js --source ./path/to/official.geojson
 * and the application picks it up with no code change.
 *
 * The zone for each ward is taken FROM THE SOURCE DATA, not from a hard-coded
 * range, so this script does not bake in an assumed delimitation. Zone ward
 * ranges are derived and reported so they can be cross-checked against the
 * `zones` table.
 *
 * The application treats a ward resolved from this file as reference data, not
 * an authoritative legal determination — see src/lib/wards.ts.
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_SOURCE =
  "https://raw.githubusercontent.com/datameet/Municipal_Spatial_Data/master/Chennai/Wards.geojson";
const SOURCE_LABEL =
  "DataMeet / Municipal_Spatial_Data / Chennai / Wards.geojson (community dataset, not GCC-official)";

const OUT_DIR = path.join(__dirname, "..", "data", "boundaries");
const OUT_FILE = path.join(OUT_DIR, "gcc-wards.geojson");
const META_FILE = path.join(OUT_DIR, "gcc-wards.meta.json");

// Canonical GCC zone spellings, as used by the `zones` table. Mapped from the
// source dataset's own labels (which use different casing/spelling) so the two
// datasets can be joined. This renames zones; it does not reassign wards.
const ZONE_SPELLING = {
  THIRUVOTTIYUR: { number: 1, name: "Thiruvottiyur" },
  MANALI: { number: 2, name: "Manali" },
  MADHAVARAM: { number: 3, name: "Madhavaram" },
  TONDIARPET: { number: 4, name: "Tondiarpet" },
  ROYAPURAM: { number: 5, name: "Royapuram" },
  "THIRU-VI-KA-NAGAR": { number: 6, name: "Thiru-Vi-Ka-Nagar" },
  AMBATTUR: { number: 7, name: "Ambattur" },
  ANNANAGAR: { number: 8, name: "Anna Nagar" },
  TEYNAMPET: { number: 9, name: "Teynampet" },
  KODAMBAKKAM: { number: 10, name: "Kodambakkam" },
  VALASARAVAKKAM: { number: 11, name: "Valasaravakkam" },
  ALANDUR: { number: 12, name: "Alandur" },
  ADYAR: { number: 13, name: "Adyar" },
  PERUNGUDI: { number: 14, name: "Perungudi" },
  SOZHINGANALLUR: { number: 15, name: "Sholinganallur" }
};

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

(async () => {
  const source = argValue("--source") || DEFAULT_SOURCE;
  const fetchedAt = new Date().toISOString();

  console.log("Fetching ward boundaries from:\n  " + source);
  let raw;
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error("HTTP " + res.status + " fetching " + source);
    raw = await res.text();
  } else {
    raw = fs.readFileSync(source, "utf8");
  }

  const gj = JSON.parse(raw);
  if (gj.type !== "FeatureCollection" || !Array.isArray(gj.features)) {
    throw new Error("Source is not a GeoJSON FeatureCollection");
  }
  console.log("  " + gj.features.length + " features, " + raw.length + " bytes");

  const kept = [];
  const dropped = [];
  const unknownZones = new Set();

  for (const f of gj.features) {
    const p = f.properties || {};
    const wardNo = Number(p.Ward_No);

    // Ward 0 / St. Thomas Mount is a separate cantonment, not a GCC ward.
    if (!Number.isInteger(wardNo) || wardNo < 1 || wardNo > 200) {
      dropped.push({
        wardNo: p.Ward_No,
        zoneName: p.Zone_Name,
        reason: "ward number outside the GCC range 1-200"
      });
      continue;
    }

    const srcZoneKey = String(p.Zone_Name || "").toUpperCase().replace(/\s+/g, "");
    const zone = ZONE_SPELLING[srcZoneKey];
    if (!zone) unknownZones.add(p.Zone_Name);

    kept.push({
      type: "Feature",
      properties: {
        ward_no: wardNo,
        zone_number: zone ? zone.number : null,
        zone_name: zone ? zone.name : null,
        source_zone_name: p.Zone_Name || null
      },
      geometry: f.geometry
    });
  }

  kept.sort((a, b) => a.properties.ward_no - b.properties.ward_no);

  const seen = new Set(kept.map((f) => f.properties.ward_no));
  const missing = [];
  for (let w = 1; w <= 200; w++) if (!seen.has(w)) missing.push(w);
  const duplicates = kept.length - seen.size;

  // Derive each zone's ward set FROM the data, and flag non-contiguous zones
  // rather than silently normalising them into a range.
  const byZone = {};
  for (const f of kept) {
    const z = f.properties.zone_name || "(unmapped)";
    (byZone[z] = byZone[z] || []).push(f.properties.ward_no);
  }
  const zoneRanges = Object.entries(byZone)
    .map(([zoneName, wards]) => {
      wards.sort((a, b) => a - b);
      const lo = wards[0];
      const hi = wards[wards.length - 1];
      return {
        zoneName,
        zoneNumber: (ZONE_SPELLING[Object.keys(ZONE_SPELLING).find(
          (k) => ZONE_SPELLING[k].name === zoneName
        )] || {}).number ?? null,
        wardCount: wards.length,
        wardStart: lo,
        wardEnd: hi,
        contiguous: hi - lo + 1 === wards.length,
        wards
      };
    })
    .sort((a, b) => a.wardStart - b.wardStart);

  const nonContiguous = zoneRanges.filter((z) => !z.contiguous);

  // Zones whose [wardStart, wardEnd] span overlaps another zone's span. A
  // ward_start/ward_end range cannot represent these zones without error.
  const overlapping = [];
  for (let i = 0; i < zoneRanges.length; i++) {
    for (let j = i + 1; j < zoneRanges.length; j++) {
      const a = zoneRanges[i];
      const b = zoneRanges[j];
      if (a.wardStart <= b.wardEnd && b.wardStart <= a.wardEnd) {
        overlapping.push({
          zoneA: a.zoneName, spanA: [a.wardStart, a.wardEnd],
          zoneB: b.zoneName, spanB: [b.wardStart, b.wardEnd]
        });
      }
    }
  }

  console.log("  kept " + kept.length + " ward polygons, dropped " + dropped.length);
  if (missing.length) console.log("  MISSING wards: " + missing.join(", "));
  if (duplicates > 0) console.log("  " + duplicates + " duplicate ward polygons");
  if (unknownZones.size) console.log("  UNMAPPED zone labels: " + [...unknownZones].join(", "));
  console.log("  zones: " + zoneRanges.length);
  for (const z of zoneRanges) {
    console.log(
      "    " + String(z.zoneNumber ?? "?").padStart(2) + " " + z.zoneName.padEnd(20) +
      " wards " + z.wardStart + "-" + z.wardEnd + " (n=" + z.wardCount + ")" +
      (z.contiguous ? "" : "  NON-CONTIGUOUS")
    );
  }
  if (overlapping.length) {
    console.log("  NOTE: " + overlapping.length + " zone ward-span overlap(s) — a plain");
    console.log("        ward_start/ward_end range cannot represent these zones exactly.");
    overlapping.forEach((o) =>
      console.log("        " + o.zoneA + " " + o.spanA.join("-") + " overlaps " + o.zoneB + " " + o.spanB.join("-"))
    );
  }

  // Bounding box of the municipal area — a cheap pre-filter only, never the
  // boundary test itself.
  let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      minLng = Math.min(minLng, c[0]); maxLng = Math.max(maxLng, c[0]);
      minLat = Math.min(minLat, c[1]); maxLat = Math.max(maxLat, c[1]);
    } else c.forEach(walk);
  };
  kept.forEach((f) => walk(f.geometry.coordinates));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify({ type: "FeatureCollection", features: kept }),
    "utf8"
  );
  console.log("  wrote data/boundaries/gcc-wards.geojson");

  const complete = missing.length === 0 && duplicates === 0 && kept.length === 200;
  fs.writeFileSync(
    META_FILE,
    JSON.stringify(
      {
        source,
        sourceLabel: SOURCE_LABEL,
        official: false,
        officialSourceNote:
          "GCC's own ArcGIS server (https://gis.chennaicorporation.gov.in/server/rest/services/) " +
          "was not used: its TLS certificate had expired at import time. Re-run with " +
          "--source <file> against an official GCC ward layer when one is obtainable.",
        fetchedAt,
        wardCount: kept.length,
        expectedWardCount: 200,
        complete,
        missingWards: missing,
        duplicateWardPolygons: duplicates,
        unmappedZoneLabels: [...unknownZones],
        droppedFeatures: dropped,
        zoneRanges: zoneRanges.map(({ wards, ...rest }) => rest),
        nonContiguousZones: nonContiguous.map((z) => ({
          zoneName: z.zoneName, wards: z.wards
        })),
        overlappingZoneSpans: overlapping,
        bbox: { minLng, minLat, maxLng, maxLat }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  console.log("  wrote data/boundaries/gcc-wards.meta.json");
  console.log(complete ? "OK: all 200 GCC wards present." : "WARNING: ward coverage is incomplete.");
})().catch((err) => {
  console.error("BOUNDARY IMPORT FAILED:", err.message);
  process.exit(1);
});
