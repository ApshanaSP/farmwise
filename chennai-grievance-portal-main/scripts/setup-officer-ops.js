/**
 * Creates the Department Officer console's tables in district_intel_ops:
 *   officer_steps    every step an officer takes (approve, action taken, send to the Collector)
 *   officer_reports  completion reports sent to the Collector (remarks + photo files)
 * The pipeline never writes these; the consoles lay them over the pipeline's status,
 * the same way Collector decisions are laid over it. Idempotent: never drops data.
 *
 *   node scripts/setup-officer-ops.js
 */
const mysql = require("mysql2/promise");
const { getDbConfig } = require("./db-config");

const OPS = process.env.INTEL_OPS_DB_NAME || "district_intel_ops";
if (!/^[A-Za-z0-9_]+$/.test(OPS)) throw new Error(`Invalid database name: ${OPS}`);

const TABLES = [
  `CREATE TABLE IF NOT EXISTS officer_steps (
    step_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    incident_id VARCHAR(64) NOT NULL,
    dept_code VARCHAR(16) NOT NULL,
    step ENUM('approve','action','send') NOT NULL,
    note TEXT NULL,
    report_id BIGINT NULL COMMENT 'officer_reports row for a send step',
    actor VARCHAR(128) NOT NULL,
    actor_user_id INT NULL,
    at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_incident (incident_id, at),
    KEY ix_dept (dept_code, at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS officer_reports (
    report_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    incident_id VARCHAR(64) NOT NULL,
    dept_code VARCHAR(16) NOT NULL,
    remarks TEXT NOT NULL,
    photo_dir VARCHAR(64) NOT NULL COMMENT 'folder under OFFICER_UPLOAD_DIR',
    photos JSON NOT NULL COMMENT 'file names in photo_dir, in upload order',
    sent_by VARCHAR(128) NOT NULL,
    sent_user_id INT NULL,
    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY ux_photo_dir (photo_dir),
    KEY ix_incident (incident_id, sent_at),
    KEY ix_dept (dept_code, sent_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // Also created by the pipeline's MySQL export; here too so the officer console works on a fresh server.
  `CREATE TABLE IF NOT EXISTS collector_decisions (
    decision_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    incident_id VARCHAR(64) NOT NULL,
    decision ENUM('verify','escalate','reject','resolve','reopen','note') NOT NULL,
    escalate_to VARCHAR(64) NULL,
    note TEXT NULL,
    decided_by VARCHAR(128) NOT NULL,
    decided_role VARCHAR(64) NULL,
    decided_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_at DATETIME NULL,
    superseded_by BIGINT NULL,
    KEY ix_incident (incident_id, decided_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor VARCHAR(128) NOT NULL,
    action VARCHAR(64) NOT NULL,
    table_name VARCHAR(64) NOT NULL,
    record_id VARCHAR(128) NULL,
    before_value JSON NULL,
    after_value JSON NULL,
    KEY ix_record (table_name, record_id), KEY ix_at (at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

async function main() {
  const cfg = getDbConfig();
  delete cfg.database;
  const db = await mysql.createConnection(cfg);
  await db.query(`CREATE DATABASE IF NOT EXISTS \`${OPS}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await db.query(`USE \`${OPS}\``);
  for (const sql of TABLES) await db.query(sql);
  const [[s]] = await db.query(`SELECT COUNT(*) AS n FROM officer_steps`);
  const [[r]] = await db.query(`SELECT COUNT(*) AS n FROM officer_reports`);
  console.log(`${OPS}: officer_steps (${s.n} rows) and officer_reports (${r.n} rows) ready`);
  await db.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
