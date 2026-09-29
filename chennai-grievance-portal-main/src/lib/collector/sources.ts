/**
 * Connected sources: the pipeline's feeds, AGMARKNET, and sources the Collector adds
 * by link (RSS, web page or JSON API, optionally behind a login). Every run is logged
 * with its outcome; logins are reused until the site rejects them, then renewed once.
 *
 * Authorized access only: this sends an honest User-Agent, follows the site's own
 * login form or API token, and never works around CAPTCHAs, paywalls or robots rules.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import intelPool, { ops } from "@/lib/collector/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { classify, resolvePlace } from "@/lib/collector/nlp";

type Row = Record<string, any>;
const UA = "DistrictIQ/1.0 (Chennai District Collectorate dashboard prototype)";

async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await intelPool.query<RowDataPacket[]>(sql, params);
  return r as unknown as T[];
}
async function exec(sql: string, params: unknown[] = []) {
  const [r] = await intelPool.query<ResultSetHeader>(sql, params);
  return r;
}

export async function audit(actor: string, action: string, table: string, recordId: string | number | null, before: unknown, after: unknown) {
  await exec(
    `INSERT INTO ${ops("audit_log")} (at, actor, action, table_name, record_id, before_value, after_value) VALUES (NOW(), ?, ?, ?, ?, ?, ?)`,
    [actor, action, table, recordId == null ? null : String(recordId), before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)]
  ).catch((e) => console.warn("audit failed", e.message));
}

// --------------------------------------------------------------- listing --

export async function listSources() {
  const [rows, health, runs] = await Promise.all([
    q(`SELECT source_id AS id, name, url, kind, description, pipeline_key, auth, login_url, username, refresh_minutes, enabled, status,
              DATE_FORMAT(last_run_at, '%Y-%m-%d %H:%i:%s') AS last_run_at, DATE_FORMAT(last_ok_at, '%Y-%m-%d %H:%i:%s') AS last_ok_at,
              last_error, items_total, created_by, DATE_FORMAT(session_expires_at, '%Y-%m-%d %H:%i:%s') AS session_expires_at
       FROM ${ops("sources")} ORDER BY FIELD(kind, 'pipeline', 'agmarknet', 'ocr', 'rss', 'html', 'json'), source_id`),
    q(`SELECT source, status, minutes_since_success, \`rows\` AS row_count, DATE_FORMAT(newest_record_at, '%Y-%m-%d %H:%i:%s') AS newest FROM source_health`),
    q(`SELECT source_id, ok, error, items_new, login, DATE_FORMAT(started_at, '%Y-%m-%d %H:%i:%s') AS t FROM (
         SELECT r.*, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY run_id DESC) rn FROM ${ops("source_runs")} r) x WHERE rn <= 5`)
  ]);
  const h = new Map(health.map((x) => [x.source, x]));
  return rows.map((s) => {
    const pipe = s.pipeline_key ? h.get(s.pipeline_key) : null;
    return {
      ...s,
      enabled: Number(s.enabled) === 1,
      status: pipe ? (pipe.status === "ok" ? "ok" : "stale") : s.status,
      newest: pipe?.newest ?? s.last_ok_at,
      rows: pipe ? Number(pipe.row_count) : Number(s.items_total),
      minutes_since_success: pipe?.minutes_since_success ?? null,
      runs: runs.filter((r) => r.source_id === s.id)
    };
  });
}

// ------------------------------------------------------------------ add --

export interface NewSource {
  name: string; url: string; kind?: "rss" | "html" | "json" | "auto"; auth?: "none" | "basic" | "form" | "token";
  loginUrl?: string | null; userField?: string | null; passField?: string | null; username?: string | null; secret?: string | null;
  refreshMinutes?: number;
}

export async function addSource(s: NewSource, actor: string) {
  const u = new URL(s.url);
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http and https links can be added.");
  let kind = s.kind && s.kind !== "auto" ? s.kind : null;
  if (!kind) kind = await detectKind(s.url);
  const r = await exec(
    `INSERT INTO ${ops("sources")} (name, url, kind, auth, login_url, user_field, pass_field, username, secret_enc, refresh_minutes, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
    [s.name.slice(0, 128), s.url, kind, s.auth ?? "none", s.loginUrl || null, s.userField || null, s.passField || null,
      s.username || null, s.secret ? encryptSecret(s.secret) : null, Math.max(15, Math.min(1440, s.refreshMinutes ?? 60)), actor]
  );
  await audit(actor, "source:add", "sources", r.insertId, null, { name: s.name, url: s.url, kind, auth: s.auth ?? "none" });
  const run = await runSource(r.insertId, actor);
  return { id: r.insertId, kind, run };
}

export async function updateSource(id: number, patch: { enabled?: boolean; refreshMinutes?: number }, actor: string) {
  const [before] = await q(`SELECT enabled, refresh_minutes FROM ${ops("sources")} WHERE source_id = ?`, [id]);
  if (!before) throw new Error("Source not found.");
  if (patch.enabled !== undefined) await exec(`UPDATE ${ops("sources")} SET enabled = ? WHERE source_id = ?`, [patch.enabled ? 1 : 0, id]);
  if (patch.refreshMinutes) await exec(`UPDATE ${ops("sources")} SET refresh_minutes = ? WHERE source_id = ?`, [Math.max(15, Math.min(1440, patch.refreshMinutes)), id]);
  await audit(actor, "source:update", "sources", id, before, patch);
}

export async function removeSource(id: number, actor: string) {
  const [s] = await q(`SELECT name, kind, created_by FROM ${ops("sources")} WHERE source_id = ?`, [id]);
  if (!s) throw new Error("Source not found.");
  if (["pipeline", "agmarknet", "ocr"].includes(s.kind)) throw new Error("Built-in sources can be paused but not removed.");
  await exec(`DELETE FROM ${ops("sources")} WHERE source_id = ?`, [id]);
  await audit(actor, "source:remove", "sources", id, s, null);
}

// ------------------------------------------------------------------ run --

async function detectKind(url: string): Promise<"rss" | "html" | "json"> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    const ct = r.headers.get("content-type") ?? "";
    if (/json/.test(ct)) return "json";
    if (/xml|rss|atom/.test(ct)) return "rss";
    const head = (await r.text()).slice(0, 600).trimStart();
    if (head.startsWith("{") || head.startsWith("[")) return "json";
    if (/^<\?xml|<rss|<feed/i.test(head)) return "rss";
  } catch { /* fall through: treat as a web page */ }
  return "html";
}

