/**
 * Loads the imported GCC reference JSON into the database.
 *
 *   node scripts/import-gcc-reference.js --streets   # fetch first
 *   node scripts/import-ward-boundaries.js
 *   node scripts/seed-gcc-reference.js               # then load
 *
 * Idempotent: every write is an INSERT ... ON DUPLICATE KEY UPDATE keyed on the
 * GCC id, so re-running refreshes labels without creating duplicates and
 * without disturbing complaints that already reference a row.
 *
 * DEPARTMENT ROUTING
 * ------------------
 * GCC does not publish its internal department routing on the citizen page, so
 * this seeder does NOT guess. CATEGORY_DEPARTMENT below maps only categories
 * whose GCC name unambiguously matches a department already in this app's
 * `departments` table. Everything else is left department_id = NULL /
 * mapping_status = 'unmapped'; the complaints API routes those to a fallback
 * department and flags them for manual review instead of silently mis-routing.
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { getDbConfig, describeDb } = require("./db-config");

const REF_DIR = path.join(__dirname, "..", "data", "gcc-reference");
const BND_DIR = path.join(__dirname, "..", "data", "boundaries");

// Every GCC category is routed to a department. Eight of these are
// unambiguous from the category name; the rest (marked below) are this
// application's own best-fit assignment, because GCC does not publish its
// internal routing on the citizen page. Complaints of an assigned-not-
// published type are still flagged for an officer to confirm.
//
// "Other" is deliberately absent: it has no fixed department, and the
// classifier in src/lib/ai-classifier.ts routes it from the citizen's own
// description at submit time.
const CATEGORY_DEPARTMENT = {
  // Unambiguous
  "Street Light": "Electrical Department",
  "Garbage": "Solid Waste Management Department",
  "Water Stagnation": "Storm Water Drain Department",
  "Storm Water Drains": "Storm Water Drain Department",
  "Public Health": "Health Department",
  "Park and Playground": "Parks & Play Fields Department",
  "Building Plan Permission": "Engineering Department (Town Planning & Building Permissions)",
  "Tax and Licence": "Revenue Department",

  // Best-fit assignment, not published by GCC
  "Public Toilet": "Health Department",
  "Road and Footpath": "Engineering Department (Town Planning & Building Permissions)",
  "Air Quality": "Health Department",
  "Flood": "Storm Water Drain Department",
  "Voter ID": "General Administration",
  "General": "General Administration",
  "MEGA STREETS - PLANNING PHASE": "Engineering Department (Town Planning & Building Permissions)",
  "MEGA STREETS - OPERATION PHASE": "Engineering Department (Town Planning & Building Permissions)",
  "MEGA STREETS - CONSTRUCTION PHASE": "Engineering Department (Town Planning & Building Permissions)"
};

// Categories whose department this app assigned rather than read from GCC.
// Stored as mapping_status='assumed' so an officer knows to confirm routing.
const ASSUMED_CATEGORIES = new Set([
  "Public Toilet", "Road and Footpath", "Air Quality", "Flood",
  "Voter ID", "General",
  "MEGA STREETS - PLANNING PHASE",
  "MEGA STREETS - OPERATION PHASE",
  "MEGA STREETS - CONSTRUCTION PHASE"
]);

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Insert rows in chunks so a 100k-row table does not become one giant query. */
async function bulk(conn, sql, rows, chunkSize) {
  chunkSize = chunkSize || 500;
  let n = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await conn.query(sql, [chunk]);
    n += chunk.length;
  }
  return n;
}

async function recordSource(conn, dataset, info) {
  await conn.query(
    `INSERT INTO reference_data_sources
       (dataset, source_url, source_label, is_official, fetched_at, row_count, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       source_url = VALUES(source_url), source_label = VALUES(source_label),
       is_official = VALUES(is_official), fetched_at = VALUES(fetched_at),
       row_count = VALUES(row_count), notes = VALUES(notes)`,
    [
      dataset,
      info.url || null,
      info.label || null,
      info.official ? 1 : 0,
      info.fetchedAt ? new Date(info.fetchedAt) : null,
      info.rowCount ?? null,
      info.notes || null
    ]
  );
}

