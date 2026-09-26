/**
 * Repeatable importer for Greater Chennai Corporation public reference data.
 *
 * Source: https://erp.chennaicorporation.gov.in/pgr/citizen/BeforeReg.do
 *   - Complaint categories + subcomplaints: the `complaintype0..N` <select>
 *     elements rendered into that page, plus the `top5ComplaintTypes` select.
 *   - Area / Locality / Street: the `adminBndry1` select (areas) plus the
 *     public combo endpoint the page itself calls on change:
 *       /pgr/commonyui/egov/loadComboAjax.jsp
 *     Response format is `id1+id2+...^name1+name2+...`.
 *
 * Writes JSON with provenance into data/gcc-reference/. Resumable: re-running
 * with --streets reuses the existing streets file and only fetches localities
 * it is missing.
 *
 *   node scripts/import-gcc-reference.js            # complaint types + areas + localities
 *   node scripts/import-gcc-reference.js --streets  # ...and every locality's streets
 */
const fs = require("fs");
const path = require("path");

const ORIGIN = "https://erp.chennaicorporation.gov.in";
const PAGE_URL = ORIGIN + "/pgr/citizen/BeforeReg.do";
const COMBO_URL = ORIGIN + "/pgr/commonyui/egov/loadComboAjax.jsp";
const OUT_DIR = path.join(__dirname, "..", "data", "gcc-reference");

const WANT_STREETS = process.argv.includes("--streets");
const CONCURRENCY = 4;
const DELAY_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull one <select name="X"> ... </select> block and return its options. */
function parseSelect(html, name) {
  const re = new RegExp(
    '<select[^>]*name\\s*=\\s*["\']' + name + '["\'][^>]*>([\\s\\S]*?)</select>',
    "i"
  );
  const m = html.match(re);
  if (!m) return null;
  const opts = [];
  const optRe = /<option[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
  let o;
  while ((o = optRe.exec(m[1])) !== null) {
    opts.push({ value: o[1].trim(), label: decodeEntities(o[2].replace(/<[^>]*>/g, "")) });
  }
  return opts;
}

async function getText(url, attempt) {
  attempt = attempt || 1;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "gcc-reference-importer/1.0" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } catch (err) {
    if (attempt >= 3) {
      const e = new Error("giving up on " + url + ": " + err.message);
      e.softFail = true;
      throw e;
    }
    await sleep(500 * attempt);
    return getText(url, attempt + 1);
  }
}

/** Calls the page's own combo endpoint. Returns [{id, name}] or a mismatch marker. */
async function loadCombo(tablename, whereclause, idCol, nameCol) {
  const url =
    COMBO_URL +
    "?tablename=" + tablename +
    "&columnname1=" + (idCol || "ID") +
    "&columnname2=" + (nameCol || "UPDT_LOC") +
    "&whereclause=" + encodeURIComponent(whereclause);
  const text = await getText(url);
  const parts = text.split("^");
  if (parts.length < 2) return [];
  const ids = parts[0].split("+").map((s) => s.trim()).filter(Boolean);
  const names = parts[1].split("+").map((s) => s.trim()).filter(Boolean);
  if (ids.length !== names.length) {
    // A '+' inside a name would desynchronise the two lists — refuse to emit
    // a mapping we cannot trust.
    return { mismatch: true, idCount: ids.length, nameCount: names.length };
  }
  return ids.map((id, i) => ({ id: Number(id), name: names[i] }));
}

/** Run `worker` over `items` with bounded concurrency. */
async function pool(items, worker, onProgress) {
  let cursor = 0;
  let done = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
      done++;
      if (onProgress && done % 25 === 0) onProgress(done, items.length);
      await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
}

function write(file, obj) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(obj, null, 2) + "\n", "utf8");
  console.log("  wrote data/gcc-reference/" + file);
}

