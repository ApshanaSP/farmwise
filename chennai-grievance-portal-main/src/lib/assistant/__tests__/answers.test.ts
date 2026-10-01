import { describe, expect, it } from "vitest";
import { requestedCount, wantsNoVisual, wantsTable, wantsVisual, wantsVisualByNature } from "@/lib/assistant/lang";

describe("pictures by the question's nature", () => {
  it.each(["top 3 worst zones", "which department has the most open complaints", "severe incidents this week by department", "zone-wise road accidents",
    "compare this week with last week", "road accident trend", "is flooding rising in Velachery", "where are the hotspots", "which lakes are nearly full",
    "முதல் 3 மண்டலங்கள்", "mandala vaariyaga kaattu zone wise-a", "share of complaints by category"])("%s is drawn", (q) => expect(wantsVisualByNature(q)).toBe(true));
  it.each(["what is this murder case in adyar", "how many road accidents this week", "tomato price", "who is the zonal officer for Zone 9", "what does test data mean",
    "which zone needs attention now", "the most recent incident in Velachery"])("%s is words", (q) => expect(wantsVisualByNature(q)).toBe(false));
  it("honours 'in words'", () => { expect(wantsNoVisual("top 3 zones, just tell me in words")).toBe(true); expect(wantsNoVisual("top 3 zones")).toBe(false); });
});
import { multiPart } from "@/lib/assistant/parts";

describe("questions about several subjects", () => {
  it("finds every subject, in order", () => {
    const p = multiPart("Give me the weekly summary of road accidents, flooding and public-infrastructure complaints in the district.");
    expect(p?.map((x) => x.label)).toEqual(["Road accidents", "Flooding", "Public infrastructure"]);
    expect(p?.[2].codes).toContain("ROAD_DAMAGE");
  });
  it("folds a narrower subject into the broader one named", () =>
    expect(multiPart("street lights and public infrastructure issues")?.map((x) => x.label)).toEqual(["Public infrastructure"]));
  it("reads Tamil and Tanglish", () => expect(multiPart("விபத்து மற்றும் வெள்ளம் இந்த வாரம்")?.map((x) => x.label)).toEqual(["Road accidents", "Flooding"]));
  it.each(["Which zone needs attention now?", "road accidents this week", "tomato price", "what is this murder case in adyar"])(
    "%s is one subject", (q) => expect(multiPart(q)).toBeNull());
});

describe("pictures only when asked", () => {
  it.each(["visualise severe incidents by zone", "show it as a pie chart", "graph of road accidents this month", "plot lake levels", "show Adyar incidents on the map",
    "diagram of complaints by department", "மண்டல வாரியாக வரைபடம் காட்டு", "zone wise graph-a kaattu", "show the trend of road accidents", "show it pictorially"])("%s wants a picture", (q) => expect(wantsVisual(q)).toBe(true));
  it.each(["top 3 zones by severe incidents", "Which zone needs attention now?", "tomato price", "what is this murder case in Adyar", "severe incidents this week by department"])(
    "%s is answered in words", (q) => expect(wantsVisual(q)).toBe(false));
  it("knows a request for a list", () => { expect(wantsTable("list the open incidents in Zone 9")).toBe(true); expect(wantsTable("tomato price")).toBe(false); });
});
import { offTopic } from "@/lib/assistant/guard";
import { applyTopN, spec, type Presentation } from "@/lib/assistant/datasets";

describe("requested count", () => {
  it.each([
    ["top 3 zones by severe incidents", 3], ["Top three departments with open complaints", 3], ["show the first 5 incidents", 5],
    ["5 worst wards in Adyar", 5], ["top-10 localities", 10], ["முதல் 3 மண்டலங்கள்", 3], ["top moonu zones sollunga", 3], ["lowest 2 taluks", 2]
  ])("%s -> %s", (q, n) => expect(requestedCount(q)).toBe(n));
  it.each(["incidents in the last 3 days", "first 5 days of September", "top 10% of wards", "Zone 13 most affected areas", "Which zone needs attention now?",
    "Velachery la indha week evlo accidents?"])("%s -> no count", (q) => expect(requestedCount(q)).toBeNull());
});

describe("off-topic questions", () => {
  it.each([["Who won the IPL?", "sports"], ["tell me a joke", "writing"], ["write a python function to sort", "coding"], ["bitcoin price today", "finance"],
    ["Show incidents in Madurai", "elsewhere"], ["what is my horoscope", "astrology"]])("%s -> %s", (q, topic) => expect(offTopic(q)).toBe(topic));
  it.each(["Which zone needs attention now?", "cricket ground flooding complaints in Chepauk", "history of complaints in Zone 9", "Show developing stories about Adyar",
    "onion price at K.K. Nagar market", "Chennai vs Madurai incidents"])("lets %s through", (q) => expect(offTopic(q)).toBeNull());
});

describe("top N", () => {
  const ds = { id: "zones", title: "Zones", fields: [{ key: "name", label: "Zone", kind: "category" as const }, { key: "severe", label: "Severe", kind: "value" as const, format: "integer" as const }],
    rows: [{ name: "A", severe: 1 }, { name: "B", severe: 5 }, { name: "C", severe: 3 }, { name: "D", severe: 4 }, { name: "E", severe: 0 }] };
  const p: Presentation = { datasets: [ds], chart: spec({ type: "horizontal_bar", dataset: "zones", x: "name", y: ["severe"], title: "t" }), kpis: [], table: null, display: "chart" };
  it("keeps exactly the rows asked for, highest first, and remembers the total", () => {
    const out = applyTopN(p, 3, "top 3 zones by severe");
    expect(out.datasets[0].rows.map((r) => r.name)).toEqual(["B", "D", "C"]);
    expect(out.datasets[0].total).toBe(5);
    expect(out.chart?.topN).toBe(3);
  });
  it("keeps the lowest when asked", () => expect(applyTopN(p, 2, "lowest 2 zones").datasets[0].rows.map((r) => r.name)).toEqual(["E", "A"]));
});
