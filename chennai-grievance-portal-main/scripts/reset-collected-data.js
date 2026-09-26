/**
 * Deletes everything citizens have entered, leaving the reference data intact.
 *
 *   node scripts/reset-collected-data.js --yes
 *
 * REMOVES : complaint_status_history, complaints, user_profiles,
 *           password_resets, users
 * KEEPS   : departments, zones, zone_wards, gcc_areas, gcc_localities,
 *           gcc_streets, complaint_categories, complaint_subtypes,
 *           area_wards, locality_wards, reference_data_sources,
 *           schema_migrations
 *
 * Re-importing the reference data takes ~20 minutes and makes thousands of
 * requests to the Corporation's servers, so it is deliberately never touched
 * here. To rebuild that too, use `node scripts/bootstrap-db.js --force`.
 *
 * Requires --yes. Prints what it is about to remove and cannot be undone.
 */
const mysql = require("mysql2/promise");
const { getDbConfig, describeDb } = require("./db-config");

// Child rows first, so foreign keys never block a delete.
const WIPE_ORDER = [
  "complaint_status_history",
  "complaints",
  "user_profiles",
  "password_resets",
  "users"
];

const KEEP = [
  "departments", "zones", "zone_wards", "gcc_areas", "gcc_localities",
  "gcc_streets", "complaint_categories", "complaint_subtypes", "area_wards",
  "locality_wards", "reference_data_sources", "schema_migrations"
];

const CONFIRMED = process.argv.includes("--yes");

(async () => {
  console.log("Database: " + describeDb() + "\n");
  const conn = await mysql.createConnection(getDbConfig());

  const counts = {};
  for (const t of WIPE_ORDER) {
    const [[r]] = await conn.query("SELECT COUNT(*) n FROM `" + t + "`");
    counts[t] = r.n;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log("Will DELETE:");
  for (const t of WIPE_ORDER) console.log("  " + t.padEnd(26) + counts[t]);

  if (total === 0) {
    console.log("\nNothing to delete — already empty.");
    await conn.end();
    return;
  }

  if (!CONFIRMED) {
    console.log("\nKeeping reference data: " + KEEP.join(", "));
    console.log("\nThis cannot be undone. Re-run with --yes to proceed.");
    await conn.end();
    process.exit(1);
  }

  for (const t of WIPE_ORDER) {
    await conn.query("DELETE FROM `" + t + "`");
    // Restart IDs so a fresh install looks fresh.
    await conn.query("ALTER TABLE `" + t + "` AUTO_INCREMENT = 1");
    console.log("  cleared " + t);
  }

  console.log("\nReference data left untouched:");
  for (const t of KEEP) {
    try {
      const [[r]] = await conn.query("SELECT COUNT(*) n FROM `" + t + "`");
      console.log("  " + t.padEnd(26) + r.n);
    } catch {
      /* table may not exist on older installs */
    }
  }

  console.log("\nDone. " + total + " row(s) removed.");
  await conn.end();
})().catch((err) => {
  console.error("Reset failed:", err.message);
  process.exit(1);
});