const running = new Set<number>();

/** Run one source now. Pipeline feeds start a pipeline refresh; the rest fetch here. */
export async function runSource(id: number, actor: string) {
  const [s] = await q(`SELECT * FROM ${ops("sources")} WHERE source_id = ?`, [id]);
  if (!s) throw new Error("Source not found.");
  if (running.has(id)) return { ok: false, error: "Already running.", items_new: 0 };
  running.add(id);
  const started = new Date();
  const run: { ok: boolean; http?: number; seen: number; items_new: number; login: string; attempts: number; error: string | null } =
    { ok: false, seen: 0, items_new: 0, login: "none", attempts: 0, error: null };
  try {
    if (s.kind === "pipeline") Object.assign(run, await triggerPipeline());
    else if (s.kind === "agmarknet") Object.assign(run, await collectMandi());
    else if (s.kind === "ocr") Object.assign(run, { ok: true, error: null });
    else Object.assign(run, await fetchAndIngest(s));
  } catch (e: any) {
    run.error = String(e?.message ?? e).slice(0, 480);
  } finally {
    running.delete(id);
  }
  await exec(
    `INSERT INTO ${ops("source_runs")} (source_id, started_at, finished_at, ok, http_status, items_seen, items_new, login, attempts, error, triggered_by)
     VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, started, run.ok ? 1 : 0, run.http ?? null, run.seen, run.items_new, run.login, Math.max(1, run.attempts), run.error, actor]
  );
  const status = run.ok ? "ok" : run.login === "failed" ? "login_failed" : "failing";
  await exec(
    `UPDATE ${ops("sources")} SET last_run_at = NOW(), status = ?, last_error = ?, ${run.ok ? "last_ok_at = NOW()," : ""}
       items_total = items_total + ? WHERE source_id = ?`,
    [status, run.error, run.items_new, id]
  );
  return run;
}

let lastSweep = 0;
/** Run added sources whose refresh interval has passed (at most one sweep a minute, in the background). */
export function runDueSources() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  (async () => {
    const due = await q(
      `SELECT source_id FROM ${ops("sources")} WHERE enabled = 1 AND kind IN ('rss', 'html', 'json', 'agmarknet')
       AND (last_run_at IS NULL OR last_run_at < NOW() - INTERVAL refresh_minutes MINUTE)`
    );
    for (const d of due) await runSource(d.source_id, "scheduler").catch(() => {});
  })().catch((e) => console.warn("source sweep skipped:", e.message));
}

// --------------------------------------------------- fetching with a login --

interface Session { cookie: string | null; login: string }

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<{ v: T; attempts: number }> {
  let last: any;
  for (let k = 1; k <= attempts; k++) {
    try {
      return { v: await fn(), attempts: k };
    } catch (e) {
      last = e;
      if (k < attempts) await new Promise((r) => setTimeout(r, 800 * 2 ** (k - 1)));
    }
  }
  throw last;
}

function cookiesFrom(res: Response): string | null {
  const list = (res.headers as any).getSetCookie?.() as string[] | undefined;
  const c = (list ?? []).map((x) => x.split(";")[0]).filter(Boolean);
  return c.length ? c.join("; ") : null;
}

async function login(s: Row): Promise<string> {
  if (!s.login_url || !s.username || !s.secret_enc) throw new Error("Login details are incomplete.");
  const body = new URLSearchParams({ [s.user_field || "username"]: s.username, [s.pass_field || "password"]: decryptSecret(s.secret_enc) });
  const r = await fetch(s.login_url, {
    method: "POST", redirect: "manual", body,
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(20000)
  });
  const cookie = cookiesFrom(r);
  if (!cookie || r.status >= 400) throw new Error(`Login was refused (HTTP ${r.status}).`);
  await exec(`UPDATE ${ops("sources")} SET session_enc = ?, session_expires_at = NOW() + INTERVAL 30 MINUTE WHERE source_id = ?`,
    [encryptSecret(cookie), s.source_id]);
  return cookie;
}

async function session(s: Row, forceNew = false): Promise<Session> {
  if (s.auth !== "form") return { cookie: null, login: "none" };
  const valid = s.session_enc && s.session_expires_at && new Date(s.session_expires_at) > new Date();
  if (valid && !forceNew) return { cookie: decryptSecret(s.session_enc), login: "reused" };
  return { cookie: await login(s), login: "fresh" };
}

const looksLikeLogin = (r: Response, text: string) =>
  r.status === 401 || r.status === 403 || /\/(login|signin)\b/i.test(r.url) || /<input[^>]+type=["']?password/i.test(text.slice(0, 20000));

async function fetchAndIngest(s: Row) {
  let sess: Session;
  try {
    sess = await session(s);
  } catch (e: any) {
    return { ok: false, login: "failed", error: e.message, seen: 0, items_new: 0, attempts: 1 };
  }
  const get = async (cookie: string | null) => {
    const headers: Record<string, string> = { "User-Agent": UA, Accept: "*/*" };
    if (cookie) headers.Cookie = cookie;
    if (s.auth === "basic" && s.secret_enc) headers.Authorization = "Basic " + Buffer.from(`${s.username}:${decryptSecret(s.secret_enc)}`).toString("base64");
    if (s.auth === "token" && s.secret_enc) headers.Authorization = "Bearer " + decryptSecret(s.secret_enc);
    const r = await fetch(s.url, { headers, signal: AbortSignal.timeout(25000) });
    if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
    return { r, text: await r.text() };
  };
  let { v: res, attempts } = await withRetry(() => get(sess.cookie));
  // an expired session: log in again once and retry
  if (s.auth === "form" && looksLikeLogin(res.r, res.text)) {
    try {
      sess = await session(s, true);
    } catch (e: any) {
      return { ok: false, login: "failed", error: e.message, seen: 0, items_new: 0, attempts };
    }
    const again = await withRetry(() => get(sess.cookie));
    res = again.v;
    attempts += again.attempts;
    if (looksLikeLogin(res.r, res.text)) return { ok: false, login: "failed", error: "The site still asks for a login.", http: res.r.status, seen: 0, items_new: 0, attempts };
  }
  if (res.r.status >= 400) return { ok: false, http: res.r.status, error: `HTTP ${res.r.status}`, login: sess.login, seen: 0, items_new: 0, attempts };
  const items = s.kind === "rss" ? parseRss(res.text) : s.kind === "json" ? parseJson(res.text) : parseHtml(res.text, s.url);
  const n = await ingest(s.source_id, items, "fetch");
  return { ok: true, http: res.r.status, seen: items.length, items_new: n, login: sess.login, attempts, error: items.length ? null : "No items found on the page." };
}

interface Item { title: string; url?: string | null; body?: string | null; published?: string | null }

/** Numeric character references (&#038; &#x2019;), left behind by some feeds. */
const unent = (s: string) => s.replace(/&#(\d{1,6});/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const strip = (s: string) => unent(s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")).replace(/\s+/g, " ").trim();
const tag = (x: string, t: string) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i")); return m ? strip(m[1]) : null; };

function parseRss(xml: string): Item[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return blocks.slice(0, 80).map((b) => ({
    title: tag(b, "title") ?? "",
    url: tag(b, "link") || (b.match(/<link[^>]+href=["']([^"']+)/i)?.[1] ?? null),
    body: tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content"),
    published: tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date")
  })).filter((i) => i.title);
}

function parseHtml(html: string, base: string): Item[] {
  const out: Item[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = strip(m[2]);
    if (text.length < 28 || text.length > 260 || seen.has(text)) continue;
    seen.add(text);
    let url: string | null = null;
    try { url = new URL(m[1], base).toString(); } catch { /* keep null */ }
    out.push({ title: text, url });
    if (out.length >= 60) break;
  }
  if (!out.length) {
    const t = tag(html, "title");
    if (t) out.push({ title: t, url: base, body: strip(html).slice(0, 2000) });
  }
  return out;
}

function parseJson(text: string): Item[] {
  let data: any;
  try { data = JSON.parse(text); } catch { return []; }
  const find = (v: any, depth = 0): any[] | null => {
    if (Array.isArray(v) && v.length && typeof v[0] === "object") return v;
    if (v && typeof v === "object" && depth < 4) for (const x of Object.values(v)) { const f = find(x, depth + 1); if (f) return f; }
    return null;
  };
  const arr = find(data) ?? [];
  const pick = (o: any, keys: string[]) => { for (const k of Object.keys(o)) if (keys.includes(k.toLowerCase()) && o[k] != null) return String(o[k]); return null; };
  return arr.slice(0, 100).map((o: any) => ({
    title: pick(o, ["title", "headline", "name", "subject", "event", "description"]) ?? JSON.stringify(o).slice(0, 160),
    url: pick(o, ["url", "link", "href"]),
    body: pick(o, ["summary", "text", "body", "content", "details", "description", "message"]),
    published: pick(o, ["date", "published", "published_at", "pubdate", "created_at", "time", "timestamp"])
  }));
}

function toDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Bump when the place resolver changes, so stored items are placed again (see replaceStale). */
const PLACE_V = 2;

/** Classify, place and store items; duplicates (same source, link and headline) are skipped. */
export async function ingest(sourceId: number, items: Item[], origin: "fetch" | "ocr"): Promise<number> {
  let added = 0;
  for (const it of items) {
    const title = it.title.slice(0, 480);
    const text = `${title}. ${it.body ?? ""}`;
    const hash = crypto.createHash("sha1").update(`${sourceId}|${it.url ?? ""}|${title}`).digest("hex");
    const c = classify(text);
    const p = await resolvePlace(text);
    const tamil = /[஀-௿]/.test(text);
    const r = await exec(
      `INSERT IGNORE INTO ${ops("source_items")}
         (source_id, hash, url, title, body, published_at, lang, category_code, category_label, dept_code, category_conf, matched_terms,
          zone_no, ward_no, taluk_code, place, place_conf, lat, lon, place_v, is_incident, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sourceId, hash, it.url?.slice(0, 690) ?? null, title, it.body?.slice(0, 6000) ?? null, toDate(it.published), tamil ? "ta" : "en",
        c?.code ?? null, c?.label ?? null, c?.dept ?? null, c?.conf ?? null, c?.terms.slice(0, 6).join(", ").slice(0, 250) ?? null,
        p?.zone ?? null, p?.ward ?? null, p?.taluk ?? null, p?.place ?? null, p?.conf ?? null, p?.lat ?? null, p?.lon ?? null, PLACE_V, c ? 1 : 0, origin]
    );
    added += r.affectedRows;
  }
  return added;
}

