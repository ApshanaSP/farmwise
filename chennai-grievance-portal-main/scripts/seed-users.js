/**
 * Seeds 3 sample accounts (one per role) with a correctly-generated
 * bcrypt hash for the password: Passw0rd!
 *
 * Run after `npm install` and after loading schema.sql:
 *   node scripts/seed-users.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const SAMPLE_PASSWORD = "Passw0rd!";

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "district_collector_dashboard"
  });

  const passwordHash = await bcrypt.hash(SAMPLE_PASSWORD, 10);

  const users = [
    { email: "collector@chennai.gov.in", role: "collector", department_id: null },
    { email: "officer.electrical@chennai.gov.in", role: "department_officer", department_id: 3 },
    { email: "citizen@example.com", role: "citizen", department_id: null }
  ];

  for (const u of users) {
    const [existing] = await connection.execute(
      "SELECT id FROM users WHERE email = ?",
      [u.email]
    );
    if (existing.length > 0) {
      console.log(`Skipping ${u.email} (already exists)`);
      continue;
    }
    const [result] = await connection.execute(
      "INSERT INTO users (email, password_hash, role, department_id, is_active) VALUES (?, ?, ?, ?, TRUE)",
      [u.email, passwordHash, u.role, u.department_id]
    );
    console.log(`Created ${u.role}: ${u.email}`);

    if (u.role === "citizen") {
      await connection.execute(
        `INSERT INTO user_profiles
          (user_id, first_name, last_name, gender, mobile_number, mobile_verified, zone_id, ward_number, area, locality)
         VALUES (?, 'Test', 'Citizen', 'Male', '9876543210', TRUE, 9, 100, 'Teynampet', 'Teynampet')`,
        [result.insertId]
      );
    }
  }

  console.log(`\nAll sample accounts use the password: ${SAMPLE_PASSWORD}`);
  await connection.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
