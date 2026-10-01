/**
 * Light NLP for items from sources the Collector adds and from OCR'd newspaper
 * pages: category from the pipeline's own English/Tamil keyword lists, and place
 * from the news monitor's gazetteer (localities with coordinates, English and Tamil names)
 * and the GCC area list (area -> primary ward -> zone -> taluk), then zone and taluk names.
 * Each result carries the terms that matched, so the finding stays explainable.
 */
import fs from "fs";
import path from "path";
import { RowDataPacket } from "mysql2";
import intelPool from "@/lib/collector/db";
import pool from "@/lib/db";

interface Category { code: string; label: string; lead: string; base_severity: number; playbook: string[]; keywords_en: string[]; keywords_ta: string[] }
interface Reference { categories: Category[]; taluks: { code: string; name: string; name_ta: string | null; in_district: boolean }[]; places?: Place[] }

let ref: Reference | null = null;
function reference(): Reference {
  if (!ref) ref = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "gcc-reference", "intel-reference.json"), "utf8"));
  return ref!;
}

export function categories() {
  return reference().categories.map((c) => ({ code: c.code, label: c.label, lead: c.lead, playbook: c.playbook }));
}

export interface Classified { code: string; label: string; dept: string; conf: number; terms: string[]; severity: number }

/** Best category by keyword hits (English and Tamil); null when nothing matches. */
export function classify(text: string): Classified | null {
  const t = ` ${text.toLowerCase()} `;
  let best: Classified | null = null;
  for (const c of reference().categories) {
    if (c.code === "OTHER") continue;
    const terms = [...(c.keywords_en ?? []), ...(c.keywords_ta ?? [])].filter((k) => k && t.includes(k.toLowerCase()));
    if (!terms.length) continue;
    const score = terms.length + terms.reduce((s, k) => s + Math.min(1, k.length / 20), 0);
    if (!best || score > best.conf) best = { code: c.code, label: c.label, dept: c.lead, conf: score, terms, severity: c.base_severity };
  }
  if (!best) return null;
  return { ...best, conf: Math.round(Math.min(0.95, 0.45 + 0.15 * best.terms.length) * 100) / 100 };
}

interface Place { name: string; kind: "locality" | "zone" | "taluk"; lat: number; lon: number; zone: number | null; aliases_en: string[]; aliases_ta: string[] }
interface Gaz {
  name: string; re: RegExp; ward: number | null; zone: number | null; taluk: string | null; kind: "area" | "zone" | "taluk";
  lat: number | null; lon: number | null;
}
let gaz: { at: number; list: Gaz[] } | null = null;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** English alias: whole words; spaces, dots and hyphens are interchangeable ("T. Nagar" = "T Nagar" = "T.Nagar"). */
const enRe = (a: string) => new RegExp(`\\b${a.trim().split(/[\s.\-]+/).filter(Boolean).map(esc).join("[\\s.\\-]*")}\\b`, "i");
/** Tamil alias: must start a word; case endings may follow (an alias ending in pulli also matches inflected forms). */
const taRe = (a: string) => new RegExp(`(^|[^\\u0B80-\\u0BFF])${esc(a.endsWith("\u0BCD") ? a.slice(0, -1) : a)}`);

