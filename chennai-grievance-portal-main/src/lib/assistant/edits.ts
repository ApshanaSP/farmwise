/**
 * Chart edits read straight from a follow-up ("make it a pie", "as a table", "show on map"),
 * backing up the router: a short message that is nothing but an edit redraws the previous
 * answer instead of asking a new question.
 */
import type { ChartType } from "@/lib/assistant/answer";

/** The edit a message asks for, if any. */
export function editFromText(message: string): { type: ChartType | null; showOnMap: boolean } | null {
  const t = message.toLowerCase();
  // "heat map" before "map": a heat map is a chart type, not the zone map
  if (/\bheat ?map\b/.test(t)) return { type: "heatmap", showOnMap: false };
  if (/\bmap\b|வரைபட|map-?la/.test(t)) return { type: null, showOnMap: true };
  const type: ChartType | null = /\b(pie|donut|doughnut)\b|வட்ட/.test(t) ? "donut" : /\btable\b|அட்டவணை/.test(t) ? "table" : /\bline\b|trend/.test(t) ? "line"
    : /\b(bar|column)s?\b/.test(t) ? "horizontal_bar" : null;
  return type ? { type, showOnMap: false } : null;
}

const EDIT_WORDS = new Set(["show", "it", "this", "that", "them", "these", "on", "the", "a", "an", "as", "in", "into", "to", "map", "pie", "donut", "doughnut",
  "chart", "graph", "table", "line", "bar", "bars", "column", "columns", "heatmap", "heat", "make", "draw", "display", "view", "see", "plot", "please",
  "can", "you", "instead", "switch", "change", "turn", "same", "data", "now", "la", "pannu", "kaattu", "podu", "ah", "me", "put", "one", "form", "format"]);
const EDIT_TA = /^(வரைபட|காட்ட|காட்டு|வட்ட|அட்டவணை|ஆக|இதை|அதை|மாற்று|வடிவ|போடு)/;

/** "make it a pie", "show on map": nothing but the edit. "Show hotspots on the map" names a new subject, so it is a question. */
export function isBareEdit(message: string): boolean {
  const words = message.toLowerCase().replace(/[^\p{L}\p{M}\s-]/gu, " ").split(/[\s-]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => EDIT_WORDS.has(w) || EDIT_TA.test(w));
}