async function main() {
  console.log("Database: " + describeDb());
  const conn = await mysql.createConnection(getDbConfig());

  // ---- Departments lookup -------------------------------------------------
  const [deptRows] = await conn.query("SELECT id, name FROM departments");
  const deptByName = new Map(deptRows.map((d) => [d.name, d.id]));

  // =========================================================================
  // 1. Complaint categories + subcomplaints
  // =========================================================================
  const types = readJson(path.join(REF_DIR, "complaint-types.json"));
  if (!types) {
    console.log("! data/gcc-reference/complaint-types.json missing — run import-gcc-reference.js");
  } else {
    const frequentById = new Map(types.frequent.map((f, i) => [f.gccId, i]));
    let catCount = 0;
    let subCount = 0;
    let unmapped = 0;
    const unmappedCategories = [];

    for (const cat of types.categories) {
      const deptName = CATEGORY_DEPARTMENT[cat.category];
      const deptId = deptName ? deptByName.get(deptName) : null;
      if (deptName && !deptId) {
        console.log("! category '" + cat.category + "' maps to unknown department '" + deptName + "'");
      }
      if (!deptId) unmappedCategories.push(cat.category);

      await conn.query(
        `INSERT INTO complaint_categories (name, sort_order, source, source_fetched_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           sort_order = VALUES(sort_order), source = VALUES(source),
           source_fetched_at = VALUES(source_fetched_at), is_active = 1`,
        [cat.category, cat.sortOrder, types.source, new Date(types.fetchedAt)]
      );
      const [[{ id: categoryId }]] = await conn.query(
        "SELECT id FROM complaint_categories WHERE name = ?",
        [cat.category]
      );
      catCount++;

      const rows = cat.subcomplaints.map((s, i) => [
        categoryId,
        s.gccId,
        s.label,
        deptId || null,
        deptId ? (ASSUMED_CATEGORIES.has(cat.category) ? "assumed" : "mapped") : "unmapped",
        frequentById.has(s.gccId) ? 1 : 0,
        frequentById.has(s.gccId) ? frequentById.get(s.gccId) : null,
        i
      ]);
      if (rows.length) {
        await bulk(
          conn,
          `INSERT INTO complaint_subtypes
             (category_id, gcc_id, label, department_id, mapping_status,
              is_frequent, frequent_order, sort_order)
           VALUES ?
           ON DUPLICATE KEY UPDATE
             category_id = VALUES(category_id), label = VALUES(label),
             department_id = VALUES(department_id), mapping_status = VALUES(mapping_status),
             is_frequent = VALUES(is_frequent), frequent_order = VALUES(frequent_order),
             sort_order = VALUES(sort_order), is_active = 1`,
          rows
        );
      }
      subCount += rows.length;
      if (!deptId) unmapped += rows.length;
    }

    console.log(
      "Complaint taxonomy: " + catCount + " categories, " + subCount + " subcomplaints (" +
      unmapped + " without a verified department mapping)"
    );
    console.log("  unmapped categories: " + unmappedCategories.join(", "));

    await recordSource(conn, "complaint_types", {
      url: types.source,
      label: "GCC PGR 'Register Complaint' page complaint-type selects",
      official: true,
      fetchedAt: types.fetchedAt,
      rowCount: subCount,
      notes:
        unmapped + " of " + subCount + " subcomplaints have no verified department " +
        "mapping (GCC does not publish routing on the citizen page). Categories " +
        "without a mapping: " + unmappedCategories.join(", ")
    });
  }

  // =========================================================================
  // 2. Areas + localities
  // =========================================================================
  const areasFile = readJson(path.join(REF_DIR, "areas-localities.json"));
  if (!areasFile) {
    console.log("! data/gcc-reference/areas-localities.json missing — run import-gcc-reference.js");
  } else {
    await bulk(
      conn,
      `INSERT INTO gcc_areas (gcc_id, name) VALUES ?
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      areasFile.areas.map((a) => [a.gccId, a.name])
    );
    const [areaRows] = await conn.query("SELECT id, gcc_id FROM gcc_areas");
    const areaIdByGcc = new Map(areaRows.map((r) => [r.gcc_id, r.id]));

    const locRows = areasFile.localities
      .filter((l) => areaIdByGcc.has(l.areaGccId))
      .map((l) => [l.gccId, l.name, areaIdByGcc.get(l.areaGccId)]);
    await bulk(
      conn,
      `INSERT INTO gcc_localities (gcc_id, name, area_id) VALUES ?
       ON DUPLICATE KEY UPDATE name = VALUES(name), area_id = VALUES(area_id)`,
      locRows
    );
    console.log("Locations: " + areasFile.areas.length + " areas, " + locRows.length + " localities");

    await recordSource(conn, "gcc_areas_localities", {
      url: areasFile.source,
      label: "GCC PGR Area/Locality boundary combos",
      official: true,
      fetchedAt: areasFile.fetchedAt,
      rowCount: locRows.length,
      notes: "GCC's citizen page exposes Area -> Locality -> Street but no ward numbers."
    });
  }

  // =========================================================================
  // 3. Streets
  // =========================================================================
  const streetsFile = readJson(path.join(REF_DIR, "streets.json"));
  if (!streetsFile) {
    console.log("! data/gcc-reference/streets.json missing — run import-gcc-reference.js --streets");
  } else {
    if (streetsFile.partial) {
      console.log("! streets.json is a PARTIAL import — re-run the importer to finish it");
    }
    const [locRows2] = await conn.query("SELECT id, gcc_id FROM gcc_localities");
    const locIdByGcc = new Map(locRows2.map((r) => [r.gcc_id, r.id]));

    const seen = new Set();
    const rows = [];
    for (const s of streetsFile.streets) {
      if (!locIdByGcc.has(s.localityGccId) || seen.has(s.gccId)) continue;
      seen.add(s.gccId);
      rows.push([s.gccId, s.name, locIdByGcc.get(s.localityGccId)]);
    }
    const n = await bulk(
      conn,
      `INSERT INTO gcc_streets (gcc_id, name, locality_id) VALUES ?
       ON DUPLICATE KEY UPDATE name = VALUES(name), locality_id = VALUES(locality_id)`,
      rows,
      1000
    );
    console.log("Streets: " + n + " loaded" + (streetsFile.partial ? " (PARTIAL)" : ""));

    await recordSource(conn, "gcc_streets", {
      url: streetsFile.source,
      label: "GCC PGR Street boundary combos",
      official: true,
      fetchedAt: streetsFile.fetchedAt,
      rowCount: n,
      notes: streetsFile.partial
        ? "PARTIAL import — some localities have no streets loaded yet."
        : "Complete import. Citizens can still type a street manually when one is missing."
    });
  }

  // =========================================================================
  // 4. Ward -> zone from boundary polygons
  // =========================================================================
  const meta = readJson(path.join(BND_DIR, "gcc-wards.meta.json"));
  const geo = readJson(path.join(BND_DIR, "gcc-wards.geojson"));
  if (!meta || !geo) {
    console.log("! data/boundaries/gcc-wards.* missing — run import-ward-boundaries.js");
  } else {
    const [zoneRows] = await conn.query("SELECT id, zone_number, zone_name FROM zones");
    const zoneIdByNumber = new Map(zoneRows.map((z) => [z.zone_number, z.id]));

    const wardRows = [];
    const unresolved = [];
    for (const f of geo.features) {
      const p = f.properties;
      const zoneId = zoneIdByNumber.get(p.zone_number);
      if (!zoneId) {
        unresolved.push(p.ward_no);
        continue;
      }
      wardRows.push([p.ward_no, zoneId, meta.sourceLabel, meta.fetchedAt]);
    }
    await bulk(
      conn,
      `INSERT INTO zone_wards (ward_number, zone_id, source, source_version) VALUES ?
       ON DUPLICATE KEY UPDATE
         zone_id = VALUES(zone_id), source = VALUES(source),
         source_version = VALUES(source_version)`,
      wardRows
    );
    console.log("Ward -> zone: " + wardRows.length + " wards" +
      (unresolved.length ? " (" + unresolved.length + " unresolved)" : ""));

    // Bring zones.ward_start/ward_end in line with the boundary data. These are
    // display-only: validation uses zone_wards, because Adyar and Perungudi
    // have overlapping ward spans that a range cannot express.
    for (const z of meta.zoneRanges) {
      if (z.zoneNumber == null) continue;
      await conn.query(
        "UPDATE zones SET ward_start = ?, ward_end = ? WHERE zone_number = ?",
        [z.wardStart, z.wardEnd, z.zoneNumber]
      );
    }
    console.log("  zones.ward_start/ward_end refreshed from boundary data");

    await recordSource(conn, "ward_boundaries", {
      url: meta.source,
      label: meta.sourceLabel,
      official: meta.official,
      fetchedAt: meta.fetchedAt,
      rowCount: meta.wardCount,
      notes:
        "Community dataset, NOT a GCC publication. " + meta.officialSourceNote +
        (meta.overlappingZoneSpans && meta.overlappingZoneSpans.length
          ? " Overlapping zone ward-spans: " +
            meta.overlappingZoneSpans
              .map((o) => o.zoneA + " " + o.spanA.join("-") + " vs " + o.zoneB + " " + o.spanB.join("-"))
              .join("; ") + "."
          : "")
    });
  }

  console.log("\nSeed complete.");
  await conn.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
