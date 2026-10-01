/**
 * The Department Officer's PDF report, drawn in the browser with jsPDF (as the Collector's is):
 * key figures, a short written briefing, charts drawn as vector shapes, the grievances waiting
 * for action, the Collector's feedback, and the department's own data (when it has data files).
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { OfficerOverview } from "@/lib/officer/data";
import type { InsightModule } from "@/lib/officer/insights";
import { STAGE_LABEL, type Stage } from "@/lib/officer/stages";
import { bucketLabels, grievanceBriefing } from "./format";

type Row = Record<string, any>;
type RGB = [number, number, number];

const NAVY: RGB = [11, 61, 145];
const INK: RGB = [12, 27, 51];
const MUTED: RGB = [90, 106, 135];
const LINE: RGB = [223, 230, 242];
const SOFT: RGB = [244, 247, 253];
const BLUE: RGB = [21, 96, 232];
const SEV: Record<string, RGB> = { Severe: [217, 45, 53], High: [224, 115, 13], Medium: [185, 138, 0], Low: [18, 146, 95] };
const TONE: Record<string, RGB> = { sev: SEV.Severe, high: SEV.High, med: SEV.Medium, low: SEV.Low, info: BLUE, violet: [106, 85, 216] };
const BLUES: RGB[] = [[21, 96, 232], [59, 124, 240], [102, 153, 245], [143, 181, 248], [183, 207, 250], [205, 221, 251]];
const W = 210, H = 297, M = 14;

/** Standard PDF fonts cover Latin-1 only: normalise punctuation and symbols, drop other scripts. */
function t(s: unknown): string {
  return String(s ?? "")
    .replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/→/g, "->").replace(/₹\s?/g, "Rs. ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "").replace(/\s+/g, " ").trim();
}
const n = (v: number) => Math.round(v).toLocaleString("en-IN");
/** One line of text cut to `w` mm (at the current font) with "...", so a long label never runs into the next column. */
function clip(doc: jsPDF, s: string, w: number): string {
  if (doc.getTextWidth(s) <= w) return s;
  let out = s;
  while (out.length > 1 && doc.getTextWidth(`${out}...`) > w) out = out.slice(0, -1);
  return `${out.trimEnd()}...`;
}
const when = (s: string) => new Date(s.replace(" ", "T") + "+05:30")
  .toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });

export interface ReportInput {
  ov: OfficerOverview;
  area: string | null;
  waiting: Row[];
  modules: InsightModule[];
  file: string;
}

