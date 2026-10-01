/**
 * Facts: every number an answer may state, each with an id. Tools supply the counts; this
 * module adds what code derives from them (percent change against the previous period,
 * shares of a total, ranks, differences), so the model never computes a number itself. The
 * verifier then accepts only numbers that are facts, context (dates, zones, the question's
 * own numbers) or plain arithmetic already done here.
 */
import type { Fact, ToolResult } from "@/lib/assistant/types";
import type { Dataset } from "@/lib/assistant/answer";

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const pctChange = (cur: number, prev: number) => (prev ? round(((cur - prev) / prev) * 100) : null);

/** Facts from the tools plus the derived ones, de-duplicated by id. */
export function buildFacts(results: ToolResult[], datasets: Dataset[]): Fact[] {
  const out = new Map<string, Fact>();
  const add = (f: Fact) => { if (Number.isFinite(f.value) && !out.has(f.id)) out.set(f.id, f); };
  for (const r of results) for (const f of r.facts) add(f);

  // percent change for every current/previous pair ("x" and "x.prev")
  for (const f of [...out.values()]) {
    const prev = out.get(`${f.id}.prev`);
    if (!prev) continue;
    const ch = pctChange(f.value, prev.value);
    add({ id: `${f.id}.diff`, label: `${f.label}: change on the previous period`, value: f.value - prev.value, unit: f.unit });
    if (ch != null) add({ id: `${f.id}.change_pct`, label: `${f.label}: % change on the previous period`, value: ch, unit: "%" });
  }

  // per dataset: totals, shares and ranks of each value column, and the rows shown
  for (const ds of datasets) {
    add({ id: `${ds.id}.rows`, label: `${ds.title}: rows`, value: ds.rows.length });
    if (ds.total != null) add({ id: `${ds.id}.total_rows`, label: `${ds.title}: total`, value: ds.total });
    const cat = ds.fields.find((f) => f.kind === "category");
    // a list of records (incidents, stories): a sum of their per-record values is not a count of anything
    const records = ds.fields.some((f) => f.kind === "id");
    for (const vf of ds.fields.filter((f) => f.kind === "value" && !f.key.endsWith("_prev"))) {
      const vals = ds.rows.map((r) => Number(r[vf.key])).filter((v) => Number.isFinite(v));
      if (!vals.length) continue;
      const additive = !records && vf.additive !== false && (vf.format === "integer" || vf.format === undefined);
      const total = vals.reduce((a, b) => a + b, 0);
      // labels name the table: a card can hold several ("Rs per kg, highest" alone is ambiguous next to one market's price)
      const of = `${ds.title}: ${vf.label}`;
      // a "top 3" keeps only three rows: their sum is not the total of everything
      const part = ds.total != null && ds.total > ds.rows.length ? ` (only the ${ds.rows.length} rows shown, of ${ds.total})` : "";
      if (additive && vals.length > 1) add({ id: `${ds.id}.${vf.key}.total`, label: `${of}, total of the rows${part}`, value: total, unit: vf.unit ?? undefined });
      // one row has no highest or lowest: those facts only invite "both are level 1"
      if (vals.length > 1) {
        add({ id: `${ds.id}.${vf.key}.max`, label: `${of}, highest`, value: Math.max(...vals), unit: vf.unit ?? undefined });
        add({ id: `${ds.id}.${vf.key}.min`, label: `${of}, lowest`, value: Math.min(...vals), unit: vf.unit ?? undefined });
      }
      if (vals.length > 1) add({ id: `${ds.id}.${vf.key}.avg`, label: `${of}, average of the rows`, value: round(total / vals.length), unit: vf.unit ?? undefined });
      if (!cat) continue;
      // over time and by group (weekly counts per ward): rank each group by its total over the period, not row by row
      const overTime = ds.fields.some((f) => f.kind === "time");
      if (overTime && !additive) continue;
      const byCat = new Map<string, number>();
      for (const r of ds.rows) {
        const v = Number(r[vf.key]);
        if (!Number.isFinite(v)) continue;
        const k = String(r[cat.key]);
        if (overTime) byCat.set(k, (byCat.get(k) ?? 0) + v);
        else if (!byCat.has(k)) byCat.set(k, v);
      }
      const sorted = [...byCat].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
      // which rows are above zero, named, so an answer never calls the rest "none" when they are not
      const above = sorted.filter((x) => x.v > 0);
      if (above.length < sorted.length) add({ id: `${ds.id}.${vf.key}.above_zero`, value: above.length,
        label: `${vf.label}: rows above zero (${above.slice(0, 8).map((x) => x.k).join(", ")}${above.length > 8 ? ", ..." : ""}); the other ${sorted.length - above.length} are zero` });
      sorted.slice(0, 15).forEach((x) => {
        // tied values share a rank
        const rank = 1 + sorted.filter((y) => y.v > x.v).length;
        const ties = sorted.filter((y) => y.v === x.v).length;
        add({ id: `${ds.id}.${vf.key}.${slug(x.k)}`, label: `${vf.label}, ${x.k}${overTime ? " (total over the period)" : ""}`, value: x.v, unit: vf.unit ?? undefined });
        add({ id: `${ds.id}.${vf.key}.${slug(x.k)}.rank`, label: `Rank of ${x.k} by ${vf.label.toLowerCase()}${ties > 1 ? ` (tied with ${ties - 1} other${ties > 2 ? "s" : ""})` : ""}`, value: rank });
        if (additive && total > 0) add({ id: `${ds.id}.${vf.key}.${slug(x.k)}.share`, label: `${x.k}: share of ${vf.label.toLowerCase()}`, value: round((x.v / total) * 100), unit: "%" });
        const prev = ds.hasPrev && !overTime ? Number(ds.rows.find((r) => String(r[cat.key]) === x.k)?.[`${vf.key}_prev`]) : NaN;
        if (Number.isFinite(prev)) {
          add({ id: `${ds.id}.${vf.key}.${slug(x.k)}.prev`, label: `${vf.label}, ${x.k}, previous`, value: prev, unit: vf.unit ?? undefined });
          const ch = pctChange(x.v, prev);
          if (ch != null) add({ id: `${ds.id}.${vf.key}.${slug(x.k)}.change_pct`, label: `${x.k}: % change on the previous`, value: ch, unit: "%" });
        }
      });
      // how far ahead the leader is
      if (sorted.length >= 2) add({ id: `${ds.id}.${vf.key}.lead`, label: `${vf.label}: first minus second`, value: round(sorted[0].v - sorted[1].v, 2), unit: vf.unit ?? undefined });
    }
    if (ds.normal) {
      add({ id: `${ds.id}.normal.lo`, label: `Usual range, low`, value: ds.normal.lo });
      add({ id: `${ds.id}.normal.hi`, label: `Usual range, high`, value: ds.normal.hi });
    }
  }
  return [...out.values()];
}

export const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9஀-௿]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "x";

/** Facts as compact lines for a prompt, most useful first, within a size budget. */
export function factLines(facts: Fact[], max = 80): string {
  const lines: string[] = [];
  for (const f of facts.slice(0, max)) lines.push(`${f.id} = ${f.value}${f.unit ? ` ${f.unit}` : ""} (${f.label})`);
  if (facts.length > max) lines.push(`... ${facts.length - max} more facts not shown`);
  return lines.join("\n");
}
