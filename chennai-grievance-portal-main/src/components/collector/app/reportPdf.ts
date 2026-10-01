/**
 * The Collector's PDF report, drawn in the browser with jsPDF from /api/collector/report.
 * Charts are drawn as vector shapes, so the file stays small and prints sharply.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

type Row = Record<string, any>;
type RGB = [number, number, number];

const NAVY: RGB = [11, 61, 145];
const INK: RGB = [12, 27, 51];
const MUTED: RGB = [90, 106, 135];
const LINE: RGB = [223, 230, 242];
const SOFT: RGB = [244, 247, 253];
const SEV: Record<string, RGB> = { Severe: [217, 45, 53], High: [224, 115, 13], Medium: [185, 138, 0], Low: [18, 146, 95] };
const BLUES: RGB[] = [[21, 96, 232], [59, 124, 240], [102, 153, 245], [143, 181, 248], [183, 207, 250], [205, 221, 251], [220, 231, 252]];
const W = 210, H = 297, M = 14;

/** Standard PDF fonts cover Latin only: normalise punctuation and drop other scripts. */
function t(s: unknown): string {
  return String(s ?? "")
    .replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/×/g, "x")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "").replace(/\s+/g, " ").trim();
}
/** Headlines in Tamil cannot be drawn with the standard fonts: describe them in English instead. */
const title = (i: Row) => {
  const raw = String(i.title ?? "");
  const other = (raw.match(/[^\x00-\xFF–—‘’“”…]/g) ?? []).length;
  if (other > 4) return t(`${i.type} - ${i.loc ?? i.zone_name ?? "Chennai"} (Tamil news report)`);
  const s = t(raw);
  return s.length >= 8 ? s : t(`${i.type} - ${i.loc ?? i.zone_name ?? "Chennai"}`);
};
const n = (v: number) => Math.round(v).toLocaleString("en-IN");
const ms = (s: string) => new Date(s.replace(" ", "T") + "+05:30").getTime();
const fmt = (s: string) =>
  new Date(ms(s)).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
const sourcesText = (i: Row) => {
  const s = i.src ?? {};
  const out: string[] = [];
  if (s.grievance) out.push(`${s.grievance} complaint${s.grievance > 1 ? "s" : ""}`);
  if (s.police) out.push(`${s.police} police`);
  if (s.pwd) out.push(`${s.pwd} PWD`);
  if (s.hospital) out.push(`${s.hospital} hospital`);
  if (s.news) out.push(`${(s.outlets?.length || 1)} news outlet${(s.outlets?.length || 1) > 1 ? "s" : ""}`);
  if (s.imd) out.push("IMD");
  return out.join(", ") || t(String(i.sources ?? "").replace(/\|/g, ", "));
};
const reasons = (i: Row) => t([...(i.why?.what ?? []).slice(0, 2), ...(i.why?.why ?? []).slice(0, 3)].join("; "));

