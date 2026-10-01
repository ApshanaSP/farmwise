/**
 * Creates one Department Officer account per department that owns incidents in the
 * district intelligence store, so every officer dashboard can be signed into. Each
 * department has its own username and its own password:
 *
 *   officer.<code>@chennai.gov.in, e.g. officer.gcc-swm@chennai.gov.in, officer.pol-gcp@chennai.gov.in
 *
 * GCC departments are linked through users.department_id as well as users.dept_code;
 * the others (Police, Metrowater, PWD, ...) through dept_code only (migration 011).
 * Passwords are generated here, one per department, and never hard-coded or printed:
 * they are written to officer-accounts.local.csv (git-ignored) for the administrator to
 * hand to each department. Existing accounts keep their password unless --reset-passwords
 * is given, which gives every officer.<code> account a new password of its own.
 *
 *   node scripts/seed-officers.js                     create missing accounts
 *   node scripts/seed-officers.js --reset-passwords   also give every existing officer.<code> account a new password
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const { getDbConfig, describeDb } = require("./db-config");

// Mirrors DEPT_CONFIG[code].portalName in src/lib/officer/departments.ts.
const PORTAL_NAME = {
  "GCC-SWD": "Storm Water Drain Department",
  "GCC-SWM": "Solid Waste Management Department",
  "GCC-ENG": "Engineering Department (Town Planning & Building Permissions)",
  "GCC-ELE": "Electrical Department",
  "GCC-HLT": "Health Department",
  "GCC-PRK": "Parks & Play Fields Department",
  "GCC-REV": "Revenue Department",
  "GCC-GAD": "General Administration",
  "GCC-BRG": "Bridges Department",
  "GCC-EDU": "Education Department",
  "GCC-BLD": "Buildings Department",
  "GCC-MEC": "Mechanical Engineering Department",
  "GCC-LND": "Land & Estate Department",
  "GCC-FMU": "Financial Management Unit",
  "GCC-CNL": "Council Department",
  "GCC-FWD": "Family Welfare Department"
};

const FILE = path.join(__dirname, "..", "officer-accounts.local.csv");
const ALNUM = "abcdefghjkmnpqrstuvwxyz23456789";

/** A department's own password: its code, a symbol and 8 random letters and digits, e.g. "Swm#k7p2x9qa". */
function newPassword(code) {
  const tag = code.replace(/^(GCC|PWD|POL|HLT|DIST)-/, "").toLowerCase();
  const rand = Array.from({ length: 8 }, () => ALNUM[crypto.randomInt(ALNUM.length)]).join("");
  return `${tag[0].toUpperCase()}${tag.slice(1)}#${rand}`;
}

const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** The credentials file, keyed by username: rows from earlier runs are kept, this run's replace theirs. */
function readFile() {
  const out = new Map();
  if (!fs.existsSync(FILE)) return out;
  const lines = fs.readFileSync(FILE, "utf8").split(/\r?\n/).slice(1).filter(Boolean);
  for (const l of lines) {
    const parts = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((x) => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
    if (parts[0]) out.set(parts[0], parts);
  }
  return out;
}

async function main() {
  const reset = process.argv.includes("--reset-passwords");
  const cfg = getDbConfig();
  const intel = process.env.INTEL_DB_NAME || "district_intel";
  if (!/^[A-Za-z0-9_]+$/.test(intel)) throw new Error(`Invalid database name: ${intel}`);
  console.log("Database: " + describeDb());
  const db = await mysql.createConnection(cfg);

  const [[col]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'dept_code'`
  );
  if (!col.n) {
    console.error("users.dept_code is missing. Run `npm run migrate` first (migration 011).");
    process.exit(1);
  }

  let depts;
  try {
    [depts] = await db.query(`SELECT code, name, head FROM \`${intel}\`.ref_departments WHERE action_owner = 1 ORDER BY code`);
  } catch (e) {
    console.error(`Could not read ${intel}.ref_departments (${e.message}). Load the intelligence store first.`);
    process.exit(1);
  }
  const [portal] = await db.query(`SELECT id, name FROM departments`);
  const portalId = new Map(portal.map((d) => [d.name, d.id]));
  const file = readFile();

  let created = 0, changed = 0;
  for (const d of depts) {
    const email = `officer.${d.code.toLowerCase()}@chennai.gov.in`;
    const [have] = await db.query(`SELECT id, dept_code FROM users WHERE email = ?`, [email]);
    if (have.length && !reset) {
      console.log(`  keep   ${email} (exists; --reset-passwords gives it a new password)`);
      continue;
    }
    const password = newPassword(d.code);
    const hash = await bcrypt.hash(password, 10);
    if (have.length) {
      await db.query(`UPDATE users SET password_hash = ?, dept_code = COALESCE(dept_code, ?), is_active = TRUE WHERE id = ?`, [hash, d.code, have[0].id]);
      changed++;
      console.log(`  reset  ${email}  ${d.name}`);
    } else {
      const deptId = portalId.get(PORTAL_NAME[d.code]) ?? null;
      await db.query(
        `INSERT INTO users (email, password_hash, role, department_id, dept_code, is_active, email_verification_exempt)
         VALUES (?, ?, 'department_officer', ?, ?, TRUE, 1)`,
        [email, hash, deptId, d.code]
      );
      created++;
      console.log(`  create ${email}  ${d.name}${deptId ? "" : " (linked by dept_code)"}`);
    }
    file.set(email, [email, d.code, d.name, password]);
  }
  await db.end();

  if (created || changed) {
    const rows = [...file.values()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    fs.writeFileSync(FILE, ["username,department_code,department,password", ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n", { mode: 0o600 });
  }
  console.log(`\n${created} account(s) created, ${changed} password(s) reset.`);
  if (created || changed) console.log(`Each department's username and password: ${path.relative(process.cwd(), FILE)} (git-ignored; hand each department its own line).`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
