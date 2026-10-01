import { describe, expect, it } from "vitest";
import { contextNumbers, extractNumbers, verifyNumbers } from "@/lib/assistant/verify";
import type { Fact } from "@/lib/assistant/types";

const f = (id: string, value: number): Fact => ({ id, label: id, value });

describe("number extraction", () => {
  it("reads Indian and Western grouping, decimals, rupees, percentages and lakh", () => {
    const n = extractNumbers("1,23,456 cases, 1,234,567 rows, ₹35.25/kg, 97.7% and 1.2 lakh").map((x) => x.value);
    expect(n).toEqual([123456, 1234567, 35.25, 97.7, 120000]);
  });
  it("skips dates, times, years, IDs and zone or ward numbers", () => {
    const n = extractNumbers("As of 29 Sep 2026, 6:43 PM, INC-20260928-BF90AB in Zone 9 and ward 179 on 2026-09-29").map((x) => x.value);
    expect(n).toEqual([]);
  });
  it("skips the window's own length but not other durations", () => {
    expect(extractNumbers("in the last 30 days").map((x) => x.value)).toEqual([]);
    expect(extractNumbers("open for 42 days on average").map((x) => x.value)).toEqual([42]);
  });
  it("checks two-decimal numbers (not mistaken for times) and skips real times", () => {
    expect(extractNumbers("97.65% at 6.43 pm and 18:43").map((x) => x.value)).toEqual([97.65]);
  });
  it("reads Tamil digits", () => {
    expect(extractNumbers("௧௬ சம்பவங்கள்").map((x) => x.value)).toEqual([16]);
  });
});

describe("verifier", () => {
  const facts = [f("a", 97.65), f("b", 1065), f("c", 24), f("d", -21.2)];
  it("accepts facts at the precision written", () => {
    expect(verifyNumbers(["97.7% and 98% of beds; 1,065 incidents; 24 severe"], facts).ok).toBe(true);
  });
  it("accepts a change written without its sign", () => {
    expect(verifyNumbers(["down 21.2% on last week"], facts).ok).toBe(true);
  });
  it("rejects a number that is not a fact", () => {
    const v = verifyNumbers(["1,066 incidents"], facts);
    expect(v.ok).toBe(false);
    expect(v.unmatched).toEqual(["1,066"]);
  });
  it("rejects a rounding the precision does not allow", () => {
    expect(verifyNumbers(["97.5%"], facts).ok).toBe(false);
  });
  it("accepts numbers from the question and numbers inside a quoted headline", () => {
    expect(verifyNumbers(["above 90%"], [], contextNumbers("Which hospitals are above 90% beds?")).ok).toBe(true);
    expect(verifyNumbers(["News: \"6 TMC of water in the lakes\""], [], [], ["6 TMC of water in the lakes this year"]).ok).toBe(true);
  });
});