export async function buildReport(d: Row, opt: { scope: string; dept: string | null; file: string }) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  let y = 0;

  const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const font = (size: number, style: "normal" | "bold" = "normal") => { doc.setFont("helvetica", style); doc.setFontSize(size); };
  const need = (h: number) => { if (y + h > H - 16) { doc.addPage(); y = 18; } };
  const section = (text: string, sub?: string) => {
    need(16);
    fill(NAVY);
    doc.rect(M, y, 3, 7, "F");
    font(13, "bold"); color(INK);
    doc.text(t(text), M + 6, y + 5.6);
    if (sub) { font(9); color(MUTED); doc.text(t(sub), W - M, y + 5.6, { align: "right" }); }
    y += 11;
  };
  const arrow = (x: number, yy: number, up: boolean, c: RGB) => {
    fill(c);
    if (up) doc.triangle(x, yy + 2.6, x + 3, yy + 2.6, x + 1.5, yy, "F");
    else doc.triangle(x, yy, x + 3, yy, x + 1.5, yy + 2.6, "F");
  };

  // ---------------------------------------------------------------- cover --
  const P = d.periodInfo;
  fill(NAVY); doc.rect(0, 0, W, 38, "F");
  fill([31, 107, 234]); doc.rect(0, 36, W, 2, "F");
  color([255, 255, 255]);
  font(10, "bold"); doc.text("DISTRICT IQ  |  Chennai Intelligent District Governance Platform", M, 11);
  font(20, "bold"); doc.text(t(`Collector's ${P.word ?? "Daily"} Report`), M, 22);
  font(10); color([205, 222, 255]);
  doc.text(t(`${P.label} · ${opt.scope}${opt.dept ? ` · ${opt.dept}` : ""}`), M, 30);
  doc.text(t(`Data as of ${fmt(d.now)}  ·  Generated ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} IST`), W - M, 30, { align: "right" });
  y = 46;

  // KPI tiles
  const k = d.kpi;
  const tiles: [string, string, boolean, RGB][] = [
    ["Severe events", "severe", true, SEV.Severe], ["Open complaints", "complaints", true, [224, 115, 13]],
    ["Ongoing incidents", "ongoing", true, NAVY], [`Resolved this ${String(P.unit).toLowerCase()}`, "resolved", false, SEV.Low]
  ];
  const tw = (W - 2 * M - 3 * 4) / 4;
  tiles.forEach(([label, key, goodDown, c], ix) => {
    const x = M + ix * (tw + 4);
    fill(SOFT); stroke(LINE); doc.roundedRect(x, y, tw, 26, 2.5, 2.5, "FD");
    fill(c); doc.rect(x, y + 3, 1.4, 20, "F");
    font(8.5, "bold"); color(MUTED); doc.text(t(label).toUpperCase(), x + 4, y + 7);
    font(20, "bold"); color(key === "severe" ? SEV.Severe : INK); doc.text(n(k.cur[key]), x + 4, y + 17);
    const diff = k.cur[key] - k.prev[key];
    const good = diff === 0 ? null : goodDown ? diff < 0 : diff > 0;
    const dc: RGB = good == null ? MUTED : good ? SEV.Low : SEV.Severe;
    if (diff) arrow(x + 4, y + 19.8, diff > 0, dc);
    font(8); color(dc);
    doc.text(t(`${diff ? (diff > 0 ? "+" : "-") + n(Math.abs(diff)) : "no change"} vs. ${P.prev}`), x + (diff ? 8.5 : 4), y + 22.3);
  });
  y += 33;

  // Key points: a few plain sentences, no lists of everything
  section("Key points");
  const zoneTop = [...d.zoneTable].sort((a: Row, b: Row) => b.open - a.open)[0];
  const deptTop = d.bottom.byDept[0];
  const sevOpen = d.severity.counts;
  const R = d.report;
  const points = [
    `${n(k.cur.ongoing)} incidents are open (${k.cur.ongoing - k.prev.ongoing >= 0 ? "up" : "down"} ${n(Math.abs(k.cur.ongoing - k.prev.ongoing))} vs. ${P.prev}); ${n(sevOpen.Severe)} severe and ${n(sevOpen.High)} high.`,
    `${n(R.attentionTotal ?? R.attention.length)} need your attention${(R.attentionTotal ?? 0) > R.attention.length ? ` (the ${n(R.attention.length)} most urgent are listed below; all are in the action list CSV)` : " (listed below)"}. The other ${n(R.routine)} are routine and the departments are handling them.`,
    `${n(d.tasks.count)} closed pieces of work are waiting for your check; ${n(d.tasks.leftToDepts)} routine closures are left to department heads.`,
    zoneTop && zoneTop.open ? `${zoneTop.name} zone has the most open incidents (${n(zoneTop.open)}).` : null,
    deptTop && !opt.dept ? `${deptTop.l} has the most citizen complaints (${n(deptTop.v)}).` : null,
    R.newsOnly.length ? `${n(d.snapshot.newsOnly ?? R.newsOnly.length)} open incidents are in the news with no department record.` : null,
    envSummary(d)
  ].filter(Boolean) as string[];
  font(10); color(INK);
  for (const s of points) {
    const lines = doc.splitTextToSize(t(s), W - 2 * M - 7);
    need(lines.length * 4.6 + 1.5);
    fill(NAVY); doc.circle(M + 1.6, y - 1.2, 0.9, "F");
    doc.text(lines, M + 5, y);
    y += lines.length * 4.6 + 1.5;
  }
  y += 3;

  // Needs your attention: only the incidents that meet the attention rules, with plain reasons
  section("Needs your attention", R.attention.length ? ((R.attentionTotal ?? 0) > R.attention.length ? `${n(R.attention.length)} most urgent of ${n(R.attentionTotal)}` : `${n(R.attention.length)} incidents, most urgent first`) : "nothing right now");
  if (R.attention.length) {
    table(doc, y, ["#", "Incident", "What happened", "Why it needs you"],
      // t() flattens whitespace, so each line is cleaned on its own and the lines are joined afterwards
      (R.attention as Row[]).map((i, k2) => [String(k2 + 1), `${title(i)}\n${t(`${i.zone_name ?? "Chennai"} / ${i.dept_name ?? i.dept} / ${i.sev}`)}`,
        [t(i.why.summary), ...(i.why.facts ?? []).map(t)].join("\n"), (i.why.attention as string[]).map((w) => `- ${t(w)}`).join("\n")]),
      { 0: { cellWidth: 7, halign: "center" }, 1: { cellWidth: 55 }, 2: { cellWidth: 62 } });
    y = (doc as any).lastAutoTable.finalY + 8;
  } else {
    font(10); color(MUTED); doc.text("No open incident needs you in this scope. The departments are handling everything.", M, y); y += 8;
  }

  // Work waiting for the Collector's check (already filtered by the task criteria)
  if (d.tasks.rows.length) {
    need(30);
    const shown = d.tasks.rows.slice(0, 8);
    section("Work waiting for your check", d.tasks.count > shown.length ? `${n(shown.length)} most important of ${n(d.tasks.count)}; the rest are on the dashboard` : `${n(d.tasks.count)} closures`);
    table(doc, y, ["Work", "Officer's report", "Why it is with you"],
      shown.map((i: Row) => [`${title(i)}\n${t(i.dept_name ?? i.dept)}`, t(`${i.officer ?? "Officer"}: ${i.action?.note || i.action?.step || "reported the work as done"}`),
        (i.because ?? []).map(t).join("\n")]),
      { 0: { cellWidth: 70 }, 1: { cellWidth: 70 } });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Where the workload is
  need(70);
  section("Where the workload is", P.label);
  const cw = (W - 2 * M - 6) / 2;
  const deptRows = d.bottom.byDept.slice(0, 6).map((r: Row) => ({ l: t(r.l), v: r.v }));
  const zoneRows = [...d.zoneTable].sort((a: Row, b: Row) => b.open - a.open).slice(0, 6).map((z: Row) => ({ l: t(z.name), v: z.open }));
  const h1 = hbars(doc, M, y, cw, opt.dept ? "Incidents by category" : "Complaints by department", deptRows);
  const h2 = hbars(doc, M + cw + 6, y, cw, "Open incidents by zone", zoneRows);
  y += Math.max(h1, h2) + 6;

  // In the news, no department record
  if (R.newsOnly.length) {
    need(30);
    section("In the news, no department record", `top ${n(R.newsOnly.length)}`);
    table(doc, y, ["Report", "Where", "Department it belongs to", "Reported"],
      (R.newsOnly as Row[]).map((i) => [title(i), t(i.zone_name ?? "Chennai"), t(i.dept_name ?? i.dept), fmt(i.t)]),
      { 0: { cellWidth: 80 } });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Environment
  if (y + 70 > H - 16) { doc.addPage(); y = 18; }
  section("Environment", "latest reading and change vs. the previous one");
  env(doc, y, d);
  y += 62;

  // ------------------------------------------------------------- footer --
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    stroke(LINE); doc.line(M, H - 11, W - M, H - 11);
    font(8); color(MUTED);
    doc.text("District IQ · Chennai Intelligent District Governance Platform · Confidential: for official use", M, H - 6.5);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 6.5, { align: "right" });
  }
  doc.save(opt.file);
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
    const label = doc.splitTextToSize(r.l, lw - 2)[0];
    doc.text(label, x, yy + 3.2);
    doc.setFillColor(...SOFT); doc.roundedRect(x + lw, yy, bw, 4.4, 1.2, 1.2, "F");
    doc.setFillColor(...BLUES[Math.min(i, BLUES.length - 1)]);
    doc.roundedRect(x + lw, yy, Math.max(1.5, (r.v / mx) * bw), 4.4, 1.2, 1.2, "F");
    doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
    doc.text(n(r.v), x + w, yy + 3.3, { align: "right" });
  });
  if (!rows.length) { doc.setFontSize(9); doc.setTextColor(...MUTED); doc.text("Nothing reported in this period.", x, y + 10); }
  return 8 + Math.max(1, rows.length) * 7.2;
}

