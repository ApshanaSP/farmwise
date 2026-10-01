/**
 * "Insights for today": the top items from the console's own insights() (briefing attention
 * list, emerging patterns, news-only incidents, the day's headline change), never a new
 * detector. Each insight names the tools that draw its card, so opening one runs the same
 * tools-first path as a question: numbers from the store, chart with "compared to what".
 * Ranking: the pipeline's priority, then recency, then the Collector's 👍/👎 on that insight.
 * On a department officer's console the insights are the same, for that department only.
 */
import { RowDataPacket } from "mysql2";
import intelPool, { ops } from "@/lib/collector/db";
import { insights } from "@/lib/collector/insights";
import type { Lang } from "@/lib/assistant/lang";
import type { Scope } from "@/lib/assistant/answer";

type Row = Record<string, any>;

export interface InsightItem {
  key: string;
  kind: "attention" | "pattern" | "gap" | "change";
  title: string;
  finding: string;
  why: string;
  incidentIds: string[];
  /** the tools that draw its card */
  tools: { name: string; args: Record<string, unknown> }[];
  /** the question it answers, shown in the chat as the Collector's turn */
  question: string;
  priority: number;
}

const SEV: Record<string, number> = { Severe: 40, High: 25, Medium: 10, Low: 5 };

/** per department ("" = the whole district, for the Collector) */
const cache = new Map<string, { at: number; items: InsightItem[] }>();

/** Today's insights, ranked, at most `limit`. Cached for five minutes (the store changes with each pipeline run). `dept`: one department's only. */
export async function todayInsights(owner: string, limit = 5, dept: string | null = null): Promise<InsightItem[]> {
  let hit = cache.get(dept ?? "");
  if (!hit || Date.now() - hit.at > 5 * 60_000) cache.set(dept ?? "", hit = { at: Date.now(), items: await build(dept) });
  const votes = await feedbackByKey(owner);
  return [...hit.items].map((x) => ({ ...x, priority: x.priority + 15 * (votes.get(x.key) ?? 0) }))
    .sort((a, b) => b.priority - a.priority).slice(0, limit);
}

export async function insightByKey(owner: string, key: string, dept: string | null = null): Promise<InsightItem | null> {
  return (await todayInsights(owner, 50, dept)).find((x) => x.key === key) ?? null;
}

async function build(dept: string | null): Promise<InsightItem[]> {
  const d = await insights("daily", null, dept);
  const scope = (s: Partial<Scope>): Scope => ({ period: "daily", zone: null, dept, cat: null, taluk: null, ...s });
  const b = d.briefing;
  const out: InsightItem[] = [];

  // the day's headline change against the previous period
  const st = b.stats as Row;
  if (st && st.change != null && Math.abs(Number(st.change)) >= 15) {
    out.push({
      key: `change:${d.now.slice(0, 10)}`, kind: "change", title: `Reports ${Number(st.change) > 0 ? "up" : "down"} on the previous day`,
      finding: String(b.headline?.[0] ?? ""), why: "A large swing in reports changes where attention is needed.", incidentIds: [],
      tools: [{ name: "overview_kpis", args: { scope: scope({}) } }, { name: "incident_series", args: { scope: scope({ period: "weekly" }) } }],
      question: "How do today's reports compare with the usual?", priority: 30 + Math.min(20, Math.abs(Number(st.change)) / 5)
    });
  }

  // emerging patterns: far more reports than expected for a category in a zone
  for (const e of (b.emerging as Row[]).slice(0, 4)) {
    const days = Math.max(0, (Date.parse(d.now.slice(0, 10)) - Date.parse(String(e.date))) / 864e5);
    out.push({
      key: `pattern:${e.cat}:${e.zone}:${e.date}`, kind: "pattern", title: `${e.label} in ${e.zone_name}`,
      finding: String(e.text), why: "A category rising well above its usual level in one zone often points to a local cause worth checking.",
      incidentIds: [], tools: [{ name: "incident_series", args: { scope: scope({ period: "monthly", zone: Number(e.zone), cat: String(e.cat) }) } }],
      question: `${e.label} trend in ${e.zone_name} over the last 30 days`, priority: 20 + Math.min(25, Number(e.ratio) * 2) - days * 3
    });
  }

  // the briefing's attention list: the incidents that most need a decision
  for (const a of (b.attention as Row[]).slice(0, 4)) {
    out.push({
      key: `attention:${a.id}`, kind: "attention", title: String(a.title),
      finding: `${a.sev}, ${a.zone ?? "Chennai"}, ${a.status}: ${[...(a.why?.what ?? []), ...(a.why?.why ?? [])].slice(0, 3).join("; ")}.`,
      why: a.next ? `Next step: ${a.next.owner ?? "the department"} - ${a.next.text}.` : "Listed on today's briefing as needing attention.",
      incidentIds: [String(a.id)], tools: [{ name: "incident_detail", args: { id: String(a.id) } }],
      question: `Why does ${a.id} need attention?`, priority: (SEV[a.sev] ?? 10) + 5
    });
  }

  // incidents in the news with no department record (the Collector's: no department owns them yet)
  const gaps = dept ? [] : (d.gaps as Row[]);
  if (gaps.length) {
    out.push({
      key: `gaps:${d.now.slice(0, 10)}`, kind: "gap", title: `${gaps.length} incidents in the news with no department record`,
      finding: `Top: ${gaps.slice(0, 2).map((g) => g.title).join("; ")}.`, why: "News-only incidents may need a department to pick them up.",
      incidentIds: gaps.slice(0, 10).map((g) => String(g.id)).filter(Boolean),
      tools: [{ name: "news_gaps", args: { scope: scope({ period: "weekly" }) } }], question: "Which incidents are in the news but have no department record?",
      priority: 18 + Math.min(10, gaps.length / 5)
    });
  }
  return out;
}

async function feedbackByKey(owner: string): Promise<Map<string, number>> {
  try {
    const [rows] = await intelPool.query<RowDataPacket[]>(
      `SELECT insight_key AS k, SUM(rating) AS r FROM ${ops("assistant_feedback")} WHERE owner = ? AND insight_key IS NOT NULL GROUP BY insight_key`, [owner]);
    return new Map(rows.map((r) => [String(r.k), Math.max(-2, Math.min(2, Number(r.r)))]));
  } catch {
    return new Map();
  }
}

/** Short labels for the launcher and the chips, per language (the finding stays as the store wrote it). */
export const INSIGHT_LABEL: Record<Lang, string> = { en: "Insights for today", ta: "இன்றைய முக்கியத் தகவல்கள்", tanglish: "Innaikku insights" };