export function buildOfficerReport({ ov, area, waiting, modules, file }: ReportInput) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  let y = 0;
  const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const font = (size: number, style: "normal" | "bold" = "normal") => { doc.setFont("helvetica", style); doc.setFontSize(size); };
  const need = (h: number) => { if (y + h > H - 16) { doc.addPage(); y = 18; } };
  const section = (text: string, sub?: string) => {
    need(16);
    fill(NAVY); doc.rect(M, y, 3, 7, "F");
    font(13, "bold"); color(INK); doc.text(t(text), M + 6, y + 5.6);
    if (sub) { font(9); color(MUTED); doc.text(t(sub), W - M, y + 5.6, { align: "right" }); }
    y += 11;
  };
  const bullets = (lines: string[]) => {
    font(10); color(INK);
    for (const s of lines) {
      const wrapped = doc.splitTextToSize(t(s), W - 2 * M - 7);
      need(wrapped.length * 4.6 + 1.5);
      fill(NAVY); doc.circle(M + 1.6, y - 1.2, 0.9, "F");
      doc.text(wrapped, M + 5, y);
      y += wrapped.length * 4.6 + 1.5;
    }
    y += 2;
  };
  const P = ov.periodInfo;

  // ---------------------------------------------------------------- cover --
  fill(NAVY); doc.rect(0, 0, W, 40, "F");
  fill([31, 107, 234]); doc.rect(0, 38, W, 2, "F");
  color([255, 255, 255]);
  font(9.5, "bold"); doc.text("DISTRICT IQ  |  Department Officer report", M, 11);
  font(19, "bold"); doc.text(t(ov.dept.name), M, 22);
  font(10); color([205, 222, 255]);
  doc.text(t(`${P.label} · ${area ?? "All areas"}${ov.dept.org ? ` · ${ov.dept.org}` : ""}`), M, 30);
  doc.text(t(`Last updated ${ov.updated.at ? when(ov.updated.at) : "-"}  ·  Generated ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} IST`), M, 35.5);
  y = 48;

  const k = ov.counts;
  const tiles: [string, number, string, RGB][] = [
    ["New grievances", k.new, "waiting for approval", SEV.Severe], ["In action", k.action, k.returned ? `${n(k.returned)} returned for rework` : "approved or work started", SEV.High],
    ["Sent to Collector", k.sent, "waiting for verification", [106, 85, 216]], ["Verified", k.verified, "by the Collector", SEV.Low]
  ];
  const tw = (W - 2 * M - 3 * 4) / 4;
  tiles.forEach(([label, v, sub, c], ix) => {
    const x = M + ix * (tw + 4);
    fill(SOFT); stroke(LINE); doc.roundedRect(x, y, tw, 24, 2.5, 2.5, "FD");
    fill(c); doc.rect(x, y + 3, 1.4, 18, "F");
    font(8.5, "bold"); color(MUTED); doc.text(t(label).toUpperCase(), x + 4, y + 7);
    font(19, "bold"); color(INK); doc.text(n(v), x + 4, y + 16.5);
    font(8); color(MUTED); doc.text(clip(doc, t(sub), tw - 6), x + 4, y + 21);
  });
  y += 31;

  // ------------------------------------------------------------- briefing --
  section("Briefing", P.label);
  const dataLines = modules.flatMap((m) => (m.empty ? [] : m.notes.slice(0, 2).map((s) => `${m.title}: ${s}`)));
  bullets([...grievanceBriefing(ov, area), ...dataLines]);

  // --------------------------------------------------------------- charts --
  const cw = (W - 2 * M - 6) / 2;
  section("Grievances", `${P.label} · ${area ?? "all areas"}`);
  need(62);
  const trendVals = Array.from({ length: P.buckets }, (_, i) => ov.trend.reduce((s, x) => s + (x.v[i] ?? 0), 0));
  vbars(doc, M, y, cw, "Grievances reported over the period", trendVals, bucketLabels(ov.since, P, ov.period));
  stageMix(doc, M + cw + 6, y, cw, k);
  y += 58;
  const typeRows = ov.byType.slice(0, 7), areaRows = ov.byArea.rows;
  need(hbarsHeight(Math.max(typeRows.length, areaRows.length)) + 4);
  const h1 = hbars(doc, M, y, cw, "Complaints by type", typeRows.map((r) => ({ l: t(r.l), v: r.v })));
  const h2 = hbars(doc, M + cw + 6, y, cw, `Open grievances by ${ov.byArea.level}`, areaRows.map((r) => ({ l: t(r.l), v: r.v })));
  y += Math.max(h1, h2) + 6;

  need(34); // the heading with the table's head and first rows
  const waitingTotal = k.new + k.action;
  section("Waiting for action", `${waitingTotal > waiting.length ? `${n(waiting.length)} of ${n(waitingTotal)}` : n(waitingTotal)} grievances · new first, most severe first`);
  table(doc, y, ["ID", "Grievance", "Location", "Severity", "Stage", "Reported"],
    waiting.map((r) => [t(r.id), t(r.type), t(`${r.loc ?? "-"}, ${r.zone_name ?? "Chennai"}`), t(r.sev), t(r.returned ? "Returned for rework" : STAGE_LABEL[r.stage as Stage] ?? r.stage), when(r.t)]),
    { 0: { cellWidth: 20 }, 1: { cellWidth: 44 }, 3: { cellWidth: 17 }, 4: { cellWidth: 28 }, 5: { cellWidth: 28 } });
  y = (doc as any).lastAutoTable.finalY + 8;

  if (ov.feedback.length) {
    need(34);
    section("Collector feedback", P.label);
    table(doc, y, ["Grievance", "Decision", "Note", "When"],
      ov.feedback.map((f) => [t(f.title ?? f.type), f.ok ? "Verified" : "Returned for rework", t(f.note ?? "-"), when(f.at)]),
      { 0: { cellWidth: 62 }, 1: { cellWidth: 32 }, 3: { cellWidth: 30 } });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // ------------------------------------------------------ department data --
  for (const m of modules) {
    doc.addPage(); y = 18;
    section(m.title, t(`${m.source}`));
    font(9); color(MUTED);
    doc.text(t(`${m.window}${m.area === "district" ? " · district-wide" : area ? ` · ${area}` : ""}${m.stale && m.asOf ? ` · not updated since ${when(m.asOf)}` : ""}`), M, y);
    y += 6;
    if (m.empty) { bullets([m.empty]); continue; }
    const kw = (W - 2 * M - 3 * 4) / 4;
    m.kpis.slice(0, 4).forEach((kp, ix) => {
      const x = M + ix * (kw + 4);
      fill(SOFT); stroke(LINE); doc.roundedRect(x, y, kw, 22, 2.5, 2.5, "FD");
      fill(TONE[kp.tone ?? "info"] ?? BLUE); doc.rect(x, y + 3, 1.4, 16, "F");
      font(8, "bold"); color(MUTED); doc.text(t(kp.label).toUpperCase(), x + 4, y + 6.5);
      font(15, "bold"); color(INK); doc.text(t(kp.value), x + 4, y + 14);
      font(7.5); color(MUTED); doc.text(clip(doc, t(kp.sub ?? ""), kw - 6), x + 4, y + 19);
    });
    y += 28;
    bullets(m.notes);
    const charts = m.charts.filter((c) => c.values.length);
    for (let i = 0; i < charts.length; i += 2) {
      const pair = charts.slice(i, i + 2);
      need(Math.max(...pair.map((c) => (c.kind === "hbar" ? hbarsHeight(Math.min(8, c.values.length)) : 52))) + 4);
      const hs = pair.map((c, j) => {
        const x = M + j * (cw + 6);
        // the unit goes in brackets unless the title already names it ("% of capacity")
        const head = t(c.unit && !c.title.toLowerCase().includes(c.unit.toLowerCase()) ? `${c.title} (${c.unit})` : c.title);
        if (c.kind === "hbar") return hbars(doc, x, y, cw, head, c.labels.slice(0, 8).map((l, q) => ({ l: t(l), v: c.values[q] })));
        if (c.kind === "line") { line(doc, x, y, cw, head, c.values, c.labels.map(t)); return 52; }
        vbars(doc, x, y, cw, head, c.values, c.labels.map(t)); return 52;
      });
      y += Math.max(...hs) + 6;
    }
    for (const tb of m.tables.filter((x) => x.rows.length)) {
      need(30);
      font(10, "bold"); color(INK); doc.text(t(tb.title), M, y); y += 2;
      table(doc, y, tb.columns.map(t), tb.rows.slice(0, 14).map((r) => r.map((v) => t(v))));
      y = (doc as any).lastAutoTable.finalY + 8;
    }
  }

  // ------------------------------------------------------------- footer --
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    stroke(LINE); doc.line(M, H - 11, W - M, H - 11);
    font(8); color(MUTED);
    doc.text(t(`District IQ · ${ov.dept.name} · Confidential: for official use`), M, H - 6.5);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 6.5, { align: "right" });
  }
  doc.save(file);
}