async function gazetteer(): Promise<Gaz[]> {
  if (gaz && Date.now() - gaz.at < 6 * 3600_000) return gaz.list;
  const [[areas], [wards]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT a.name, aw.ward_number AS ward FROM gcc_areas a
       LEFT JOIN area_wards aw ON aw.area_id = a.id AND aw.is_primary = 1`
    ),
    intelPool.query<RowDataPacket[]>(`SELECT ward_no, zone_no, zone_name, taluk_code, centroid_lat, centroid_lon FROM ref_wards`)
  ]);
  const byWard = new Map(wards.map((w) => [Number(w.ward_no), w]));
  const zones = new Map<number, { name: string; lat: number[]; lon: number[] }>();
  for (const w of wards) {
    const z = zones.get(Number(w.zone_no)) ?? zones.set(Number(w.zone_no), { name: w.zone_name, lat: [], lon: [] }).get(Number(w.zone_no))!;
    z.lat.push(Number(w.centroid_lat));
    z.lon.push(Number(w.centroid_lon));
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const zoneNames = new Set([...zones.values()].map((z) => z.name.toLowerCase()));
  /** nearest ward centroid within 2 km: places outside the corporation keep their point but get no ward */
  const nearestWard = (lat: number, lon: number) => {
    let best: RowDataPacket | null = null, bd = Infinity;
    for (const w of wards) {
      const dy = (Number(w.centroid_lat) - lat) * 111.2, dx = (Number(w.centroid_lon) - lon) * 111.2 * Math.cos((lat * Math.PI) / 180);
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = w; }
    }
    return bd <= 2 ? best : null;
  };
  // An area name used in several zones is ambiguous: keep the name, not a guessed ward.
  const zonesOf = new Map<string, Set<number>>();
  for (const a of areas) {
    const w = a.ward ? byWard.get(Number(a.ward)) : null;
    const k = String(a.name).trim().toLowerCase();
    if (w) (zonesOf.get(k) ?? zonesOf.set(k, new Set()).get(k)!).add(Number(w.zone_no));
  }
  const list: Gaz[] = [];
  const seen = new Set<string>();
  const places = reference().places ?? [];
  // The news monitor's localities first: they carry coordinates and Tamil names.
  for (const p of places.filter((x) => x.kind === "locality")) {
    const w = nearestWard(p.lat, p.lon);
    const base = { name: p.name, ward: w ? Number(w.ward_no) : null, zone: w ? Number(w.zone_no) : null, taluk: w?.taluk_code ?? null, kind: "area" as const, lat: p.lat, lon: p.lon };
    for (const a of p.aliases_en) { seen.add(a.trim().toLowerCase()); list.push({ ...base, re: enRe(a) }); }
    for (const a of p.aliases_ta) list.push({ ...base, name: p.name, re: taRe(a) });
  }
  for (const a of areas) {
    const name = String(a.name).trim();
    const key = name.toLowerCase();
    // a zone's own name (e.g. Anna Nagar) resolves to the zone, not to a same-named locality elsewhere
    if (name.length < 4 || /^\d/.test(name) || zoneNames.has(key) || seen.has(key)) continue;
    seen.add(key);
    const ambiguous = (zonesOf.get(key)?.size ?? 0) > 1;
    const w = a.ward && !ambiguous ? byWard.get(Number(a.ward)) : null;
    list.push({ name: title(name), re: enRe(name), ward: w ? Number(w.ward_no) : null, zone: w ? Number(w.zone_no) : null, taluk: w?.taluk_code ?? null,
      kind: "area", lat: w ? Number(w.centroid_lat) : null, lon: w ? Number(w.centroid_lon) : null });
  }
  zones.forEach((z, no) => {
    const at = { lat: avg(z.lat), lon: avg(z.lon) };
    list.push({ name: z.name, re: enRe(z.name), ward: null, zone: no, taluk: null, kind: "zone", ...at });
    for (const p of places.filter((x) => x.kind === "zone" && x.zone === no)) for (const a of p.aliases_ta) list.push({ name: z.name, re: taRe(a), ward: null, zone: no, taluk: null, kind: "zone", ...at });
  });
  for (const t of reference().taluks.filter((x) => x.in_district)) {
    const p = places.find((x) => x.kind === "taluk" && x.name.toLowerCase() === t.name.toLowerCase());
    const at = { lat: p?.lat ?? null, lon: p?.lon ?? null };
    list.push({ name: t.name, re: enRe(t.name), ward: null, zone: null, taluk: t.code, kind: "taluk", ...at });
    for (const a of new Set([t.name_ta, ...(p?.aliases_ta ?? [])].filter(Boolean) as string[])) list.push({ name: t.name, re: taRe(a), ward: null, zone: null, taluk: t.code, kind: "taluk", ...at });
  }
  // longer names first, so "Anna Nagar East" wins over "Anna Nagar"
  list.sort((a, b) => b.re.source.length - a.re.source.length);
  gaz = { at: Date.now(), list };
  return list;
}
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Every place name the resolver knows (English), for the assistant's typo correction. */
export async function placeNames(): Promise<string[]> {
  return [...new Set((await gazetteer()).map((g) => g.name))];
}

/** Category labels and English keywords, for the assistant's typo correction. */
export function categoryWords(): string[] {
  return reference().categories.flatMap((c) => [c.label, ...(c.keywords_en ?? [])]);
}

export interface Placed { place: string; ward: number | null; zone: number | null; taluk: string | null; conf: number; lat: number | null; lon: number | null }

/** Most specific place named in the text: a locality or GCC area (ward level), else a zone, else a taluk. */
export async function resolvePlace(text: string): Promise<Placed | null> {
  const list = await gazetteer();
  const rank = { area: 3, zone: 2, taluk: 1 } as const;
  let best: Gaz | null = null;
  for (const g of list) {
    if (g.re.test(text) && (!best || rank[g.kind] > rank[best.kind])) {
      best = g;
      if (g.kind === "area") break;
    }
  }
  if (!best) return null;
  return {
    place: best.name, ward: best.ward, zone: best.zone, taluk: best.taluk, lat: best.lat, lon: best.lon,
    conf: best.kind === "area" ? (best.ward ? 0.8 : 0.6) : best.kind === "zone" ? 0.6 : 0.5
  };
}
