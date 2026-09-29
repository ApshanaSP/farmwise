/**
 * Loads the officials published on the GCC "Who's who" page into the
 * dashboard's own database (district_intel_ops) and creates the table that
 * records news complaints routed to a department officer.
 *
 *   node scripts/seed-official-contacts.js
 *
 * Source: data/gcc-reference/official-contacts.json, copied from
 * https://chennaicorporation.gov.in/gcc/who-is-who/. Re-running replaces the
 * contact list (it is reference data) but never touches dept_assignments.
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { getDbConfig } = require("./db-config");

const OPS = process.env.INTEL_OPS_DB_NAME || "district_intel_ops";
const FILE = path.join(__dirname, "..", "data", "gcc-reference", "official-contacts.json");

async function main() {
  const src = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const cfg = getDbConfig();
  delete cfg.database;
  const db = await mysql.createConnection(cfg);
  await db.query(`CREATE DATABASE IF NOT EXISTS \`${OPS}\``);
  await db.query(`USE \`${OPS}\``);

  await db.query(`CREATE TABLE IF NOT EXISTS official_contacts (
    contact_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    grp VARCHAR(64) NOT NULL,
    dept_code VARCHAR(16) NULL,
    zone_no INT NULL,
    region VARCHAR(16) NULL,
    \`rank\` INT NOT NULL DEFAULT 1,
    name VARCHAR(128) NOT NULL,
    designation VARCHAR(255) NOT NULL,
    office VARCHAR(255) NULL,
    phone VARCHAR(128) NULL,
    email VARCHAR(128) NULL,
    source_url VARCHAR(255) NOT NULL,
    retrieved_on DATE NOT NULL,
    KEY ix_dept (dept_code, \`rank\`),
    KEY ix_zone (zone_no)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await db.query(`CREATE TABLE IF NOT EXISTS dept_assignments (
    incident_id VARCHAR(64) NOT NULL PRIMARY KEY,
    dept_code VARCHAR(16) NOT NULL,
    contact_id INT NULL,
    officer_name VARCHAR(128) NULL,
    officer_designation VARCHAR(255) NULL,
    officer_phone VARCHAR(128) NULL,
    reason VARCHAR(255) NOT NULL,
    status ENUM('Assigned','Acknowledged','Closed') NOT NULL DEFAULT 'Assigned',
    assigned_by VARCHAR(128) NOT NULL,
    assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_dept (dept_code, assigned_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await db.beginTransaction();
  await db.query(`DELETE FROM official_contacts`);
  for (const c of src.contacts) {
    await db.query(
      `INSERT INTO official_contacts (grp, dept_code, zone_no, region, \`rank\`, name, designation, office, phone, email, source_url, retrieved_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.group, c.dept_code, c.zone_no, c.region ?? null, c.rank ?? 1, c.name, c.designation, c.office, c.phone, c.email,
        src.source, src.retrieved_on]
    );
  }
  await db.commit();
  const [[n]] = await db.query(`SELECT COUNT(*) AS n FROM official_contacts`);
  console.log(`official_contacts: ${n.n} officials from ${src.source} (retrieved ${src.retrieved_on})`);
  await db.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
