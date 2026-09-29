/**
 * Creates the dashboard's own tables in district_intel_ops for connected sources,
 * their runs and fetched items, and AGMARKNET mandi prices (state, region and each
 * Chennai market), then registers the
 * built-in sources. Idempotent: safe to re-run; never drops data.
 *
 *   node scripts/setup-intel-ops.js
 */
const mysql = require("mysql2/promise");
const { getDbConfig } = require("./db-config");

const OPS = process.env.INTEL_OPS_DB_NAME || "district_intel_ops";

const TABLES = [
  `CREATE TABLE IF NOT EXISTS sources (
    source_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    url VARCHAR(500) NOT NULL,
    kind ENUM('pipeline','agmarknet','rss','html','json','ocr') NOT NULL,
    description VARCHAR(500) NULL,
    pipeline_key VARCHAR(32) NULL COMMENT 'source_health.source for feeds collected by the district_intel pipeline',
    auth ENUM('none','basic','form','token') NOT NULL DEFAULT 'none',
    login_url VARCHAR(500) NULL,
    user_field VARCHAR(64) NULL,
    pass_field VARCHAR(64) NULL,
    username VARCHAR(255) NULL,
    secret_enc TEXT NULL,
    session_enc TEXT NULL,
    session_expires_at DATETIME NULL,
    refresh_minutes INT NOT NULL DEFAULT 60,
    enabled TINYINT NOT NULL DEFAULT 1,
    status VARCHAR(24) NOT NULL DEFAULT 'new',
    last_run_at DATETIME NULL,
    last_ok_at DATETIME NULL,
    last_error VARCHAR(500) NULL,
    items_total INT NOT NULL DEFAULT 0,
    created_by VARCHAR(128) NOT NULL DEFAULT 'system',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY ux_url_kind (url(255), kind)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS source_runs (
    run_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    source_id INT NOT NULL,
    started_at DATETIME NOT NULL,
    finished_at DATETIME NULL,
    ok TINYINT NOT NULL DEFAULT 0,
    http_status INT NULL,
    items_seen INT NOT NULL DEFAULT 0,
    items_new INT NOT NULL DEFAULT 0,
    login VARCHAR(16) NULL COMMENT 'none | reused | fresh | failed',
    attempts INT NOT NULL DEFAULT 1,
    error VARCHAR(500) NULL,
    triggered_by VARCHAR(128) NULL,
    KEY ix_source (source_id, started_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS source_items (
    item_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    source_id INT NOT NULL,
    hash CHAR(40) NOT NULL,
    url VARCHAR(700) NULL,
    title VARCHAR(500) NOT NULL,
    body TEXT NULL,
    published_at DATETIME NULL,
    fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lang VARCHAR(8) NULL,
    category_code VARCHAR(64) NULL,
    category_label VARCHAR(128) NULL,
    dept_code VARCHAR(16) NULL,
    category_conf FLOAT NULL,
    matched_terms VARCHAR(255) NULL,
    zone_no INT NULL,
    ward_no INT NULL,
    taluk_code VARCHAR(16) NULL,
    place VARCHAR(255) NULL,
    place_conf FLOAT NULL,
    lat DOUBLE NULL,
    lon DOUBLE NULL,
    place_v TINYINT NOT NULL DEFAULT 0 COMMENT 'version of the place resolver that placed the item',
    is_incident TINYINT NOT NULL DEFAULT 0,
    origin ENUM('fetch','ocr') NOT NULL DEFAULT 'fetch',
    UNIQUE KEY ux_hash (hash),
    KEY ix_source (source_id, fetched_at),
    KEY ix_published (published_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS mandi_prices (
    date DATE NOT NULL,
    scope VARCHAR(24) NOT NULL COMMENT 'chennai_markets | tamil_nadu',
    commodity VARCHAR(96) NOT NULL,
    cmdt_group VARCHAR(64) NULL,
    price DECIMAL(10,2) NULL COMMENT 'modal price, Rs per quintal',
    arrival DECIMAL(12,2) NULL COMMENT 'metric tonnes',
    msp DECIMAL(10,2) NULL,
    fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (date, scope, commodity)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS mandi_weekly (
    week_start DATE NOT NULL,
    week_label VARCHAR(40) NOT NULL,
    scope VARCHAR(24) NOT NULL COMMENT 'chennai_region | tamil_nadu',
    commodity VARCHAR(96) NOT NULL,
    price DECIMAL(10,2) NULL COMMENT 'average wholesale price, Rs per quintal',
    districts INT NOT NULL DEFAULT 0,
    chg_week DECIMAL(7,2) NULL, chg_month DECIMAL(7,2) NULL, chg_year DECIMAL(7,2) NULL,
    fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (week_start, scope, commodity)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS mandi_market_prices (
    date DATE NOT NULL,
    market VARCHAR(96) NOT NULL COMMENT 'AGMARKNET market centre, e.g. Anna nagar(Uzhavar Sandhai)',
    commodity VARCHAR(96) NOT NULL,
    variety VARCHAR(96) NOT NULL DEFAULT '',
    cmdt_group VARCHAR(64) NULL,
    min_price DECIMAL(10,2) NULL COMMENT 'Rs per quintal',
    max_price DECIMAL(10,2) NULL,
    modal_price DECIMAL(10,2) NULL,
    arrival DECIMAL(12,3) NULL COMMENT 'metric tonnes',
    fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (date, market, commodity, variety),
    KEY ix_market (market, commodity, date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

// Columns added after the first release: [table, column, definition].
const COLUMNS = [
  ["source_items", "lat", "DOUBLE NULL AFTER place_conf"],
  ["source_items", "lon", "DOUBLE NULL AFTER lat"],
  ["source_items", "place_v", "TINYINT NOT NULL DEFAULT 0 COMMENT 'version of the place resolver that placed the item' AFTER lon"]
];

// Feeds the district_intel pipeline collects (status comes from its source_health table).
const BUILTIN = [
  ["Grievance portal", "http://localhost:3000/citizen", "pipeline", "grievance", 30, "Citizen complaints filed on this portal"],
  ["Police incident reports", "police_dataset_generator (department export)", "pipeline", "police", 30, "Station and control-room incident records"],
  ["PWD Water Resources", "pwd_dataset_generator (department export)", "pipeline", "pwd", 30, "Water levels, works, incidents and announcements"],
  ["Hospital MIS", "chennai_hospital_data (department export)", "pipeline", "hospital", 30, "Government hospital capacity and alerts"],
  ["District news monitor", "chennai_news_pipeline (English and Tamil outlets)", "pipeline", "news", 30, "District news from approved outlets, classified and clustered"],
  ["IMD weather", "https://mausam.imd.gov.in/chennai/", "pipeline", "imd", 30, "Warnings, rainfall observations and forecasts"],
  ["CPCB air quality", "https://airquality.cpcb.gov.in/ccr/", "pipeline", "cpcb", 30, "Continuous air-quality stations"],
  ["Chennai Flood Monitoring (CFM-DSS)", "https://chennaifloodmonitor.tn.gov.in", "pipeline", "cfm", 30, "Lake levels, river gauges and bulletins"],
  ["AGMARKNET mandi prices", "https://agmarknet.gov.in", "agmarknet", null, 360, "Daily prices at each Chennai market (Uzhavar Sandhai farmer markets), plus Tamil Nadu and the districts around Chennai"],
  ["Newspaper pages (OCR)", "upload://newspaper-pages", "ocr", null, 0, "Scanned or photographed newspaper pages, read with OCR in the browser"]
];

async function main() {
  const cfg = getDbConfig();
  delete cfg.database;
  const db = await mysql.createConnection(cfg);
  await db.query(`CREATE DATABASE IF NOT EXISTS \`${OPS}\``);
  await db.query(`USE \`${OPS}\``);
  for (const sql of TABLES) await db.query(sql);
  for (const [table, column, def] of COLUMNS) {
    const [[has]] = await db.query(
      `SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?`, [OPS, table, column]);
    if (!has.n) await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${def}`);
  }
  for (const [name, url, kind, key, refresh, desc] of BUILTIN) {
    await db.query(
      `INSERT INTO sources (name, url, kind, pipeline_key, refresh_minutes, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'system')
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), pipeline_key = VALUES(pipeline_key)`,
      [name, url, kind, key, refresh, desc]
    );
  }
  const [[n]] = await db.query(`SELECT COUNT(*) AS n FROM sources`);
  console.log(`${OPS}: sources, source_runs, source_items, mandi_prices, mandi_weekly, mandi_market_prices ready; ${n.n} sources registered`);
  await db.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
