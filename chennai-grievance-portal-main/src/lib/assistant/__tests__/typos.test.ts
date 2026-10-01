import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/collector/nlp", () => ({
  placeNames: async () => ["Adyar", "Velachery", "Anna Nagar", "Thiruvanmiyur", "Royapuram", "K.K. Nagar"],
  categoryWords: () => ["Road accident", "accident", "theft", "flooding", "garbage"]
}));

import { closest, editDistance, matchCommodities } from "@/lib/assistant/fuzzy";
import { correctSpelling } from "@/lib/assistant/spell";

const COMMODITIES = ["Tomato", "Onion", "Onion Green", "Potato", "Brinjal", "Bhindi(Ladies Finger)", "Green Chilli", "Cucumbar(Kheera)", "Banana", "Banana - Green"];

describe("edit distance", () => {
  it("counts a swapped pair as one edit", () => expect(editDistance("incidnets", "incidents")).toBe(1));
  it("refuses to guess between equally close words", () => expect(closest("bard", ["ward", "card"])).toBeNull());
  it("keeps the first letter unless one edit away", () => expect(closest("matter", ["water"])).toBeNull());
});

describe("commodities", () => {
  it.each([["tomato", ["Tomato"]], ["tomatoe", ["Tomato"]], ["tomatto", ["Tomato"]], ["Tomatoes", ["Tomato"]], ["thakkali", ["Tomato"]], ["தக்காளி", ["Tomato"]],
    ["tamatar", ["Tomato"]], ["onion", ["Onion"]], ["onoin", ["Onion"]], ["green onion", ["Onion Green"]], ["tomato and onion", ["Tomato", "Onion"]],
    ["ladies finger", ["Bhindi(Ladies Finger)"]], ["vendakkai", ["Bhindi(Ladies Finger)"]], ["cucumber", ["Cucumbar(Kheera)"]], ["banana", ["Banana"]]])(
    "%s -> %j", (q, want) => expect(matchCommodities(q, COMMODITIES).matched).toEqual(want));
  it("names what it could not match", () => expect(matchCommodities("saffron", COMMODITIES)).toEqual({ matched: [], unknown: ["saffron"] }));
});

describe("spelling", () => {
  it.each([
    ["tomatoe prifce", "tomato price"], ["incidnets in adyr", "incidents in adyar"], ["Velacheri accidnets this week", "Velachery accidents this week"],
    ["severe incidnets by departmnet", "severe incidents by department"], ["garbge complaints in Royapuram", "garbage complaints in Royapuram"]
  ])("%s -> %s", async (q, want) => expect((await correctSpelling(q)).text).toBe(want));
  it.each(["Which zone needs attention now?", "Velachery la indha week evlo accidents?", "show me the words", "what does it matter", "INC-20260925-D9C205 status",
    "Zone 13 compared with last month", "open complaints reported yesterday", "incidents in Adyar location wise"])("leaves %s alone", async (q) => expect((await correctSpelling(q)).fixes).toEqual([]));
});
