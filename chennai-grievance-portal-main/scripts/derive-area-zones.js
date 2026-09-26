/**
 * Fills gcc_areas.zone_id from the area -> ward mapping, so the complaint form
 * can offer "streets in this zone".
 *
 * An area's zone is the zone of its primary (point-in-polygon) ward where one
 * exists, otherwise the zone holding most of its candidate wards. Both inherit
 * the 'derived' caveat of area_wards: this groups streets for the dropdown, it
 * never decides which ward a complaint belongs to.
 *
 *   node scripts/derive-area-zones.js
 */
const mysql = require("mysql2/promise");
const { getDbConfig, describeDb } = require("./db-config");

(async () => {
  console.log("Database: " + describeDb());
  const conn = await mysql.createConnection(getDbConfig());

  const [rows] = await conn.query(
    `SELECT aw.area_id, aw.ward_number, aw.is_primary, zw.zone_id
       FROM area_wards aw JOIN zone_wards zw ON zw.ward_number = aw.ward_number`
  );

  const byArea = new Map();
  for (const r of rows) {
    const e = byArea.get(r.area_id) || { primary: null, tally: new Map() };
    if (r.is_primary === 1) e.primary = r.zone_id;
    e.tally.set(r.zone_id, (e.tally.get(r.zone_id) || 0) + 1);
    byArea.set(r.area_id, e);
  }

  let viaPrimary = 0;
  let viaMajority = 0;
  for (const [areaId, e] of byArea) {
    let zoneId = e.primary;
    if (zoneId) viaPrimary++;
    else {
      // Most-represented zone among the candidate wards.
      zoneId = [...e.tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
      viaMajority++;
    }
    await conn.query("UPDATE gcc_areas SET zone_id = ? WHERE id = ?", [zoneId, areaId]);
  }

  const [[mapped]] = await conn.query("SELECT COUNT(*) n FROM gcc_areas WHERE zone_id IS NOT NULL");
  const [[total]] = await conn.query("SELECT COUNT(*) n FROM gcc_areas");
  const [perZone] = await conn.query(
    `SELECT z.zone_number, z.zone_name, COUNT(DISTINCT a.id) areas,
            (SELECT COUNT(*) FROM gcc_streets s
               JOIN gcc_localities l ON l.id = s.locality_id
              WHERE l.area_id IN (SELECT id FROM gcc_areas WHERE zone_id = z.id)) streets
       FROM zones z LEFT JOIN gcc_areas a ON a.zone_id = z.id
      GROUP BY z.id ORDER BY z.zone_number`
  );

  console.log(
    "\nAreas with a zone: " + mapped.n + "/" + total.n +
    "  (" + viaPrimary + " from a primary ward, " + viaMajority + " by majority)"
  );
  console.log("\nZone".padEnd(24) + "areas  streets");
  for (const z of perZone) {
    console.log(
      ("  " + z.zone_number + " " + z.zone_name).padEnd(24) +
      String(z.areas).padStart(5) + String(z.streets).padStart(9)
    );
  }
  const unmapped = total.n - mapped.n;
  if (unmapped) console.log("\n" + unmapped + " area(s) have no zone; their streets are reachable only by searching all zones.");

  await conn.end();
})().catch((e) => { console.error("Failed:", e.message); process.exit(1); });