let replacing: Promise<void> | null = null;
/** Place again the items stored by an older resolver (runs once per server, in the background). */
export function replaceStale() {
  replacing ??= (async () => {
    const rows = await q(`SELECT item_id, title, body FROM ${ops("source_items")} WHERE place_v < ? LIMIT 5000`, [PLACE_V]);
    for (const r of rows) {
      const p = await resolvePlace(`${r.title}. ${r.body ?? ""}`);
      await exec(
        `UPDATE ${ops("source_items")} SET zone_no = ?, ward_no = ?, taluk_code = ?, place = ?, place_conf = ?, lat = ?, lon = ?, place_v = ? WHERE item_id = ?`,
        [p?.zone ?? null, p?.ward ?? null, p?.taluk ?? null, p?.place ?? null, p?.conf ?? null, p?.lat ?? null, p?.lon ?? null, PLACE_V, r.item_id]
      );
    }
  })().catch((e) => { console.warn("re-placing added items skipped:", e.message); replacing = null; });
  return replacing;
}

const ITEM_COLS = `i.item_id, i.source_id, s.name AS source, s.kind, s.url AS source_url, i.url, i.title, LEFT(i.body, 1200) AS body, i.lang, i.origin,
  DATE_FORMAT(COALESCE(i.published_at, i.fetched_at), '%Y-%m-%d %H:%i:%s') AS t, DATE_FORMAT(i.fetched_at, '%Y-%m-%d %H:%i:%s') AS fetched,
  i.category_code, i.category_label, i.dept_code, i.category_conf, i.matched_terms, i.zone_no, z.zone_name, i.ward_no, i.taluk_code,
  i.place, i.place_conf, i.lat, i.lon, i.is_incident`;
