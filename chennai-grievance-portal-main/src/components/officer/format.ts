/* Client-side helpers shared by the officer console and its PDF report. No server imports here. */
import type { OfficerOverview } from "@/lib/officer/data";

export type Period = OfficerOverview["period"];
export const PERIOD_KEYS: Period[] = ["daily", "weekly", "monthly", "quarterly"];

const IST = { timeZone: "Asia/Kolkata" } as const;
const ms = (s: string) => new Date(s.replace(" ", "T") + "+05:30").getTime();

/** Label for each trend bucket (its start, counted from the window's start `since`): hours for the daily view, dates otherwise. */
export function bucketLabels(since: string, P: { hours: number; buckets: number }, period: Period): string[] {
  const start = ms(since), size = (P.hours * 3_600_000) / P.buckets;
  return Array.from({ length: P.buckets }, (_, k) => {
    const t = new Date(start + k * size);
    return period === "daily"
      ? t.toLocaleTimeString("en-US", { ...IST, hour: "numeric", hour12: true })
      : t.toLocaleDateString("en-GB", { ...IST, day: "numeric", month: "short" });
  });
}

const n = (v: number) => Math.round(v).toLocaleString("en-IN");
const plural = (k: number, one: string, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;

/**
 * The short written briefing on the grievances: plain statements of the figures on the dashboard,
 * for the PDF report. `area` is the zone / taluk in view, or null for the whole district.
 */
export function grievanceBriefing(ov: OfficerOverview, area: string | null): string[] {
  const k = ov.counts;
  const P = ov.periodInfo;
  const where = area ? ` in ${area}` : "";
  const total = ov.byType.reduce((s, r) => s + r.v, 0);
  const sev = Object.fromEntries(ov.map.sevCounts.map((s) => [s.sev, s.n]));
  const trend = ov.trend.length ? Array.from({ length: P.buckets }, (_, i) => ov.trend.reduce((s, x) => s + (x.v[i] ?? 0), 0)) : [];
  const half = Math.floor(trend.length / 2);
  const early = trend.slice(0, half).reduce((a, b) => a + b, 0), late = trend.slice(trend.length - half).reduce((a, b) => a + b, 0);
  const ok = ov.feedback.filter((f) => f.ok).length, back = ov.feedback.length - ok;
  const sv = sev.Severe ?? 0, hi = sev.High ?? 0;
  return [
    `${P.label}${where}: ${plural(total, "grievance")} reported. ${plural(k.new, "new grievance")} ${k.new === 1 ? "is" : "are"} waiting for approval, ` +
      `${n(k.action)} ${k.action === 1 ? "is" : "are"} in action${k.returned ? ` (${n(k.returned)} returned by the Collector)` : ""}, ` +
      `${n(k.sent)} with the Collector and ${n(k.verified)} verified.`,
    sv || hi
      ? `${[sv ? `${n(sv)} severe` : "", hi ? `${n(hi)} high-severity` : ""].filter(Boolean).join(" and ")} ${sv + hi === 1 ? "grievance is" : "grievances are"} still open.`
      : "No severe or high-severity grievance is open.",
    ov.byType[0] ? `Most complaints were about ${ov.byType[0].l.toLowerCase()} (${n(ov.byType[0].v)} of ${n(total)}).` : null,
    ov.byArea.rows[0] ? `${ov.byArea.rows[0].l} has the most open grievances (${n(ov.byArea.rows[0].v)}).` : null,
    trend.length >= 4 && (early || late)
      ? late > early ? `Reports rose in the second half of the period (${n(late)} against ${n(early)}).`
        : late < early ? `Reports fell in the second half of the period (${n(late)} against ${n(early)}).` : "Reports were steady across the period."
      : null,
    ov.feedback.length ? `The Collector verified ${plural(ok, "report")} and returned ${n(back)} for rework in this period.` : null,
    ov.news.length ? `${plural(ov.news.length, "grievance")} ${ov.news.length === 1 ? "was" : "were"} covered by the news.` : null
  ].filter(Boolean) as string[];
}
