/**
 * Loads schema.sql into whichever database the connection points at.
 *
 * Intended for a freshly provisioned managed database (Railway, Aiven, ...),
 * where you are given an empty database with a fixed name rather than the
 * privilege to create `district_collector_dashboard` yourself. The
 * `CREATE DATABASE` / `USE` statements at the top of schema.sql are therefore
 * stripped, and everything else runs into the connected database.
 *
 *   node scripts/bootstrap-db.js
 *   node scripts/bootstrap-db.js --force   # allow running over existing tables
 *
 * SAFETY: schema.sql contains `DROP TABLE IF EXISTS`, so running it against a
 * database that already holds complaints would destroy them. This script
 * refuses to run when the target database is non-empty unless --force is given
 * explicitly.
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { getDbConfig, describeDb } = require("./db-config");

const FORCE = process.argv.includes("--force");
const SCHEMA_PATH = path.join(__dirname, "..", "schema.sql");

(async () => {
  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error("schema.sql not found at " + SCHEMA_PATH);
    process.exit(1);
  }

  console.log("Database: " + describeDb());
  const conn = await mysql.createConnection({
    ...getDbConfig(),
    multipleStatements: true
  });

  const [tables] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
  );

  if (tables.length > 0 && !FORCE) {
    console.error(
      "\nRefusing to run: this database already has " + tables.length + " table(s).\n" +
      "schema.sql drops and recreates tables, which would destroy existing data.\n\n" +
      "  - To bring an EXISTING database up to date, run migrations instead:\n" +
      "      npm run migrate\n" +
      "  - To wipe and rebuild anyway (destroys all data):\n" +
      "      node scripts/bootstrap-db.js --force\n"
    );
    await conn.end();
    process.exit(1);
  }

  if (tables.length > 0 && FORCE) {
    console.log("! --force: dropping and recreating " + tables.length + " existing table(s)");
  }

  let sql = fs.readFileSync(SCHEMA_PATH, "utf8");
  // The managed database already exists and is already selected.
  sql = sql
    .replace(/CREATE\s+DATABASE[^;]*;/gi, "")
    .replace(/^\s*USE\s+[^;]*;/gim, "");

  console.log("Applying schema.sql ...");
  await conn.query(sql);

  const [after] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
  );
  console.log("Schema loaded: " + after.length + " tables.");
  console.log("Next: npm run migrate && npm run seed:gcc");

  await conn.end();
})().catch((err) => {
  console.error("Bootstrap failed:", err.message);
  process.exit(1);
});
