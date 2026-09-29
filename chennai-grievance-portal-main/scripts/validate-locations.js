/**
 * Location check for the Collector console: are incidents and places filed under the
 * right ward, zone and revenue taluk?
 *
 *   node scripts/validate-locations.js            # npm run validate:locations
 *   node scripts/validate-locations.js --list 20  # also list up to 20 mismatches per test
 *
 * Tests (read only, against district_intel):
 *   1. Every ward's zone and taluk exist, and each named locality in the news monitor's
 *      gazetteer falls in a ward of the taluk of the same name (Egmore -> Egmore taluk).
 *   2. Every placed incident's point lies inside its ward (or within 300 m of it), and
 *      its zone and taluk are that ward's.
 *   3. When an incident's address names a known locality, the incident is within 2.5 km
 *      of that locality ("Pantheon Road, Egmore" must not sit in Anna Nagar). PWD records
 *      are listed but not scored: their point is the asset (a canal, a lake), not the locality.
 * Exit code 1 when a test fails, so it can run after every rebuild.
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { getDbConfig } = require("./db-config");

const LIST = Number((process.argv.indexOf("--list") >= 0 && process.argv[process.argv.indexOf("--list") + 1]) || 0);
const INTEL = process.env.INTEL_DB_NAME || "district_intel";

// ------------------------------------------------------------ geometry --
const rings = (g) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []);
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPoly = (lon, lat, poly) => inRing(lon, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lon, lat, h));
const km = (a, b, c, d) => Math.hypot((a - c) * 111.2, (b - d) * 111.2 * Math.cos((a * Math.PI) / 180));
function distToPolys(lat, lon, polys) {
  let best = Infinity;
  for (const p of polys) for (const r of p) for (const [x, y] of r) best = Math.min(best, km(lat, lon, y, x));
  return best;
}

async function main() {
  const db = await mysql.createConnection({ ...getDbConfig(), database: INTEL });
  const [wards] = await db.query(`SELECT ward_no, zone_no, zone_name, taluk_code, centroid_lat AS lat, centroid_lon AS lon, geometry FROM ref_wards`);
  const [taluks] = await db.query(`SELECT taluk_code, name FROM ref_taluks`);
  const talukName = new Map(taluks.map((t) => [t.taluk_code, t.name]));
  const W = new Map(wards.map((w) => [Number(w.ward_no), { ...w, polys: rings(typeof w.geometry === "string" ? JSON.parse(w.geometry) : w.geometry) }]));
  const wardAt = (lat, lon) => { for (const w of W.values()) if (w.polys.some((p) => inPoly(lon, lat, p))) return w; return null; };

  const ref = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "gcc-reference", "intel-reference.json"), "utf8"));
  const localities = (ref.places || []).filter((p) => p.kind === "locality");
  const failures = [];
  const out = (s) => console.log(s);

  // ---------------------------------------------------------------- 1 --
  out("\n1. Wards, zones, taluks and named localities");
  const noTaluk = wards.filter((w) => !w.taluk_code || !talukName.has(w.taluk_code));
  out(`   ${wards.length} wards; ${noTaluk.length} without a known taluk${noTaluk.length ? ": " + noTaluk.map((w) => w.ward_no).join(", ") : ""}`);
  // gazetteer places that share a taluk's name (Egmore, Mylapore, Guindy...) must fall in that taluk
  const named = (ref.places || []).filter((p) => p.kind === "locality" || p.kind === "taluk");
  const locRows = named.map((p) => {
    const w = wardAt(p.lat, p.lon);
    return { name: p.name, ward: w?.ward_no ?? null, zone: w?.zone_name ?? "outside the corporation", taluk: w ? talukName.get(w.taluk_code) : null };
  });
  const sameName = locRows.filter((r) => taluks.some((t) => t.name.toLowerCase() === r.name.toLowerCase()));
  const wrongTaluk = sameName.filter((r) => r.taluk && r.taluk.toLowerCase() !== r.name.toLowerCase());
  for (const r of sameName) out(`   ${r.name.padEnd(16)} ward ${String(r.ward ?? "-").padStart(3)}  ${r.zone.padEnd(18)} taluk ${r.taluk ?? "-"}${wrongTaluk.includes(r) ? "   <- MISMATCH" : ""}`);
  if (wrongTaluk.length) failures.push(`1: ${wrongTaluk.length} localities fall in a taluk other than their own name`);

  // ---------------------------------------------------------------- 2 --
  out("\n2. Incidents: point inside the ward; zone and taluk match the ward");
  const [inc] = await db.query(`SELECT incident_id AS id, sources, ward_no, zone_no, taluk_code, lat, lon, place_text FROM incidents WHERE ward_no IS NOT NULL`);
  let outside = 0, zoneBad = 0, talukBad = 0;
  const ex2 = [];
  for (const i of inc) {
    const w = W.get(Number(i.ward_no));
    if (!w) continue;
    if (Number(i.zone_no) !== Number(w.zone_no)) zoneBad++;
    if (i.taluk_code !== w.taluk_code) { talukBad++; if (ex2.length < LIST) ex2.push(`${i.id} ward ${i.ward_no}: taluk ${i.taluk_code} vs ward's ${w.taluk_code}`); }
    if (i.lat != null && !w.polys.some((p) => inPoly(Number(i.lon), Number(i.lat), p)) && distToPolys(Number(i.lat), Number(i.lon), w.polys) > 0.3) {
      outside++;
      if (ex2.length < LIST) ex2.push(`${i.id} (${i.sources}) point outside ward ${i.ward_no}`);
    }
  }
  out(`   ${inc.length.toLocaleString()} incidents with a ward: ${outside} points outside their ward, ${zoneBad} zone mismatches, ${talukBad} taluk mismatches`);
  ex2.forEach((e) => out("     " + e));
  if (outside + zoneBad + talukBad > inc.length * 0.005) failures.push(`2: ${outside + zoneBad + talukBad} ward/zone/taluk inconsistencies`);

  // ---------------------------------------------------------------- 3 --
  out("\n3. Incidents whose address names a known locality: within 2.5 km of it");
  const pats = localities.map((p) => ({ p, re: new RegExp(`\\b(${(p.aliases_en || [p.name]).map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s.\-]+/g, "[\\s.\\-]*")).join("|")})\\b`, "i") }));
  const bySource = new Map();
  const worst = new Map();
  const ex3 = [];
  for (const i of inc) {
    if (!i.place_text || i.lat == null) continue;
    // the locality named last in the address is the widest one; the most specific named one is first
    const hit = pats.find(({ re }) => re.test(i.place_text));
    if (!hit) continue;
    const src = String(i.sources).split("|")[0];
    const b = bySource.get(src) ?? bySource.set(src, { n: 0, far: 0 }).get(src);
    b.n++;
    const d = km(Number(i.lat), Number(i.lon), hit.p.lat, hit.p.lon);
    if (d > 2.5) {
      b.far++;
      const k = hit.p.name;
      worst.set(k, (worst.get(k) || 0) + 1);
      if (ex3.length < LIST) ex3.push(`${i.id} "${i.place_text}" is ${d.toFixed(1)} km from ${k} (ward ${i.ward_no}, ${W.get(Number(i.ward_no))?.zone_name})`);
    }
  }
  let n3 = 0, far3 = 0;
  for (const [src, b] of bySource) {
    // PWD points are the asset itself (a canal, a lake bund), which can lie far from the locality centre
    if (src !== "pwd") { n3 += b.n; far3 += b.far; }
    out(`   ${src.padEnd(10)} ${String(b.n).padStart(6)} named a locality, ${String(b.far).padStart(5)} more than 2.5 km away (${b.n ? ((100 * b.far) / b.n).toFixed(1) : 0}%)${src === "pwd" ? "  (asset points; not scored)" : ""}`);
  }
  const top = [...worst.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) out(`   most often misplaced: ${top.map(([k, v]) => `${k} (${v})`).join(", ")}`);
  ex3.forEach((e) => out("     " + e));
  if (n3 && far3 / n3 > 0.05) failures.push(`3: ${far3} of ${n3} incidents are more than 2.5 km from the locality their address names`);

  await db.end();
  out(failures.length ? `\nFAILED\n - ${failures.join("\n - ")}` : "\nAll location checks passed.");
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(2); });