// ------------------------------------------------------------------ charts --

function hbars(doc: jsPDF, x: number, y: number, w: number, head: string, rows: { l: string; v: number }[]): number {
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text(head, x, y + 3);
  const mx = Math.max(1, ...rows.map((r) => r.v));
  const lw = w * 0.42, bw = w - lw - 14;
  rows.forEach((r, i) => {
    const yy = y + 8 + i * 7.2;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    doc.text(clip(doc, r.l, lw - 2), x, yy + 3.2);
    doc.setFillColor(...SOFT); doc.roundedRect(x + lw, yy, bw, 4.4, 1.2, 1.2, "F");
    doc.setFillColor(...BLUES[Math.min(i, BLUES.length - 1)]);
    doc.roundedRect(x + lw, yy, Math.max(1.5, (r.v / mx) * bw), 4.4, 1.2, 1.2, "F");
    doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
    doc.text(n(r.v), x + w, yy + 3.3, { align: "right" });
  });
  if (!rows.length) { doc.setFontSize(9); doc.setTextColor(...MUTED); doc.text("Nothing in this period.", x, y + 10); }
  return hbarsHeight(rows.length);
}
const hbarsHeight = (rows: number) => 8 + Math.max(1, rows) * 7.2;

function vbars(doc: jsPDF, x: number, y: number, w: number, head: string, vals: number[], labels: string[]) {
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text(head, x, y + 3);
  const top = y + 8, h = 36, mx = Math.max(1, ...vals);
  doc.setDrawColor(...LINE); doc.setLineWidth(0.2);
  for (let g = 0; g <= 2; g++) doc.line(x, top + (h * g) / 2, x + w, top + (h * g) / 2);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.text(n(mx), x, top - 1);
  const bw = w / Math.max(1, vals.length);
  vals.forEach((v, i) => {
    const bh = (v / mx) * h;
    doc.setFillColor(...(i === vals.length - 1 ? NAVY : BLUES[2]));
    doc.rect(x + i * bw + bw * 0.15, top + h - bh, bw * 0.7, Math.max(bh, 0.3), "F");
  });
  if (labels.length) {
    doc.text(labels[0], x, top + h + 4);
    doc.text(labels[labels.length - 1], x + w, top + h + 4, { align: "right" });
  }
}