(async () => {
  const fetchedAt = new Date().toISOString();
  console.log("[1/4] Fetching " + PAGE_URL);
  const html = await getText(PAGE_URL);
  console.log("      " + html.length + " bytes");

  // ---- Complaint categories + subcomplaints -------------------------------
  const categories = [];
  for (let i = 0; i < 64; i++) {
    const opts = parseSelect(html, "complaintype" + i);
    if (!opts || opts.length === 0) break;
    categories.push({
      sortOrder: i,
      category: opts[0].label, // first option is the category heading
      subcomplaints: opts.slice(1).map((o) => ({ gccId: Number(o.value), label: o.label }))
    });
  }
  const topOpts = parseSelect(html, "top5ComplaintTypes") || [];
  const frequent = topOpts.slice(1).map((o) => ({ gccId: Number(o.value), label: o.label }));

  const totalSub = categories.reduce((a, c) => a + c.subcomplaints.length, 0);
  console.log(
    "[2/4] Complaint types: " + categories.length + " categories, " +
    totalSub + " subcomplaints, " + frequent.length + " frequent"
  );
  write("complaint-types.json", {
    source: PAGE_URL,
    sourceDescription:
      "GCC Public Grievance Redressal - 'Register Complaint' page complaint-type selects",
    fetchedAt,
    categoryCount: categories.length,
    subcomplaintCount: totalSub,
    frequent,
    categories
  });

  // ---- Areas --------------------------------------------------------------
  const areaOpts = parseSelect(html, "adminBndry1") || [];
  const areas = areaOpts
    .filter((o) => o.value && o.value !== "0")
    .map((o) => ({ gccId: Number(o.value), name: o.label }));
  console.log("[3/4] Areas: " + areas.length);

  // ---- Localities per area ------------------------------------------------
  const mismatches = [];
  const localities = [];
  await pool(
    areas,
    async (area) => {
      const rows = await loadCombo(
        "pgrLocObj", "AREAID=" + area.gccId + " order by UPDT_LOC", "ID", "UPDT_LOC"
      );
      if (rows && rows.mismatch) {
        mismatches.push({ kind: "locality", areaGccId: area.gccId, areaName: area.name, ...rows });
        return;
      }
      for (const r of rows) {
        localities.push({ gccId: r.id, name: r.name, areaGccId: area.gccId, areaName: area.name });
      }
    },
    (d, t) => console.log("      localities: " + d + "/" + t + " areas")
  );
  console.log("      Localities: " + localities.length);

  write("areas-localities.json", {
    source: PAGE_URL,
    endpoint: COMBO_URL,
    sourceDescription:
      "GCC PGR administrative boundary chain: Area (adminBndry1) -> Locality (adminBndry2). " +
      "NOTE: this chain does NOT contain electoral ward numbers.",
    fetchedAt,
    areaCount: areas.length,
    localityCount: localities.length,
    mismatches: mismatches.filter((m) => m.kind === "locality"),
    areas,
    localities
  });

  // ---- Streets per locality (opt-in: ~1 request per locality) -------------
  if (!WANT_STREETS) {
    console.log("[4/4] Skipping streets (re-run with --streets to fetch them).");
    return;
  }
  const streetFile = path.join(OUT_DIR, "streets.json");
  let existing = { streets: [] };
  if (fs.existsSync(streetFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(streetFile, "utf8"));
    } catch {
      existing = { streets: [] };
    }
  }
  const haveLoc = new Set((existing.streets || []).map((s) => s.localityGccId));
  const todo = localities.filter((l) => !haveLoc.has(l.gccId));
  console.log(
    "[4/4] Streets: " + todo.length + " localities to fetch (" + haveLoc.size + " already cached)"
  );

  const streets = (existing.streets || []).slice();
  const failures = [];
  let flushCounter = 0;
  await pool(
    todo,
    async (loc) => {
      let rows;
      try {
        rows = await loadCombo(
          "pgrStreetObj", "LOCID=" + loc.gccId + " order by STREET", "STREETID", "STREET"
        );
      } catch (err) {
        failures.push({ localityGccId: loc.gccId, localityName: loc.name, error: err.message });
        return;
      }
      if (rows && rows.mismatch) {
        mismatches.push({
          kind: "street",
          localityGccId: loc.gccId,
          localityName: loc.name,
          ...rows
        });
        return;
      }
      for (const r of rows) {
        streets.push({
          gccId: r.id,
          name: r.name,
          localityGccId: loc.gccId,
          localityName: loc.name,
          areaGccId: loc.areaGccId,
          areaName: loc.areaName
        });
      }
      if (++flushCounter % 200 === 0) {
        write("streets.json", {
          source: COMBO_URL,
          fetchedAt,
          partial: true,
          streetCount: streets.length,
          streets
        });
      }
    },
    (d, t) => console.log("      streets: " + d + "/" + t + " localities (" + streets.length + " streets)")
  );

  write("streets.json", {
    source: COMBO_URL,
    sourceDescription: "GCC PGR Street boundary (adminBndry3) per locality",
    fetchedAt,
    partial: false,
    streetCount: streets.length,
    mismatches: mismatches.filter((m) => m.kind === "street"),
    failedLocalities: failures,
    streets
  });
  console.log("      Streets: " + streets.length + " (" + failures.length + " localities failed)");
})().catch((err) => {
  console.error("IMPORT FAILED:", err);
  process.exit(1);
});
