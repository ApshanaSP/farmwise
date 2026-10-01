import { describe, expect, it } from "vitest";
import { allowedTypes, chartView, checkChart } from "@/lib/assistant/chartspec";
import { spec } from "@/lib/assistant/datasets";
import type { Dataset } from "@/lib/assistant/answer";

const zones: Dataset = {
  id: "zones", title: "Zones", drill: { field: "zone", action: "filter_zone" },
  fields: [{ key: "name", label: "Zone", kind: "category" }, { key: "zone", label: "Zone number", kind: "id" },
    { key: "score", label: "Attention score", kind: "value", format: "integer" }, { key: "pct", label: "Share", kind: "value", unit: "%", format: "percent" }],
  rows: Array.from({ length: 15 }, (_, i) => ({ name: `Zone ${i + 1}`, zone: i + 1, score: i < 12 ? 15 - i : 0, pct: 5 }))
};
const series: Dataset = {
  id: "series", title: "Over time", normal: { lo: 7, hi: 15, basis: "usual range" },
  fields: [{ key: "day", label: "Day", kind: "time" }, { key: "n", label: "Incidents", kind: "value", format: "integer" }],
  rows: [{ day: "1 Sep", n: 4 }, { day: "2 Sep", n: 12 }, { day: "3 Sep", n: 9 }]
};

describe("chart checker", () => {
  it("rejects an unknown dataset and falls back to the code's default", () => {
    const fallback = spec({ type: "horizontal_bar", dataset: "zones", x: "name", y: ["score"], title: "Zones" });
    const r = checkChart({ ...fallback, dataset: "nope" }, [zones], fallback);
    expect(r.spec?.dataset).toBe("zones");
    expect(r.fixes.join()).toMatch(/unknown dataset/);
  });
  it("never draws a dual axis", () => {
    const r = checkChart(spec({ type: "grouped_bar", dataset: "zones", x: "name", y: ["score", "pct"], title: "t" }), [zones]);
    expect(r.spec?.y).toEqual(["score"]);
  });
  it("sorts categories, keeps the top 10 and folds the rest into Others (dropping a zero Others)", () => {
    const r = checkChart(spec({ type: "horizontal_bar", dataset: "zones", x: "name", y: ["score"], title: "t", sort: "none" }), [zones]);
    expect(r.spec?.sort).toBe("desc");
    const v = chartView(r.spec!, zones);
    expect(v.categories.length).toBe(11);
    expect(v.categories[10]).toBe("Others");
    expect(v.series[0].values[0]).toBe(15);
    expect(v.highlight).toEqual([0]);
    const allZero = { ...zones, rows: zones.rows.map((x, i) => ({ ...x, score: i < 10 ? 10 - i : 0 })) };
    expect(chartView(r.spec!, allZero).categories).not.toContain("Others");
  });
  it("limits a donut to 6 slices", () => {
    const r = checkChart(spec({ type: "donut", dataset: "zones", x: "name", y: ["score"], title: "t" }), [zones]);
    const v = chartView(r.spec!, zones);
    expect(v.categories.length).toBeLessThanOrEqual(6);
  });
  it("keeps a line on its time axis and shows the normal band only when the data has one", () => {
    const r = checkChart(spec({ type: "line", dataset: "series", x: "day", y: ["n"], title: "t", normalBand: true }), [series]);
    expect(r.spec?.sort).toBe("none");
    expect(chartView(r.spec!, series).band).toEqual({ lo: 7, hi: 15, label: "usual range" });
    const noBand = checkChart(spec({ type: "line", dataset: "series", x: "day", y: ["n"], title: "t", normalBand: true }), [{ ...series, normal: null }]);
    expect(noBand.spec?.normalBand).toBe(false);
  });
  it("turns a line over categories into a bar chart", () => {
    const r = checkChart(spec({ type: "line", dataset: "zones", x: "name", y: ["score"], title: "t" }), [zones]);
    expect(r.spec?.type).not.toBe("line");
  });
  it("adds a title when the model gives none", () => {
    expect(checkChart(spec({ type: "horizontal_bar", dataset: "zones", x: "name", y: ["score"], title: "" }), [zones]).spec?.title).toBe("Attention score by zone");
  });
  it("treats counts per group over time as a time series, whatever the column order", () => {
    const perWard: Dataset = { id: "q1", title: "Weekly ward counts",
      fields: [{ key: "ward_no", label: "Ward", kind: "category" }, { key: "date", label: "Week", kind: "time" }, { key: "n", label: "Count", kind: "value", format: "integer" }],
      rows: [{ ward_no: "43", date: "2026-07-06", n: 3 }, { ward_no: "58", date: "2026-07-06", n: 5 }] };
    expect(allowedTypes(perWard)).toEqual(expect.arrayContaining(["line", "heatmap"]));
    const out = checkChart(spec({ type: "heatmap", dataset: "q1", x: "date", series: "ward_no", y: ["n"], title: "Weekly ward counts" }), [perWard]);
    expect(out.spec?.type).toBe("heatmap");
  });
});