const ITEM_FROM = `FROM ${ops("source_items")} i JOIN ${ops("sources")} s ON s.source_id = i.source_id
  LEFT JOIN (SELECT DISTINCT zone_no, zone_name FROM ref_wards) z ON z.zone_no = i.zone_no`;

export async function sourceItems(opts: { sourceId?: number; zone?: number | null; incidentsOnly?: boolean; limit?: number }) {
  const where = ["1=1"];
  const params: unknown[] = [];
  if (opts.sourceId) (where.push("i.source_id = ?"), params.push(opts.sourceId));
  if (opts.zone) (where.push("i.zone_no = ?"), params.push(opts.zone));
  if (opts.incidentsOnly) where.push("i.is_incident = 1");
  return q(
    `SELECT ${ITEM_COLS} ${ITEM_FROM}
     WHERE ${where.join(" AND ")} ORDER BY COALESCE(i.published_at, i.fetched_at) DESC LIMIT ${Math.min(200, opts.limit ?? 50)}`,
    params
  );
}

export interface ItemScope { now: string; days: number; zone?: number | null; dept?: string | null; cat?: string | null; taluk?: string | null }

/**
 * Items from sources the Collector added (RSS, web pages, JSON, OCR'd pages) in the
 * scope: dated items newest first, then undated page links; plus every item that names a
 * place, for the map. Pipeline feeds are not "added" and never appear here.
 */
