/**
 * Limits on large requests, enforced in code (never left to the model):
 *
 *   layer 1  the router flags "all / every / entire / export everything" (in English, Tamil
 *            and Tanglish) as a bulk request: the reply is a summary plus narrowing chips;
 *   layer 2  a pre-count decides how a query shrinks: aggregate, top 10 plus "Others",
 *            re-grain a long daily series, choropleth instead of too many points;
 *   layer 3  hard caps on rows, points, queries, time, tokens and requests.
 */

export const LIMITS = {
  rowsShown: 20,
  rowsMore: 100,
  pointsPerSeries: 120,
  mapPoints: 2000,
  groupsComputed: 50,
  groupsShown: 10,
  queriesPerQuestion: 3,
  dimensionsPerQuery: 2,
  queryMs: 5000,
  llmRows: 200,
  llmBytes: 20_000,
  requestsPerMinute: 20,
  requestsPerDay: 300,
  exportRows: 1000,
  exportsPerDay: 10,
  messageChars: 1500
} as const;

/** Words that ask for everything at once (layer 1, before the model is asked). */
const BULK = [
  /\b(all|every|entire|whole|full|complete)\b.{0,30}\b(incidents?|complaints?|records?|rows?|list|data(set)?|events?|reports?)\b/i,
  /\b(export|download|dump)\b.{0,20}\b(all|every|everything|entire|whole|full)\b/i,
  /\b(export|dump)\s+everything\b/i,
  /\bfull list\b/i,
  /அனைத்து|எல்லா(ம்)?\s*(புகார்|சம்பவ)|முழு\s*(பட்டியல்|தரவு)/,
  /\b(ella(a)?m|ellaa|ella|mothama|motham|muzhusa|muzhusum)\b.{0,30}\b(incidents?|complaints?|data|list|records?)\b/i
];
export function looksBulk(text: string): boolean {
  return BULK.some((re) => re.test(text));
}

// ------------------------------------------------------------- per-user rate --

interface Counter { minute: number[]; day: string; dayCount: number; inflight: AbortController | null }
const users = new Map<string, Counter>();
const istDay = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export interface Admit { ok: boolean; retryAfter?: number; reason?: "minute" | "day"; signal?: AbortSignal; release?: () => void }

/**
 * Admit one question for a user: 20 a minute, 300 a day, and one in flight (a new question
 * cancels the one still running, as the dialog does).
 */
export function admit(user: string): Admit {
  const now = Date.now();
  const c = users.get(user) ?? { minute: [], day: istDay(), dayCount: 0, inflight: null };
  users.set(user, c);
  c.minute = c.minute.filter((t) => now - t < 60_000);
  if (c.day !== istDay()) { c.day = istDay(); c.dayCount = 0; }
  if (c.minute.length >= LIMITS.requestsPerMinute) return { ok: false, reason: "minute", retryAfter: Math.ceil((60_000 - (now - c.minute[0])) / 1000) };
  if (c.dayCount >= LIMITS.requestsPerDay) return { ok: false, reason: "day", retryAfter: 3600 };
  c.minute.push(now);
  c.dayCount++;
  c.inflight?.abort(new Error("superseded by a newer question"));
  const ctl = new AbortController();
  c.inflight = ctl;
  return { ok: true, signal: ctl.signal, release: () => { if (c.inflight === ctl) c.inflight = null; } };
}

const exportsToday = new Map<string, { day: string; n: number }>();
/** Chat CSV exports: 10 a day per user. */
export function admitExport(user: string): boolean {
  const d = istDay();
  const e = exportsToday.get(user);
  const n = e && e.day === d ? e.n : 0;
  if (n >= LIMITS.exportsPerDay) return false;
  exportsToday.set(user, { day: d, n: n + 1 });
  return true;
}

// ---------------------------------------------------------------- shrinking --

/** Re-grain a daily series until it fits the points limit: day, then week, then month. */
export function grainFor(days: number): "day" | "week" | "month" {
  if (days <= LIMITS.pointsPerSeries) return "day";
  if (days / 7 <= LIMITS.pointsPerSeries) return "week";
  return "month";
}

/** Rows for the model: at most 200 rows and about 20 KB; the rest is summarised by code. */
export function forModel<T>(rows: T[]): { rows: T[]; dropped: number } {
  let out = rows.slice(0, LIMITS.llmRows);
  while (out.length > 5 && JSON.stringify(out).length > LIMITS.llmBytes) out = out.slice(0, Math.floor(out.length * 0.7));
  return { rows: out, dropped: rows.length - out.length };
}
