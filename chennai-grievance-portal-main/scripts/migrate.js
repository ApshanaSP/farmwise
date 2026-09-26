/**
 * Forward-only migration runner.
 *
 *   node scripts/migrate.js            # apply every pending migration
 *   node scripts/migrate.js --status   # list applied / pending, change nothing
 *   node scripts/migrate.js --dry-run  # print the SQL that would run
 *
 * Migrations live in migrations/NNN_name.sql and are applied in filename order.
 * Applied filenames are recorded in `schema_migrations`, so re-running is safe
 * and does not repeat work. Migrations are additive: none of them drop a column
 * or table that holds complaint data.
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { getDbConfig, describeDb } = require("./db-config");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const STATUS_ONLY = process.argv.includes("--status");
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log("Database: " + describeDb());
  const conn = await mysql.createConnection({
    ...getDbConfig(),
    multipleStatements: true
  });

  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [appliedRows] = await conn.query("SELECT filename FROM schema_migrations");
  const applied = new Set(appliedRows.map((r) => r.filename));

  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()
    : [];

  if (files.length === 0) {
    console.log("No migrations found in migrations/.");
    await conn.end();
    return;
  }

  const pending = files.filter((f) => !applied.has(f));

  if (STATUS_ONLY) {
    console.log("Migrations:");
    for (const f of files) console.log("  [" + (applied.has(f) ? "x" : " ") + "] " + f);
    console.log("\n" + applied.size + " applied, " + pending.length + " pending.");
    await conn.end();
    return;
  }

  if (pending.length === 0) {
    console.log("Database is up to date (" + applied.size + " migrations applied).");
    await conn.end();
    return;
  }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    if (DRY_RUN) {
      console.log("\n--- " + file + " ---\n" + sql);
      continue;
    }
    process.stdout.write("Applying " + file + " ... ");
    try {
      await conn.query(sql);
      await conn.query("INSERT INTO schema_migrations (filename) VALUES (?)", [file]);
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      console.error("\n" + file + " failed: " + err.message);
      console.error(
        "\nNothing was recorded for this migration. Fix the SQL and re-run; " +
        "migrations applied before this one stay applied."
      );
      await conn.end();
      process.exit(1);
    }
  }

  if (!DRY_RUN) console.log("\nDone. " + pending.length + " migration(s) applied.");
  await conn.end();
}

main().catch((err) => {
  console.error("Migration runner failed:", err.message);
  process.exit(1);
});
