/**
 * Rebuilds the grievance dataset CSVs from MySQL.
 *
 *   node scripts/export-grievance-dataset.js      # npm run dataset:export
 *
 * Writes, under DATASET_DIR (default data/datasets):
 *   grievances.csv                  one row per complaint (38 columns)
 *   grievance_status_history.csv    one row per status change (6 columns)
 *
 * Every complaint is included, real and synthetic. Files are written to a temp
 * file and renamed, so a rebuild never leaves a half-written dataset and always
 * repairs drift left by live appends (which record a complaint as it was when
 * filed).
 *
 * CONTAINS PERSONAL DATA from real complaints.
 */
const path = require("path");
const mysql = require("mysql2/promise");
const { getDbConfig, describeDb } = require("./db-config");
const { exportDataset } = require("./lib/dataset-export");

(async () => {
  console.log("Database: " + describeDb());
  const conn = await mysql.createConnection(getDbConfig());
  const { paths, complaints, history } = await exportDataset(conn, {
    root: path.join(__dirname, "..")
  });
  await conn.end();

  const synthetic = complaints.filter((c) => Number(c["Is Synthetic"]) === 1).length;
  console.log(
    "Exported " + complaints.length + " complaint(s) (" + synthetic + " synthetic, " +
    (complaints.length - synthetic) + " real) and " + history.length + " status change(s)"
  );
  console.log("  -> " + paths.grievances);
  console.log("  -> " + paths.history);
})().catch((e) => {
  console.error("Dataset export failed:", e.message);
  process.exit(1);
});