function sevBar(doc: jsPDF, x: number, y: number, w: number, mix: Row[]) {
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text("Incidents by severity", x, y + 3);
  const tot = Math.max(1, mix.reduce((s, r) => s + r.n, 0));
  let xx = x;
  for (const r of mix) {
    const ww = (r.n / tot) * w;
    if (ww <= 0) continue;
    doc.setFillColor(...SEV[r.sev]); doc.rect(xx, y + 7, ww, 7, "F");
    xx += ww;
  }
  mix.forEach((r, i) => {
    const yy = y + 21 + i * 7.5;
    doc.setFillColor(...SEV[r.sev]); doc.roundedRect(x, yy - 3, 3.5, 3.5, 0.8, 0.8, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text(r.sev, x + 6, yy);
    doc.setFont("helvetica", "bold"); doc.text(n(r.n), x + w * 0.55, yy, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setTextColor(...MUTED);
    doc.text(`${n(r.open)} open · ${Math.round((r.n / tot) * 100)}%`, x + w, yy, { align: "right" });
  });
}

function trend(doc: jsPDF, x: number, y: number, w: number, head: string, lines: { l: string; v: number[]; c: RGB }[]) {
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text(head, x, y + 3);
  const top = y + 8, h = 34;
  const all = lines.flatMap((l) => l.v);
  const mx = Math.max(1, ...all);
  doc.setDrawColor(...LINE); doc.setLineWidth(0.2);
  for (let g = 0; g <= 2; g++) doc.line(x, top + (h * g) / 2, x + w, top + (h * g) / 2);
  doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal");
  doc.text(n(mx), x, top - 1);
  for (const l of lines) {
    if (l.v.length < 2) continue;
    doc.setDrawColor(...l.c); doc.setLineWidth(0.7);
    for (let i = 1; i < l.v.length; i++) {
      const x0 = x + ((i - 1) / (l.v.length - 1)) * w, x1 = x + (i / (l.v.length - 1)) * w;
      doc.line(x0, top + h - (l.v[i - 1] / mx) * h, x1, top + h - (l.v[i] / mx) * h);
    }
  }
  doc.setLineWidth(0.2);
  doc.text("Start of period", x, top + h + 4);
  doc.text("Now", x + w, top + h + 4, { align: "right" });
  lines.forEach((l, i) => {
    const lx = x + i * (w / 3);
    doc.setFillColor(...l.c); doc.rect(lx, top + h + 7, 5, 1.6, "F");
    doc.setTextColor(...INK); doc.text(l.l, lx + 7, top + h + 8.6);
  });
}

// ------------------------------------------------------------- environment --

function avgSeries(stations: Row[], key: (t: string) => string = (x) => x) {
  const by = new Map<string, number[]>();
  for (const s of stations) s.times.forEach((tm: string, i: number) => { const kk = key(tm); (by.get(kk) ?? by.set(kk, []).get(kk)!).push(s.series[i]); });
  const times = [...by.keys()].sort();
  const series = times.map((tm) => { const v = by.get(tm)!; return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10; });
  return { times, series, now: series[series.length - 1] ?? null, prev: series.length > 1 ? series[series.length - 2] : null };
}
const aqiBand = (a: number) => (a <= 50 ? "Good" : a <= 100 ? "Satisfactory" : a <= 200 ? "Moderate" : a <= 300 ? "Poor" : a <= 400 ? "Very poor" : "Severe");
const rainBand = (v: number) => (v < 0.1 ? "No rain" : v < 15.6 ? "Light" : v < 64.5 ? "Moderate" : v < 115.6 ? "Heavy" : "Very heavy");
const lakeBand = (p: number) => (p < 30 ? "Low" : p < 70 ? "Normal" : "High");

function envSummary(d: Row): string | null {
  const b = d.bottom;
  const r = avgSeries(b.rain.stations, (x) => x.slice(0, 10)), a = avgSeries(b.aqi.stations), l = avgSeries(b.lakes.stations);
  const parts = [
    r.now != null ? `rainfall ${r.now} mm in 24 h (${rainBand(r.now).toLowerCase()})` : null,
    a.now != null ? `air quality ${Math.round(a.now)} AQI (${aqiBand(a.now).toLowerCase()})` : null,
    l.now != null ? `reservoirs ${l.now}% full` : null
  ].filter(Boolean);
  return parts.length ? `Across the district: ${parts.join(", ")}.` : null;
}

function env(doc: jsPDF, y: number, d: Row) {
  const b = d.bottom;
  const cards = [
    { h: "Rainfall", u: "mm / 24 h", s: avgSeries(b.rain.stations, (x) => x.slice(0, 10)), band: rainBand, upBad: true, c: [21, 96, 232] as RGB, dec: 1 },
    { h: "Air quality", u: "AQI", s: avgSeries(b.aqi.stations), band: aqiBand, upBad: true, c: [18, 146, 95] as RGB, dec: 0 },
    { h: "Reservoir storage", u: "% full", s: avgSeries(b.lakes.stations), band: lakeBand, upBad: false, c: [8, 145, 178] as RGB, dec: 1 }
  ];
  const w = (W - 2 * M - 8) / 3;
  cards.forEach((c, i) => {
    const x = M + i * (w + 4);
    doc.setFillColor(...SOFT); doc.setDrawColor(...LINE); doc.roundedRect(x, y, w, 56, 2.5, 2.5, "FD");
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK); doc.text(c.h, x + 4, y + 7);
    if (c.s.now == null) { doc.setFont("helvetica", "normal"); doc.setTextColor(...MUTED); doc.text("No readings", x + 4, y + 18); return; }
    doc.setFontSize(20); doc.text(c.s.now.toFixed(c.dec), x + 4, y + 18);
    const vw = doc.getTextWidth(c.s.now.toFixed(c.dec));
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED); doc.text(c.u, x + 6 + vw, y + 18);
    doc.setFont("helvetica", "bold"); doc.setTextColor(...c.c); doc.text(c.band(c.s.now).toUpperCase(), x + 4, y + 24);
    if (c.s.prev != null) {
      const diff = Math.round((c.s.now - c.s.prev) * 10) / 10;
      const bad = diff === 0 ? null : (diff > 0) === c.upBad;
      const col: RGB = bad == null ? MUTED : bad ? SEV.Severe : SEV.Low;
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...col);
      doc.text(diff ? `${diff > 0 ? "up" : "down"} ${Math.abs(diff).toFixed(c.dec)} vs. previous reading` : "steady vs. previous reading", x + 4, y + 28.5);
    }
    const v = c.s.series.slice(-24);
    if (v.length > 1) {
      const top = y + 32, h = 19, mx = Math.max(...v), mn = Math.min(...v, c.h === "Rainfall" ? 0 : Infinity), rg = mx - mn || 1;
      doc.setDrawColor(...c.c); doc.setLineWidth(0.6);
      for (let k = 1; k < v.length; k++) {
        doc.line(x + 4 + ((k - 1) / (v.length - 1)) * (w - 8), top + h - ((v[k - 1] - mn) / rg) * h,
          x + 4 + (k / (v.length - 1)) * (w - 8), top + h - ((v[k] - mn) / rg) * h);
      }
      doc.setLineWidth(0.2);
    }
  });
}

function table(doc: jsPDF, y: number, head: string[], body: string[][], columnStyles: Record<number, Row> = {}, accent: RGB = NAVY) {
  autoTable(doc, {
    startY: y,
    head: [head],
    body: body.length ? body : [[`Nothing to list.`, ...head.slice(1).map(() => "")]],
    margin: { left: M, right: M, top: 16, bottom: 16 },
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8.3, cellPadding: 1.8, textColor: INK, lineColor: LINE, lineWidth: 0.15, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: accent, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
    alternateRowStyles: { fillColor: [248, 250, 254] },
    columnStyles
  });
}