export async function addedItems(s: ItemScope, limit = 40) {
  void replaceStale();
  const where = [`s.kind IN ('rss', 'html', 'json', 'ocr')`, `COALESCE(i.published_at, i.fetched_at) > (? - INTERVAL ? DAY)`,
    `COALESCE(i.published_at, i.fetched_at) <= ? + INTERVAL 1 DAY`];
  const params: unknown[] = [s.now, s.days, s.now];
  if (s.zone) (where.push("i.zone_no = ?"), params.push(s.zone));
  if (s.dept) (where.push("i.dept_code = ?"), params.push(s.dept));
  if (s.cat) (where.push("i.category_code = ?"), params.push(s.cat));
  if (s.taluk) (where.push("i.taluk_code = ?"), params.push(s.taluk));
  const [rows, pins, count] = await Promise.all([
    q(`SELECT ${ITEM_COLS} ${ITEM_FROM} WHERE ${where.join(" AND ")}
       ORDER BY i.published_at IS NULL, COALESCE(i.published_at, i.fetched_at) DESC LIMIT ${Math.min(200, limit)}`, params),
    q(`SELECT ${ITEM_COLS} ${ITEM_FROM} WHERE ${where.join(" AND ")} AND i.lat IS NOT NULL
       ORDER BY COALESCE(i.published_at, i.fetched_at) DESC LIMIT 150`, params),
    q(`SELECT COUNT(*) AS n, SUM(i.is_incident) AS civic, SUM(i.lat IS NOT NULL) AS placed ${ITEM_FROM} WHERE ${where.join(" AND ")}`, params)
  ]).catch(() => [[], [], [{}]] as Row[][]);
  const shape = (r: Row) => ({
    ...r, title: unent(String(r.title)), body: r.body == null ? null : unent(String(r.body)),
    lat: r.lat == null ? null : Number(r.lat), lon: r.lon == null ? null : Number(r.lon), is_incident: Number(r.is_incident) === 1
  }) as Row;
  return {
    days: s.days, items: rows.map(shape), pins: pins.map(shape),
    count: Number(count[0]?.n ?? 0), civic: Number(count[0]?.civic ?? 0), placed: Number(count[0]?.placed ?? 0)
  };
}
export type AddedItems = Awaited<ReturnType<typeof addedItems>>;

// ------------------------------------------------------------- pipeline --

const PIPE_DIR = path.resolve(process.cwd(), "..", "district_intel");
const LOCK = path.join(PIPE_DIR, "output", ".dashboard-refresh.lock");

/** Start `python run_pipeline.py refresh` (the same job the 30-minute schedule runs), once at a time. */
async function triggerPipeline() {
  if (!fs.existsSync(path.join(PIPE_DIR, "run_pipeline.py"))) return { ok: false, error: "The district_intel pipeline is not installed next to the portal.", seen: 0, items_new: 0 };
  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 15 * 60_000) return { ok: true, error: "A refresh is already running.", seen: 0, items_new: 0 };
  fs.writeFileSync(LOCK, new Date().toISOString());
  const child = spawn("python", ["run_pipeline.py", "refresh"], { cwd: PIPE_DIR, detached: true, stdio: "ignore", windowsHide: true });
  child.on("exit", () => { try { fs.unlinkSync(LOCK); } catch { /* already gone */ } });
  child.unref();
  return { ok: true, error: null, seen: 0, items_new: 0 };
}

// ------------------------------------------------------------ AGMARKNET --

const AGM = "https://api.agmarknet.gov.in/v1/dashboard-data/";
const SCOPES = [
  { scope: "tamil_nadu", district: [100007] },
  { scope: "chennai_markets", district: [528, 536, 560] } // Chengalpattu, Kancheepuram, Thiruvallur (Ambattur, Redhills)
];

async function agm(date: string, district: number[]) {
  const r = await fetch(AGM, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ dashboard: "marketwise_price_arrival", date, group: [100000], commodity: [100001], variety: 100021,
      state: 31, district, grades: [4, 100011], limit: 60, format: "json" }),
    signal: AbortSignal.timeout(30000)
  });
  if (r.status >= 400) throw new Error(`AGMARKNET HTTP ${r.status}`);
  const j = await r.json();
  return j?.data?.records as Row[] | undefined;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** Last 30 days of prices: each call returns three days, so step back three days at a time. */
async function collectMandi() {
  let seen = 0, added = 0, calls = 0;
  const today = new Date();
  for (const sc of SCOPES) {
    // newest day with data (AGMARKNET freezes the last two or three days)
    let anchor: Date | null = null;
    for (let back = 0; back < 8 && !anchor; back++) {
      const d = new Date(today.getTime() - back * 864e5);
      calls++;
      const recs = await agm(iso(d), sc.district);
      if (recs?.length) anchor = d;
    }
    if (!anchor) continue;
    for (let step = 0; step < 10; step++) {
      const d = new Date(anchor.getTime() - step * 3 * 864e5);
      calls++;
      const recs = (await agm(iso(d), sc.district)) ?? [];
      for (const r of recs) {
        const [dd, mm, yy] = String(r.reported_date ?? "").split("-");
        const asOn = dd ? new Date(`${yy}-${mm}-${dd}T00:00:00Z`) : d;
        const days: [Date, unknown, unknown][] = [
          [asOn, r.as_on_price, r.as_on_arrival],
          [new Date(asOn.getTime() - 864e5), r.one_day_ago_price, r.one_day_ago_arrival],
          [new Date(asOn.getTime() - 2 * 864e5), r.two_day_ago_price, r.two_day_ago_arrival]
        ];
        for (const [day, price, arrival] of days) {
          if (num(price) == null) continue;
          seen++;
          const x = await exec(
            `INSERT INTO ${ops("mandi_prices")} (date, scope, commodity, cmdt_group, price, arrival, msp) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE price = VALUES(price), arrival = VALUES(arrival), msp = VALUES(msp), fetched_at = NOW()`,
            [iso(day), sc.scope, r.cmdt_name, r.cmdt_grp_name ?? null, num(price), num(arrival), num(r.msp_price)]
          );
          if (x.affectedRows === 1) added++;
        }
      }
    }
  }
  const weekly = await collectMandiWeekly().catch((e) => ({ seen: 0, added: 0, calls: 0, error: String(e.message) }));
  const markets = await collectMandiMarkets().catch((e) => ({ seen: 0, added: 0, calls: 0, error: String(e.message) }));
  const all = seen + weekly.seen + markets.seen;
  return {
    ok: all > 0, seen: all, items_new: added + weekly.added + markets.added, attempts: calls + weekly.calls + markets.calls,
    error: all ? null : "AGMARKNET returned no prices for Tamil Nadu."
  };
}