function line(doc: jsPDF, x: number, y: number, w: number, head: string, vals: number[], labels: string[]) {
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text(head, x, y + 3);
  const top = y + 8, h = 36;
  const mx = Math.max(...vals), mn = Math.min(...vals), rg = mx - mn || 1;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.2);
  for (let g = 0; g <= 2; g++) doc.line(x, top + (h * g) / 2, x + w, top + (h * g) / 2);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text(`${Math.round(mx * 10) / 10}`, x, top - 1);
  doc.text(`${Math.round(mn * 10) / 10}`, x, top + h + 4);
  if (vals.length > 1) {
    doc.setDrawColor(...BLUE); doc.setLineWidth(0.7);
    for (let i = 1; i < vals.length; i++) {
      doc.line(x + ((i - 1) / (vals.length - 1)) * w, top + h - ((vals[i - 1] - mn) / rg) * h, x + (i / (vals.length - 1)) * w, top + h - ((vals[i] - mn) / rg) * h);
    }
    doc.setLineWidth(0.2);
  }
  if (labels.length) {
    doc.text(labels[0], x + 12, top + h + 4);
    doc.text(labels[labels.length - 1], x + w, top + h + 4, { align: "right" });
  }
}

function stageMix(doc: jsPDF, x: number, y: number, w: number, k: OfficerOverview["counts"]) {
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text("Grievances by stage", x, y + 3);
  const parts: [string, number, RGB][] = [["New", k.new, SEV.Severe], ["In action", k.action, SEV.High], ["Sent to Collector", k.sent, [106, 85, 216]], ["Verified", k.verified, SEV.Low]];
  const tot = Math.max(1, parts.reduce((s, p) => s + p[1], 0));
  let xx = x;
  for (const [, v, c] of parts) {
    const ww = (v / tot) * w;
    if (ww <= 0) continue;
    doc.setFillColor(...c); doc.rect(xx, y + 8, ww, 7, "F");
    xx += ww;
  }
  parts.forEach(([l, v, c], i) => {
    const yy = y + 22 + i * 7.5;
    doc.setFillColor(...c); doc.roundedRect(x, yy - 3, 3.5, 3.5, 0.8, 0.8, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...INK); doc.text(l, x + 6, yy);
    doc.setFont("helvetica", "bold"); doc.text(n(v), x + w * 0.62, yy, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setTextColor(...MUTED); doc.text(`${Math.round((v / tot) * 100)}%`, x + w, yy, { align: "right" });
  });
}

function table(doc: jsPDF, y: number, head: string[], body: string[][], columnStyles: Record<number, Row> = {}) {
  autoTable(doc, {
    startY: y,
    head: [head],
    body: body.length ? body : [[{ content: "Nothing to list for this period and area.", colSpan: head.length, styles: { textColor: MUTED } }]],
    margin: { left: M, right: M, top: 16, bottom: 16 },
    theme: "grid",
    rowPageBreak: "avoid",
    styles: { font: "helvetica", fontSize: 8.3, cellPadding: 1.8, textColor: INK, lineColor: LINE, lineWidth: 0.15, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
    alternateRowStyles: { fillColor: [248, 250, 254] },
    columnStyles
  });
}
