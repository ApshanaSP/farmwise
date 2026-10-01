/**
 * Semantic search over the district's incidents for Ask District IQ, with a local multilingual embedding model
 * (multilingual-e5-base through transformers.js / ONNX Runtime, 768 dimensions, English and Tamil). It runs on this
 * machine: no API key, nothing expires, and no incident text leaves it.
 *
 * Each incident is embedded from its category, title, place, zone and summary ("passage: ..."); a question is embedded
 * as "query: ...", and the closest incidents by cosine similarity are returned, optionally within a zone or category.
 *
 * Two modes, so the web server never stalls:
 *  - the full build runs as its own process (scripts/build-embeddings.ts, after the daily data refresh) and saves the
 *    vectors to data/embeddings/;
 *  - the web server loads that file, embeds only the questions (about 10 ms each), and adds incidents newer than the
 *    last build in small, paced batches on two threads (at most MAX_LIVE per refresh). Until an index exists, search
 *    returns null and callers fall back to keyword search.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { pathToFileURL } from "url";
import { RowDataPacket } from "mysql2";
import intelPool from "@/lib/collector/db";

const MODEL = (process.env.AI_EMBED_MODEL ?? "").trim() || "Xenova/multilingual-e5-base";
const DIR = path.join(process.cwd(), "data", "embeddings");
const FILE = path.join(DIR, `incidents-${MODEL.replace(/[^a-z0-9]+/gi, "_")}`);
/** New incidents the web server embeds itself before leaving the rest to the build job. */
const MAX_LIVE = 600;

