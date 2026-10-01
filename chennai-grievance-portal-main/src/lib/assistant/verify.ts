/**
 * The number verifier. Every number in an answer's headline, text, spoken summary and chart
 * titles must be a fact (at the precision it is written: "97.7%" and "98%" both match 97.65)
 * or context that is not a claim: dates, times, years, incident IDs, zone and ward numbers,
 * the length of the window ("last 30 days"), numbers the question itself contains, and
 * numbers inside a headline quoted verbatim from the data. Anything else fails the answer.
 *
 * Numbers written as words are not checked; the composer is told to use digits.
 */
import type { Fact } from "@/lib/assistant/types";

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";
const TA_MONTHS = "ஜன|பிப்|மார்|ஏப்|மே|ஜூன்|ஜூலை|ஆக|செப்|அக்|நவ|டிச";
const WINDOW_WORD = /(last|past|previous|preceding|prior|over|within|in the|for the|next|kadandha|kadaisi|கடந்த|கடைசி|முந்தைய)\s*$/i;
/** Window lengths the console and tools use: 24 hours, 7/14/21/28/30/60/90/180 days, 12 weeks, 6 months, 2-hour buckets. */
const WINDOW_NUMBERS = new Set([1, 2, 6, 7, 12, 14, 21, 24, 28, 30, 60, 90, 180]);

const PATTERNS: RegExp[] = [
  /\b[A-Z]{2,}[-_][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*/g, // IDs: INC-20260928-BF90AB, THR-..., TLK-EGM
  /\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/g, // ISO dates and times
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\b\\.?(?:,?\\s+\\d{4})?`, "gi"), // 29 Sep 2026
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4})?`, "gi"), // Sep 29
  new RegExp(`\\d{1,2}\\s*(?:${TA_MONTHS})\\S*`, "g"), // 29 செப்.
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, // 29/09
  /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?/gi, // 6:43 PM, 18:43
  /\b\d{1,2}\.\d{2}\s*(?:am|pm|a\.m\.|p\.m\.)/gi, // 6.43 pm (a dot only with am/pm: 97.65 is a number)
  /\b(?:19|20)\d{2}\b/g, // years
  /\b(?:zone|ward|zones|wards|மண்டலம்|மண்டல|வார்டு)\s*(?:no\.?\s*)?\d{1,3}(?:\s*(?:and|&|,|to|-)\s*\d{1,3})*/gi, // Zone 9, wards 64 and 65
  /\bw\/e\b/gi
];
const NUMBER = /(?<![\w.])[-−]?(?:\d{1,3}(?:,\d{3})+|\d{1,3}(?:,\d{2})+,\d{3}|\d+)(?:\.\d+)?(?:\s*(lakhs?|crores?|k)\b)?/gi;
const DURATION = /(\d{1,3})\s*[- ]?(?:hours?|hrs?|days?|weeks?|months?|மணி\S*|நாட்\S*|நாள்\S*|வார\S*|மாத\S*|naal|naatkal|vaaram|maasam)/gi;

export interface Verdict { ok: boolean; checked: number; unmatched: string[] }

/** Numbers written in a text, with how many decimals each was written with. */
export function extractNumbers(text: string, quotable: string[] = []): { raw: string; value: number; decimals: number; scale: number }[] {
  let t = ` ${String(text ?? "").replace(/[௦-௯]/g, (c) => String(c.charCodeAt(0) - 0x0be6))} `;
  // a headline quoted verbatim from the data carries its own numbers
  t = t.replace(/[“"‘']([^“”"‘’']{6,240})[”"’']/g, (m, inner: string) => (quotable.some((q) => q.includes(inner.trim())) ? " " : m));
  for (const re of PATTERNS) t = t.replace(re, " ");
  // the window's own length ("last 30 days", "28-day mean"), not a claim
  t = t.replace(DURATION, (m, n: string, offset: number, all: string) =>
    WINDOW_NUMBERS.has(Number(n)) || WINDOW_WORD.test(all.slice(Math.max(0, offset - 20), offset)) ? " " : m);
  const out: { raw: string; value: number; decimals: number; scale: number }[] = [];
  for (const m of t.matchAll(NUMBER)) {
    const raw = m[0].trim();
    const digits = raw.replace(/[−]/g, "-").replace(/[^0-9.-]/g, "");
    let value = Number(digits);
    if (!Number.isFinite(value)) continue;
    const decimals = (digits.split(".")[1] ?? "").length;
    const unit = (m[1] ?? "").toLowerCase();
    const scale = unit.startsWith("lakh") ? 1e5 : unit.startsWith("crore") ? 1e7 : unit === "k" ? 1e3 : 1;
    value *= scale;
    out.push({ raw, value, decimals, scale });
  }
  return out;
}

/** Check the texts of an answer against the facts. `context` = numbers that are not claims (the question's own, the scope's). */
export function verifyNumbers(texts: string[], facts: Fact[], context: number[] = [], quotable: string[] = []): Verdict {
  const allowed = [...facts.map((f) => f.value), ...context];
  const unmatched: string[] = [];
  let checked = 0;
  for (const text of texts) {
    for (const n of extractNumbers(text, quotable)) {
      checked++;
      const tol = 0.5 * 10 ** -n.decimals * n.scale + 1e-9;
      const ok = allowed.some((a) => Math.abs(Math.abs(a) - Math.abs(n.value)) <= tol);
      if (!ok) unmatched.push(n.raw);
    }
  }
  return { ok: unmatched.length === 0, checked, unmatched: [...new Set(unmatched)] };
}

/** Numbers in the question and the scope line: repeating them is not a claim. */
export function contextNumbers(...texts: string[]): number[] {
  const out: number[] = [];
  for (const t of texts) for (const n of extractNumbers(t)) out.push(n.value);
  for (const re of [/\b(?:zone|ward|மண்டலம்)\s*(\d{1,3})/gi]) for (const t of texts) for (const m of String(t).matchAll(re)) out.push(Number(m[1]));
  return out;
}
