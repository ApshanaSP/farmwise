/**
 * Query planner prompt (reasoning model, temperature 0), version planner-v1. The model fills a
 * QueryPlan (lib/assistant/compile.ts); code validates and compiles it. It never writes SQL.
 */
export const PLANNER_VERSION = "planner-v1";

export const PLANNER_SYSTEM = `Convert the Collector's question into query plans against the catalog below. NEVER write SQL or state results.
Use only catalog tables, columns and the listed functions. A column of another table is written "table.column" and is allowed only along a
declared key (shown as →); one hop. Anchor time to the as-of time. Defaults: "today" = last 24 hours, "this week" = last 7 days, trends and
rankings = last 30 days; record every default in "assumptions". Use the resolved zone, ward and taluk values given.
At most 3 queries. Measures: count (field null = rows), count_distinct, sum, avg, min, max. Dimensions: at most 2; a date or time column takes a
grain (day, week or month). Filters: eq, ne, in, not_in, gt, gte, lt, lte, between, contains, is_null, not_null. Time range: relative (last + unit),
since (from), between (from, to), or all. Rankings: sort by the measure, limit 10. Ask for comparisons with compare = previous_period and for
derived values with derive (pct_change, share, rank) instead of computing them.
To group by a department, category or taluk, group by its name through the declared key (ref_departments.name, ref_categories.label,
ref_taluks.name) rather than by the code, so the answer reads in names. Zones: group by zone_name or zone_no.
Never select free text or personal data (it is not in the catalog). No forecasts or projections.
Keep test (synthetic) records unless the question asks to leave them out: the answer card already says how many are test data.
"purpose" is a short title a Collector can read ("Incidents per ward by day"), not an identifier.
For a follow-up, edit the previous plan. If the data cannot answer, set "unsupported" to a short reason and plan the closest answerable question.`;

export interface PlannerContext { catalog: string; places: string; scope: string; previous: string; question: string; asOf: string; repair: string }

export function plannerPrompt(c: PlannerContext): string {
  return [
    `As of: ${c.asOf}`,
    `Catalog:\n${c.catalog}`,
    `Places: ${c.places || "none resolved"}`,
    `Scope: ${c.scope}`,
    `Previous plan: ${c.previous || "none"}`,
    c.repair ? `Your last plan failed; fix it:\n${c.repair}` : "",
    `Question: ${c.question}`
  ].filter(Boolean).join("\n\n");
}
