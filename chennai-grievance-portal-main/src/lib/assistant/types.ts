/**
 * Shapes shared by the assistant's tools, fact builder, composer and verifier.
 *
 * Every number an answer may state travels as a Fact with a stable id. The composer
 * copies values from facts and the verifier checks that each number in the answer is one
 * of them, so no number reaches the Collector that did not come from the store.
 */
import type { AssistantScope } from "@/lib/assistant/scope";

export interface Fact {
  /** stable id, e.g. "kpi.severe.cur" or "zone.9.score" */
  id: string;
  /** what the number is, in plain English (the composer translates) */
  label: string;
  value: number;
  /** "incidents", "%", "hours", "Rs/kg", ... */
  unit?: string;
}

export interface SourceRef {
  /** "function" = a console data function (intel.ts, insights.ts, ...); "table"/"view" = read directly */
  kind: "function" | "table" | "view";
  name: string;
  detail?: string;
}

export interface ToolResult<T = unknown> {
  tool: string;
  /** arguments after validation and defaults */
  args: Record<string, unknown>;
  /** console scope the numbers cover (null for tools without a scope, such as prices) */
  scope: AssistantScope | null;
  /** the store's as-of time (IST wall-clock), never the server clock */
  asOf: string;
  data: T;
  facts: Fact[];
  sources: SourceRef[];
  /** incidents behind the answer, so every claim can be opened */
  incidentIds: string[];
  /** true when any row comes from a synthetic (test) source */
  testData: boolean;
  /** honest limits that apply to this answer */
  caveats: string[];
  /**
   * Keys in `data` rows that hold text from outside the store's own rules (news headlines,
   * officer notes, items from added sources). The model only ever sees them inside
   * <untrusted_data>, as material to report, never as instructions.
   */
  untrusted?: string[];
}