// Commodities a Collector watches for household prices; AGMARKNET commodity ids.
const WATCH = [["Tomato", 65], ["Onion", 23], ["Potato", 24], ["Brinjal", 32], ["Banana", 19], ["Rice", 3]] as const;
const CHENNAI_REGION = ["Chennai", "Thiruvellore", "Kancheepuram", "Chengalpattu"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Weekly wholesale prices by district (AGMARKNET price-trend report) for the last
 * eight weeks: averaged over the districts around Chennai and over all of Tamil Nadu.
 */
async function collectMandiWeekly() {
  let seen = 0, added = 0, calls = 0;
  const today = new Date();
  const slots: { year: number; month: number; week: number }[] = [];
  let y = today.getFullYear(), m = today.getMonth() + 1, wk = Math.min(4, Math.ceil(today.getDate() / 7));
  while (slots.length < 8) {
    slots.push({ year: y, month: m, week: wk });
    wk--;
    if (wk < 1) { wk = 4; m--; if (m < 1) { m = 12; y--; } }
  }
  for (const [name, id] of WATCH) {
    for (const sl of slots) {
      calls++;
      const r = await fetch(`https://api.agmarknet.gov.in/v1/price-trend/wholesale-prices-weekly?report_mode=Districtwise&commodity=${id}` +
        `&year=${sl.year}&month=${sl.month}&week=${sl.week}&state=31`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
      if (r.status >= 400) continue;
      const j = await r.json().catch(() => null);
      const rows: Row[] = j?.rows ?? [];
      const key = (j?.data?.find((d: Row) => d.key === "prices")?.columns?.[0]?.key as string | undefined) ?? "";
      // "prices_16_23_sep_2026" -> 2026-09-16
      const mm = key.match(/prices_(\d+)_\d+_([a-z]{3})_(\d{4})/);
      if (!mm || !rows.length) continue;
      const start = `${mm[3]}-${String(MONTHS.indexOf(mm[2]) + 1).padStart(2, "0")}-${mm[1].padStart(2, "0")}`;
      const label = (j.data.find((d: Row) => d.key === "prices").columns[0].title as string).replace(/^Prices\s*/, "").replace(/\s*\(.*$/, "");
      const avg = (xs: Row[], f: string) => { const v = xs.map((x) => Number(x[f])).filter((x) => Number.isFinite(x) && x > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      for (const [scope, set] of [["chennai_region", rows.filter((x) => CHENNAI_REGION.includes(x.district))], ["tamil_nadu", rows]] as const) {
        const price = avg(set, key);
        if (price == null) continue;
        seen++;
        const x = await exec(
          `INSERT INTO ${ops("mandi_weekly")} (week_start, week_label, scope, commodity, price, districts, chg_week, chg_month, chg_year)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE price = VALUES(price), districts = VALUES(districts), chg_week = VALUES(chg_week),
             chg_month = VALUES(chg_month), chg_year = VALUES(chg_year), fetched_at = NOW()`,
          [start, label, scope, name, Math.round(price * 100) / 100, set.length, avg(set, "change_over_previous_week"),
            avg(set, "change_over_previous_month"), avg(set, "change_over_previous_year")]
        );
        if (x.affectedRows === 1) added++;
      }
    }
  }
  return { seen, added, calls };
}

// Chennai's own markets on AGMARKNET: the Uzhavar Sandhai (farmer-to-consumer) markets inside the
// corporation, then the nearest suburban ones. Koyambedu, the wholesale market, does not report.
export const CHENNAI_MARKETS: { key: string; re: RegExp; zone: number | null; area: "Chennai city" | "Suburbs" }[] = [
  { key: "Anna Nagar", re: /^anna\s*nagar\s*\(/i, zone: 8, area: "Chennai city" },
  { key: "K.K. Nagar", re: /^k\.?\s*k\.?\s*nagar\s*\(/i, zone: 10, area: "Chennai city" },
  { key: "Nanganallur", re: /^nanganallur\s*\(/i, zone: 12, area: "Chennai city" },
  { key: "Ambattur", re: /^ambattur\s*\(/i, zone: 7, area: "Chennai city" },
  { key: "Medavakkam", re: /^medavakkam\s*\(/i, zone: null, area: "Suburbs" },
  { key: "Pallavaram", re: /^pallavaram\s*\(/i, zone: null, area: "Suburbs" },
  { key: "Kundrathur", re: /^kundrathur\s*\(/i, zone: null, area: "Suburbs" },
  { key: "Guduvancheri", re: /^guduvancheri\s*\(/i, zone: null, area: "Suburbs" }
];
const MARKET_CATEGORIES = [3]; // Farmer Consumer Market (Uzhavar Sandhai); no Chennai market reports under the others

/**
 * Daily prices at each Chennai market from AGMARKNET's state market-wise daily report
 * (open endpoint, no CAPTCHA). The last 14 days are kept; the last three are fetched again
 * because markets report late.
 */
async function collectMandiMarkets() {
  let seen = 0, added = 0, calls = 0;
  const have = new Set((await q(`SELECT DISTINCT DATE_FORMAT(date, '%Y-%m-%d') AS d FROM ${ops("mandi_market_prices")}
    WHERE date > CURDATE() - INTERVAL 15 DAY`).catch(() => [] as Row[])).map((r) => r.d));
  for (let back = 1; back <= 14; back++) {
    const day = iso(new Date(Date.now() - back * 864e5));
    if (back > 3 && have.has(day)) continue;
    for (const cat of MARKET_CATEGORIES) {
      calls++;
      const r = await fetch(`https://api.agmarknet.gov.in/v1/prices-and-arrivals/commodity-market/daily-report-state-marketwise?date=${day}` +
        `&state=31&includeExcel=false&marketCategoryid=${cat}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60000) });
      if (r.status >= 400) continue;
      const j = await r.json().catch(() => null);
      for (const g of (j?.commodityGroups ?? []) as Row[]) {
        for (const cm of (g.commodities ?? []) as Row[]) {
          for (const mk of (cm.markets ?? []) as Row[]) {
            const m = CHENNAI_MARKETS.find((x) => x.re.test(String(mk.marketCenter ?? "").trim()));
            if (!m) continue;
            for (const d of (mk.data ?? []) as Row[]) {
              if (num(d.modalPrice) == null) continue;
              seen++;
              const x = await exec(
                `INSERT INTO ${ops("mandi_market_prices")} (date, market, commodity, variety, cmdt_group, min_price, max_price, modal_price, arrival)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE min_price = VALUES(min_price), max_price = VALUES(max_price), modal_price = VALUES(modal_price),
                   arrival = VALUES(arrival), fetched_at = NOW()`,
                [day, m.key, String(cm.commodityName).trim().slice(0, 96), String(d.variety ?? "").trim().slice(0, 96), g.CommodityGroup ?? null,
                  num(d.minimumPrice), num(d.maximumPrice), num(d.modalPrice), num(d.arrivals)]
              );
              if (x.affectedRows === 1) added++;
            }
          }
        }
      }
    }
  }
  return { seen, added, calls };
}

// Household staples first in the market comparison.
const STAPLES = ["Tomato", "Onion", "Potato", "Brinjal", "Green Chilli", "Beans", "Carrot", "Cabbage", "Drumstick", "Bhindi(Ladies Finger)",
  "Banana - Green", "Coconut", "Lemon", "Coriander(Leaves)", "Garlic", "Ginger(Green)"];

/**
 * Prices at each Chennai market: per commodity, each market's latest modal price (Rs/quintal,
 * averaged over varieties) with its previous report and a 14-day series, and the average across markets.
 */
export async function mandiMarkets() {
  const rows = await q(
    `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d, market, commodity, MAX(cmdt_group) AS grp, AVG(modal_price) AS price,
            MIN(min_price) AS lo, MAX(max_price) AS hi, SUM(arrival) AS arrival
     FROM ${ops("mandi_market_prices")} WHERE date > (SELECT MAX(date) FROM ${ops("mandi_market_prices")}) - INTERVAL 14 DAY
     GROUP BY date, market, commodity ORDER BY commodity, market, date`
  ).catch(() => [] as Row[]);
  const dates = [...new Set(rows.map((r) => r.d as string))].sort();
  const latest = dates[dates.length - 1] ?? null;
  const cell = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.commodity}|${r.market}`;
    (cell.get(k) ?? cell.set(k, []).get(k)!).push(r);
  }
  const markets = CHENNAI_MARKETS.map((m) => {
    const mine = rows.filter((r) => r.market === m.key);
    const last = mine.reduce((a, r) => (r.d > a ? r.d : a), "");
    return { key: m.key, zone: m.zone, area: m.area, latest: last || null, commodities: new Set(mine.filter((r) => r.d === last).map((r) => r.commodity)).size };
  }).filter((m) => m.latest);
  const fresh = (d: string) => !!latest && new Date(latest).getTime() - new Date(d).getTime() <= 3 * 864e5;
  const commodities = [...new Set(rows.map((r) => r.commodity as string))].map((commodity) => {
    const prices: Record<string, { price: number; date: string; lo: number | null; hi: number | null; prev: number | null; prevDate: string | null; series: (number | null)[] }> = {};
    for (const m of markets) {
      const s = cell.get(`${commodity}|${m.key}`);
      if (!s?.length) continue;
      const last = s[s.length - 1], prev = s[s.length - 2] ?? null;
      // only a report from the last three days counts as the market's current price
      if (!fresh(last.d)) continue;
      const byDay = new Map(s.map((x) => [x.d as string, Number(x.price)]));
      prices[m.key] = {
        price: Number(last.price), date: last.d, lo: last.lo == null ? null : Number(last.lo), hi: last.hi == null ? null : Number(last.hi),
        prev: prev ? Number(prev.price) : null, prevDate: prev?.d ?? null, series: dates.map((d) => byDay.get(d) ?? null)
      };
    }
    const cur = Object.values(prices);
    const mean = (v: number[]) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null);
    return {
      commodity, group: (rows.find((r) => r.commodity === commodity)?.grp as string | null) ?? null, markets: cur.length, prices,
      avg: mean(cur.map((p) => p.price)), avgPrev: mean(cur.map((p) => p.prev).filter((x): x is number => x != null))
    };
  }).filter((c) => c.markets > 0);
  const rank = (c: string) => { const k = STAPLES.indexOf(c); return k < 0 ? 99 : k; };
  commodities.sort((a, b) => rank(a.commodity) - rank(b.commodity) || b.markets - a.markets || a.commodity.localeCompare(b.commodity));
  const [meta] = await q(`SELECT DATE_FORMAT(MAX(fetched_at), '%Y-%m-%d %H:%i:%s') AS fetched FROM ${ops("mandi_market_prices")}`).catch(() => [{} as Row]);
  return { latest, dates, fetched: (meta?.fetched as string | null) ?? null, markets, commodities };
}
export type MandiMarkets = Awaited<ReturnType<typeof mandiMarkets>>;

/** Eight-week price series per watched commodity, for the region around Chennai or the state. */
export async function mandiWeekly(scope: "chennai_region" | "tamil_nadu") {
  const rows = await q(
    `SELECT DATE_FORMAT(week_start, '%Y-%m-%d') AS w, week_label, commodity, price, districts, chg_week, chg_month, chg_year
     FROM ${ops("mandi_weekly")} WHERE scope = ? ORDER BY commodity, week_start`, [scope]
  ).catch(() => [] as Row[]);
  const by = new Map<string, Row[]>();
  for (const r of rows) (by.get(r.commodity) ?? by.set(r.commodity, []).get(r.commodity)!).push(r);
  return WATCH.map(([name]) => name).filter((n) => by.has(n)).map((commodity) => {
    const s = by.get(commodity)!.slice(-8);
    const last = s[s.length - 1];
    return {
      commodity, week: last.week_label, price: Number(last.price), districts: Number(last.districts),
      chgWeek: last.chg_week == null ? null : Number(last.chg_week), chgMonth: last.chg_month == null ? null : Number(last.chg_month),
      chgYear: last.chg_year == null ? null : Number(last.chg_year), series: s.map((x) => Number(x.price)), labels: s.map((x) => x.week_label)
    };
  });
}

/** Latest price per commodity with its change and a 30-day series, for one scope. */
export async function mandi(scope: "chennai_markets" | "tamil_nadu") {
  const rows = await q(
    `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d, commodity, cmdt_group, price, arrival, msp FROM ${ops("mandi_prices")}
     WHERE scope = ? AND date > (SELECT MAX(date) FROM ${ops("mandi_prices")} WHERE scope = ?) - INTERVAL 31 DAY ORDER BY commodity, date`,
    [scope, scope]
  ).catch(() => [] as Row[]);
  const by = new Map<string, Row[]>();
  for (const r of rows) (by.get(r.commodity) ?? by.set(r.commodity, []).get(r.commodity)!).push(r);
  const out = [...by.entries()].map(([commodity, s]) => {
    const last = s[s.length - 1], prev = s[s.length - 2] ?? null;
    const week = s.filter((x) => x.d <= new Date(new Date(last.d).getTime() - 6 * 864e5).toISOString().slice(0, 10)).pop() ?? null;
    const avg = s.reduce((a, x) => a + Number(x.price), 0) / s.length;
    return {
      commodity, group: last.cmdt_group, date: last.d, price: Number(last.price), arrival: last.arrival == null ? null : Number(last.arrival),
      msp: last.msp == null ? null : Number(last.msp), prev: prev ? Number(prev.price) : null, week: week ? Number(week.price) : null,
      avg30: Math.round(avg * 100) / 100, series: s.map((x) => Number(x.price)), dates: s.map((x) => x.d)
    };
  });
  const order = ["Tomato", "Onion", "Potato"];
  out.sort((a, b) => (order.indexOf(a.commodity) + 1 || 99) - (order.indexOf(b.commodity) + 1 || 99) || b.price - a.price);
  const [meta] = await q(`SELECT DATE_FORMAT(MAX(fetched_at), '%Y-%m-%d %H:%i:%s') AS fetched, DATE_FORMAT(MAX(date), '%Y-%m-%d') AS latest
                          FROM ${ops("mandi_prices")} WHERE scope = ?`, [scope]).catch(() => [{} as Row]);
  return { scope, commodities: out, fetched: meta?.fetched ?? null, latest: meta?.latest ?? null };
}
