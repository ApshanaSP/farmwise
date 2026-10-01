/**
 * The console scope every answer is computed for: period, zone, department, category and
 * taluk, exactly the filters on the Collector console. A question is sent with the
 * console's current filters and answered for them unless it says otherwise, and every
 * answer prints its scope ("Last 7 days · Teynampet (Zone 9) · all departments · as of ...").
 */
import fs from "fs";
import path from "path";
import { z } from "zod";
import { RowDataPacket } from "mysql2";
import intelPool from "@/lib/collector/db";
import { exportMeta } from "@/lib/collector/intel";
import { PERIOD_LABEL, TEXT, type Lang } from "@/lib/assistant/lang";

export const PERIOD_KEYS = ["daily", "weekly", "monthly", "quarterly"] as const;

export const ScopeSchema = z.object({
  period: z.enum(PERIOD_KEYS).default("daily"),
  zone: z.number().int().min(1).max(15).nullable().default(null),
  dept: z.string().regex(/^[A-Z0-9-]{2,20}$/).nullable().default(null),
  cat: z.string().regex(/^[A-Z_]{3,40}$/).nullable().default(null),
  taluk: z.string().regex(/^TLK-[A-Z]{3}$/).nullable().default(null)
});
export type AssistantScope = z.infer<typeof ScopeSchema>;
export const DISTRICT_DAY: AssistantScope = { period: "daily", zone: null, dept: null, cat: null, taluk: null };

// ------------------------------------------------------------------ names --

export interface RefNames {
  zones: Map<number, { name: string; nameTa: string | null }>;
  depts: Map<string, { name: string; head: string | null; actionOwner: boolean }>;
  cats: Map<string, { label: string; lead: string | null }>;
  taluks: Map<string, { name: string; nameTa: string | null; inDistrict: boolean; note: string | null }>;
}

let names: { at: number; exportedAt: string | null; value: RefNames } | null = null;

/** Tamil zone names from the news monitor's gazetteer (the store holds English names only). */
function zoneNamesTa(): Map<number, string> {
  try {
    const ref = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "gcc-reference", "intel-reference.json"), "utf8"));
    const out = new Map<number, string>();
    for (const p of ref.places ?? []) if (p.kind === "zone" && p.zone && p.aliases_ta?.[0]) out.set(Number(p.zone), p.aliases_ta[0]);
    return out;
  } catch {
    return new Map();
  }
}

/** Zone, department, category and taluk names from the store's reference tables; reloaded after each export. */
export async function refNames(): Promise<RefNames> {
  if (names && Date.now() - names.at < 60_000) return names.value;
  const exportedAt = (await exportMeta()).exported_at ?? null;
  if (names && names.exportedAt === exportedAt) {
    names.at = Date.now();
    return names.value;
  }
  const [[zones], [depts], [cats], [taluks]] = await Promise.all([
    intelPool.query<RowDataPacket[]>(`SELECT DISTINCT zone_no, zone_name FROM ref_wards ORDER BY zone_no`),
    intelPool.query<RowDataPacket[]>(`SELECT code, name, head, action_owner FROM ref_departments`),
    intelPool.query<RowDataPacket[]>(`SELECT category_code, label, lead_dept FROM ref_categories`),
    intelPool.query<RowDataPacket[]>(`SELECT taluk_code, name, name_ta, in_district, note FROM ref_taluks`)
  ]);
  const ta = zoneNamesTa();
  const value: RefNames = {
    zones: new Map(zones.map((z) => [Number(z.zone_no), { name: String(z.zone_name), nameTa: ta.get(Number(z.zone_no)) ?? null }])),
    depts: new Map(depts.map((d) => [String(d.code), { name: String(d.name), head: d.head ?? null, actionOwner: Number(d.action_owner) === 1 }])),
    cats: new Map(cats.map((c) => [String(c.category_code), { label: String(c.label), lead: c.lead_dept ?? null }])),
    taluks: new Map(taluks.map((t) => [String(t.taluk_code), {
      name: String(t.name), nameTa: t.name_ta ?? null, inDistrict: Number(t.in_district) === 1, note: t.note ?? null
    }]))
  };
  names = { at: Date.now(), exportedAt, value };
  return value;
}

/** Problems with a scope's codes (unknown zone, department, category or taluk); empty when valid. */
export function scopeProblems(s: AssistantScope, n: RefNames): string[] {
  const out: string[] = [];
  if (s.zone != null && !n.zones.has(s.zone)) out.push(`Zone ${s.zone} is not one of the 15 GCC zones.`);
  if (s.dept && !n.depts.has(s.dept)) out.push(`Unknown department code ${s.dept}.`);
  if (s.cat && !n.cats.has(s.cat)) out.push(`Unknown category code ${s.cat}.`);
  if (s.taluk && !n.taluks.has(s.taluk)) out.push(`Unknown taluk code ${s.taluk}.`);
  return out;
}

// --------------------------------------------------------------- describe --

/** "29 Sep, 6:43 PM" (or the Tamil equivalent) from the store's IST wall-clock as-of time. */
export function fmtAsOf(asOf: string, lang: Lang): string {
  const d = new Date(asOf.replace(" ", "T") + "+05:30");
  if (Number.isNaN(d.getTime())) return asOf;
  const loc = lang === "ta" ? "ta-IN" : "en-GB";
  const tz = { timeZone: "Asia/Kolkata" } as const;
  const day = d.toLocaleDateString(loc, { ...tz, day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(lang === "ta" ? "ta-IN" : "en-US", { ...tz, hour: "numeric", minute: "2-digit", hour12: true });
  return `${day}, ${time}`;
}

/** The scope line printed on every answer card, in the reply language. */
export function describeScope(s: AssistantScope, n: RefNames, lang: Lang, asOf?: string): string {
  const parts: string[] = [PERIOD_LABEL[s.period][lang]];
  if (s.zone != null) {
    const z = n.zones.get(s.zone);
    const name = lang === "ta" ? z?.nameTa ?? z?.name : z?.name;
    parts.push(name ? `${name} (${TEXT.zone[lang]} ${s.zone})` : `${TEXT.zone[lang]} ${s.zone}`);
  }
  if (s.taluk) {
    const t = n.taluks.get(s.taluk);
    parts.push(`${(lang === "ta" ? t?.nameTa : null) ?? t?.name ?? s.taluk} ${TEXT.taluk[lang]}`);
  }
  if (s.zone == null && !s.taluk) parts.push(TEXT.districtWide[lang]);
  parts.push(s.dept ? n.depts.get(s.dept)?.name ?? s.dept : TEXT.allDepts[lang]);
  if (s.cat) parts.push(n.cats.get(s.cat)?.label ?? s.cat);
  if (asOf) parts.push(`${TEXT.asOf[lang]} ${fmtAsOf(asOf, lang)}`);
  return parts.join(" · ");
}