type Extractor = (texts: string[], o: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;
/** What search filters and keyword-matches on: `words` = type, title, place and the pipeline's reasons, lower-cased. */
export interface Meta { zone: number | null; cat: string | null; t: number; sev: string | null; place: string; words: string }
interface Index { dim: number; ids: string[]; hash: string[]; vecs: Float32Array; pos: Map<string, number>; meta: Map<string, Meta>; asOf: string | null }
interface State { extractor: Promise<Extractor> | null; threads: number; index: Index | null; building: Promise<void> | null; progress: { done: number; total: number } | null;
  error: string | null; pending: number; fileMtime: number }

declare global {
  // eslint-disable-next-line no-var
  var __embed: State | undefined;
}
const S: State = (global.__embed ??= { extractor: null, threads: 2, index: null, building: null, progress: null, error: null, pending: 0, fileMtime: 0 });

/** The model, loaded once per process (downloaded on first use into .cache/models, about 280 MB), on `threads` CPU threads. */
function extractor(): Promise<Extractor> {
  S.extractor ??= (async () => {
    // loaded at run time from node_modules (not bundled): it carries ONNX Runtime's native binaries
    const entry = pathToFileURL(path.join(process.cwd(), "node_modules", "@huggingface", "transformers", "dist", "transformers.node.mjs")).href;
    // the build job loads the library itself and hands it over; the web server uses Node's own import(), which the bundler
    // does not rewrite (the library is an ES module with native ONNX Runtime binaries)
    const given = (globalThis as { __transformers?: any }).__transformers;
    const tf = given ?? (await (new Function("u", "return import(u)") as (u: string) => Promise<any>)(entry));
    tf.env.cacheDir = path.join(process.cwd(), ".cache", "models");
    const t0 = Date.now();
    const fe = await tf.pipeline("feature-extraction", MODEL, { dtype: "q8", session_options: { intraOpNumThreads: S.threads, interOpNumThreads: 1 } });
    console.info(`[assistant] embedding model ${MODEL} ready in ${Date.now() - t0} ms (${S.threads} threads)`);
    return fe as unknown as Extractor;
  })().catch((e) => { S.extractor = null; throw e; });
  return S.extractor;
}

async function embed(texts: string[]): Promise<{ vecs: Float32Array; dim: number }> {
  const fe = await extractor();
  const out = await fe(texts, { pooling: "mean", normalize: true });
  return { vecs: out.data, dim: out.dims[1] };
}

const sha = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
const clean = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** When the saved index was last written (by the build job or this process). */
function fileMtime(): number {
  try { return fs.statSync(`${FILE}.json`).mtimeMs; } catch { return 0; }
}

function load(): Index | null {
  try {
    const head = JSON.parse(fs.readFileSync(`${FILE}.json`, "utf8")) as { model: string; dim: number; ids: string[]; hash: string[] };
    if (head.model !== MODEL) return null;
    const buf = fs.readFileSync(`${FILE}.bin`);
    const vecs = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
    if (vecs.length !== head.ids.length * head.dim) return null;
    return { dim: head.dim, ids: head.ids, hash: head.hash, vecs, pos: new Map(head.ids.map((id, i) => [id, i])), meta: new Map(), asOf: null };
  } catch {
    return null;
  }
}

function save(ix: Index) {
  fs.mkdirSync(DIR, { recursive: true });
  // written beside and renamed, so a reader never sees half a file
  fs.writeFileSync(`${FILE}.bin.tmp`, Buffer.from(ix.vecs.buffer, ix.vecs.byteOffset, ix.ids.length * ix.dim * 4));
  fs.writeFileSync(`${FILE}.json.tmp`, JSON.stringify({ model: MODEL, dim: ix.dim, ids: ix.ids, hash: ix.hash, saved: new Date().toISOString() }));
  fs.renameSync(`${FILE}.bin.tmp`, `${FILE}.bin`);
  fs.renameSync(`${FILE}.json.tmp`, `${FILE}.json`);
}

export interface BuildOptions {
  /** embed at most this many new or changed incidents (newest first); the rest wait for the build job */
  maxNew?: number;
  batch?: number;
  /** pause between batches, so other work runs */
  pauseMs?: number;
  log?: (m: string) => void;
}

/** Bring the index up to the store: embed new or changed incidents and save. */
export async function buildIndex(asOf: string | null, o: BuildOptions = {}): Promise<{ total: number; embedded: number; waiting: number }> {
  const [rows] = await intelPool.query<RowDataPacket[]>(
    `SELECT incident_id AS id, category_label AS cat_label, category_code AS cat, title, place_text AS place, zone_no AS zone, zone_name, summary,
            severity_level AS sev, UNIX_TIMESTAMP(first_reported_at) AS t, severity_reasons, priority_reasons, attention_reason
     FROM incidents ORDER BY first_reported_at DESC`
  );
  const texts = new Map<string, string>();
  const meta = new Map<string, Meta>();
  for (const r of rows) {
    const id = String(r.id);
    texts.set(id, `passage: ${[clean(r.cat_label, 60), clean(r.title, 220), clean(r.place, 120), clean(r.zone_name, 40), clean(r.summary, 300)].filter(Boolean).join(". ")}`);
    meta.set(id, { zone: r.zone == null ? null : Number(r.zone), cat: r.cat ?? null, t: Number(r.t ?? 0), sev: r.sev ?? null, place: clean(r.place, 120).toLowerCase(),
      words: [r.cat_label, r.title, r.place, r.severity_reasons, r.priority_reasons, r.attention_reason].map((x) => clean(x, 300)).join(" ").toLowerCase() });
  }
  // the saved file when the build job has written a newer one than this process holds, else what is in memory
  const disk = fileMtime();
  const old = S.index && S.fileMtime >= disk ? S.index : load() ?? S.index;
  S.fileMtime = Math.max(S.fileMtime, disk);
  const all = [...texts.keys()];
  const hashOf = new Map(all.map((id) => [id, sha(texts.get(id)!)]));
  const todoAll = all.filter((id) => !old || old.hash[old.pos.get(id) ?? -1] !== hashOf.get(id));
  const todo = todoAll.slice(0, o.maxNew ?? Infinity); // rows come newest first
  const batch = o.batch ?? 32;
  S.progress = { done: 0, total: todo.length };
  if (todo.length) o.log?.(`embedding ${todo.length} of ${all.length} incidents with ${MODEL}${todoAll.length > todo.length ? ` (${todoAll.length - todo.length} left for the build job)` : ""}`);
  let dim = old?.dim ?? 0;
  const fresh = new Map<string, Float32Array>();
  for (let k = 0; k < todo.length; k += batch) {
    const part = todo.slice(k, k + batch);
    const e = await embed(part.map((id) => texts.get(id)!));
    dim = e.dim;
    part.forEach((id, j) => fresh.set(id, e.vecs.slice(j * dim, (j + 1) * dim)));
    S.progress = { done: Math.min(todo.length, k + batch), total: todo.length };
    if (o.log && (k / batch) % 50 === 0) o.log(`${Math.min(todo.length, k + batch)} / ${todo.length}`);
    await sleep(o.pauseMs ?? 0);
  }
  // incidents with a vector (kept, or made now); ones still waiting are left out until the build job reaches them
  const ids = all.filter((id) => fresh.has(id) || (old && old.pos.has(id) && old.hash[old.pos.get(id)!] === hashOf.get(id)));
  const vecs = new Float32Array(ids.length * dim);
  ids.forEach((id, i) => {
    const v = fresh.get(id) ?? old!.vecs.subarray(old!.pos.get(id)! * old!.dim, (old!.pos.get(id)! + 1) * old!.dim);
    vecs.set(v, i * dim);
  });
  S.index = { dim, ids, hash: ids.map((id) => hashOf.get(id)!), vecs, pos: new Map(ids.map((id, i) => [id, i])), meta, asOf };
  S.pending = todoAll.length - todo.length;
  if (todo.length) { save(S.index); S.fileMtime = fileMtime(); }
  S.progress = null;
  return { total: all.length, embedded: todo.length, waiting: S.pending };
}

/** For the build job: use more threads than the web server does. */
export function useThreads(n: number) {
  if (!S.extractor) S.threads = Math.max(1, Math.floor(n));
}

/**
 * On the web server: load the saved index and add a few new incidents in the background, paced so answers are never
 * held up. Never blocks the caller.
 */
export function warmUp(asOf: string) {
  // an index held from before the keyword field existed is refreshed (metadata only: its vectors are reused)
  const current = !!S.index && S.index.meta.values().next().value?.words !== undefined;
  if (S.building || (S.index && current && S.index.asOf === asOf && fileMtime() <= S.fileMtime)) return;
  S.building = buildIndex(asOf, { maxNew: MAX_LIVE, batch: 8, pauseMs: 40, log: (m) => console.info(`[assistant] embeddings: ${m}`) })
    .then(() => { S.error = null; })
    .catch((e) => { S.error = String((e as Error).message ?? e).slice(0, 200); console.warn(`[assistant] embedding index: ${S.error}`); })
    .finally(() => { S.building = null; });
}

export function embedStatus() {
  return { model: MODEL, ready: !!S.index?.ids.length, incidents: S.index?.ids.length ?? 0, waiting: S.pending, building: !!S.building, progress: S.progress, error: S.error };
}

/** `sim`: closeness in meaning (cosine); `score`: sim plus the caller's boost (keywords, recency, place), which ranks. */
export interface Hit { id: string; score: number; sim: number; meta: Meta }

/**
 * The incidents closest in meaning to `query`, best first, within `filter` (a zone, categories). Null while no index
 * exists yet (the caller falls back to keyword search).
 */
export async function semanticSearch(query: string, filter: { zone?: number | null; cats?: string[] | null } = {}, k = 10,
  boost?: (m: Meta) => number): Promise<Hit[] | null> {
  const ix = S.index;
  if (!ix || !ix.ids.length) return null;
  const q = (await embed([`query: ${query.slice(0, 300)}`])).vecs;
  const cats = filter.cats?.length ? new Set(filter.cats) : null;
  const hits: Hit[] = [];
  for (let i = 0; i < ix.ids.length; i++) {
    const m = ix.meta.get(ix.ids[i]);
    if (!m || (filter.zone != null && m.zone !== filter.zone) || (cats && (!m.cat || !cats.has(m.cat)))) continue;
    let s = 0;
    const o = i * ix.dim;
    for (let d = 0; d < ix.dim; d++) s += q[d] * ix.vecs[o + d];
    const score = boost ? s + boost(m) : s;
    if (hits.length < k || score > hits[hits.length - 1].score) {
      hits.push({ id: ix.ids[i], score, sim: s, meta: m });
      hits.sort((a, b) => b.score - a.score);
      if (hits.length > k) hits.pop();
    }
  }
  return hits;
}
