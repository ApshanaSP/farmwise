import { describe, expect, it } from "vitest";
import { editFromText, isBareEdit } from "@/lib/assistant/edits";

describe("chart edits read from a follow-up", () => {
  it.each([["make it a pie", "donut"], ["as a table", "table"], ["show it as a line", "line"], ["bar chart please", "horizontal_bar"], ["as a heat map", "heatmap"]])(
    "%s -> %s", (q, type) => expect(editFromText(q)?.type).toBe(type));
  it("reads a map request as show-on-map", () => expect(editFromText("show on map")).toEqual({ type: null, showOnMap: true }));

  it.each(["make it a pie", "show on map", "as a table", "show it on the map please", "வரைபடத்தில் காட்டு", "pie chart-a podu"])(
    "%s is nothing but an edit", (q) => expect(isBareEdit(q)).toBe(true));
  it.each(["Show hotspots on the map", "only Zone 13", "map of road accidents", "table of open complaints by department"])(
    "%s names a new subject", (q) => expect(isBareEdit(q)).toBe(false));
});
