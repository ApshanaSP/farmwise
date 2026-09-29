/* Shared helpers for the Collector console: time formatting, chips, tones and charts. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { I, type IconName } from "./icons";

export type Row = Record<string, any>;

// ---------------------------------------------------------------- time --

/** Stored times are IST wall-clock strings ("2026-09-27 01:50:00"). */
export function ms(s: string | null | undefined): number {
  if (!s) return NaN;
  return new Date(s.replace(" ", "T") + (s.length > 10 ? "+05:30" : "T00:00:00+05:30")).getTime();
}
const IST = { timeZone: "Asia/Kolkata" } as const;
export const fmtTime = (s: string | number) =>
  new Date(typeof s === "number" ? s : ms(s)).toLocaleTimeString("en-US", { ...IST, hour: "2-digit", minute: "2-digit", hour12: true });
export const fmtDate = (s: string | number) =>
  new Date(typeof s === "number" ? s : ms(s)).toLocaleDateString("en-GB", { ...IST, day: "numeric", month: "short" });
export const fmtDay = (s: string | number) =>
  new Date(typeof s === "number" ? s : ms(s)).toLocaleDateString("en-GB", { ...IST, weekday: "long", day: "numeric", month: "long" });
export const fmtShort = (s: string | number) => `${fmtDate(s)}, ${fmtTime(s)}`;

/** Relative to the data's "now" (the pipeline as-of time), so it matches the windows. */
export function rel(s: string, now: string): string {
  const m = (ms(now) - ms(s)) / 6e4;
  if (!Number.isFinite(m)) return "—";
  if (m < 1) return "just now";
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "1 hr ago" : `${h} hrs ago`;
  const d = Math.round(m / 1440);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}
export const pad2 = (n: number) => String(n).padStart(2, "0");
export const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);
export const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

// ------------------------------------------------------ severity, status --

export const SEVS = ["Severe", "High", "Medium", "Low"] as const;
export const SEV_HEX: Record<string, string> = { Severe: "#D92D35", High: "#E0730D", Medium: "#B98A00", Low: "#12925F" };
export const CAT_COL: Record<string, string> = { severe: "#E5484D", complaint: "#FFA114", other: "#4D8DFF" };
export const sevTone = (s: string) => ({ Severe: "t-sev", High: "t-high", Medium: "t-med", Low: "t-low" })[s] ?? "t-info";

export function SevChip({ s }: { s: string }) {
  return (
    <span className={`chip sev-${String(s || "low").toLowerCase()}`}>
      <I n={s === "Low" ? "check" : "alert"} />
      {s}
    </span>
  );
}

const ST_CLS: Record<string, string> = {
  Open: "st-open",
  "Under review": "st-review",
  "Awaiting verification": "st-review",
  Assigned: "st-assigned",
  "In progress": "st-progress",
  Resolved: "st-resolved",
  Rejected: "st-resolved",
  Lapsed: "st-resolved"
};
export function StChip({ s }: { s: string }) {
  return <span className={`st ${ST_CLS[s] ?? "st-open"}`}>{s}</span>;
}

/** Department icon by the family of incidents it handles. */
export function deptIcon(code: string | null | undefined): IconName {
  const c = String(code ?? "");
  if (c.startsWith("POL")) return "shield";
  if (c === "GCC-SWM") return "trash";
  if (c === "GCC-SWD" || c === "PWD-WRD" || c === "CMWSSB") return "drop";
  if (c === "GCC-ELE" || c === "TANGEDCO") return "bulb";
  if (c.includes("HLT") || c === "GCC-FWD") return "health";
  if (c.includes("REV") || c === "GCC-LND" || c === "DIST-DM") return "scroll";
  if (c === "GCC-PRK") return "leaf";
  if (c === "GCC-ENG" || c === "GCC-BRG") return "cone";
  return "gov";
}
export const shortDept = (code: string | null | undefined) => String(code ?? "").replace(/^(GCC|PWD|POL|HLT|DIST)-/, "");

export const SOURCE_KIND: Record<string, { k: string; ic: IconName; tone: string }> = {
  grievance: { k: "Citizen complaint", ic: "app", tone: "t-info" },
  police: { k: "Police report", ic: "shield", tone: "t-violet" },
  pwd: { k: "PWD field record", ic: "doc", tone: "t-low" },
  hospital: { k: "Hospital report", ic: "health", tone: "t-sev" },
  news: { k: "News report", ic: "news", tone: "t-high" },
  imd: { k: "IMD warning", ic: "cloud", tone: "t-med" },
  collector: { k: "Collector", ic: "gov", tone: "t-info" }
};
export const isNews = (i: Row) => Number(i.outlets) > 0 || String(i.sources ?? "").split("|").includes("news");

/** "Waterlogging – Ward 15" style title, avoiding repetition. */
export const fullTitle = (i: Row) => i.title || `${i.type} – ${i.loc ?? i.zone_name ?? ""}`;

// ------------------------------------------------------------ sources --

const SRC_ORDER = ["grievance", "police", "pwd", "hospital", "news", "imd"] as const;

/** Reports merged into an incident, by source; the same counts wherever the incident appears. */
export function sourceItems(i: Row): { k: string; ic: IconName; n: number; label: string; title: string }[] {
  const s = i.src as Row | undefined;
  const has = (k: string) => String(i.sources ?? "").split("|").includes(k);
  const out: { k: string; ic: IconName; n: number; label: string; title: string }[] = [];
  for (const k of SRC_ORDER) {
    const n = s ? Number(s[k] ?? 0) : has(k) ? 1 : 0;
    if (!n) continue;
    const ic = SOURCE_KIND[k].ic;
    if (k === "grievance") out.push({ k, ic, n, label: n === 1 ? "Complaint" : "Complaints", title: plural(n, "citizen complaint") });
    else if (k === "news") {
      const outs: string[] = s?.outlets ?? [];
      const o = outs.length || 1;
      out.push({ k, ic, n: o, label: o === 1 ? "Outlet" : "Outlets", title: outs.length ? `News: ${outs.join(", ")}` : plural(n, "news report") });
    } else if (k === "police") out.push({ k, ic, n, label: "Police", title: plural(n, "police report") });
    else if (k === "pwd") out.push({ k, ic, n, label: "PWD", title: plural(n, "PWD field record") });
    else if (k === "hospital") out.push({ k, ic, n, label: "Hospital", title: plural(n, "hospital report") });
    else out.push({ k, ic, n, label: "IMD", title: plural(n, "IMD warning") });
  }
  return out;
}

export function Sources({ i }: { i: Row }) {
  return (
    <span className="srcs">
      {sourceItems(i).map((x) => (
        <span key={x.k} className={`sc sc-${x.k}`} title={x.title}>
          <I n={x.ic} /><b>{x.n}</b>{x.label}
        </span>
      ))}
    </span>
  );
}

// ------------------------------------------------------------------ UI --

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <I n="checkc" />
      {children}
    </div>
  );
}

/** Count-up number (respects reduced motion). */
export function Cnt({ v, dec = 0 }: { v: number; dec?: number }) {
  const [shown, setShown] = useState(v);
  const from = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    from.current = v;
    if (reduce || start === v) {
      setShown(v);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      const e = 1 - Math.pow(1 - p, 3);
      setShown(start + (v - start) * e);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [v]);
  return <>{dec ? shown.toFixed(dec) : Math.round(shown).toLocaleString("en-IN")}</>;
}

/** Element size, for charts drawn at their real pixel size (text stays crisp and readable). */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// -------------------------------------------------------------- charts --

let gid = 0;
const uid = (p: string) => `${p}${++gid}`;

export function Spark({ vals }: { vals: number[] }) {
  const W = 74, H = 38, n = vals.length;
  const id = useRef(uid("s")).current;
  if (n < 2) return null;
  const mx = Math.max(...vals, 1), mn = Math.min(...vals, 0);
  const x = (i: number) => 2 + (i * (W - 6)) / (n - 1);
  const y = (v: number) => 4 + (1 - (v - mn) / (mx - mn || 1)) * (H - 8);
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="spk" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#1560E8" stopOpacity=".25" />
          <stop offset="1" stopColor="#1560E8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${x(n - 1)} ${H} L${x(0)} ${H}Z`} fill={`url(#${id})`} />
      <path className="ln-d" d={d} fill="none" stroke="#1560E8" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(vals[n - 1])} r="3" fill="#1560E8" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

function ticks(n: number, room: number) {
  const k = Math.max(2, Math.min(n, Math.floor(room / 78)));
  if (n <= k) return [...Array(n).keys()];
  return [...new Set(Array.from({ length: k }, (_, i) => Math.round((i * (n - 1)) / (k - 1))))];
}

/** Bar or line chart drawn at the container's pixel size, with value labels on hover and the last value marked. */
export function Chart({ kind, vals, labels, color = "#1560E8", fmt, band }: {
  kind: "bar" | "line"; vals: number[]; labels: string[]; color?: string; fmt: (v: number) => string;
  /** optional shaded threshold, e.g. the AQI "satisfactory" ceiling */
  band?: { at: number; label: string };
}) {
  const [ref, { w: W, h: H0 }] = useSize<HTMLDivElement>();
  const id = useRef(uid("c")).current;
  const n = vals.length;
  const H = Math.max(40, H0 - 18), L = 36, R = 8, T = 8;
  const body = () => {
    if (!n || W < 60) return null;
    const mx = Math.max(...vals, band?.at ?? 0, kind === "bar" ? 0.1 : -Infinity);
    const mn = kind === "bar" ? 0 : Math.min(...vals, band?.at ?? Infinity);
    const pad = kind === "line" ? (mx - mn || 1) * 0.12 : 0;
    const top = mx + pad, bot = Math.max(kind === "line" ? -Infinity : 0, mn - pad);
    const y = (v: number) => T + (1 - (v - bot) / (top - bot || 1)) * (H - T);
    const iw = W - L - R;
    const x = (i: number) => (kind === "bar" ? L + (i + 0.5) * (iw / n) : n === 1 ? L + iw / 2 : L + (i * iw) / (n - 1));
    const grid = [0, 0.5, 1].map((f) => bot + (top - bot) * f);
    return (
      <svg width={W} height={H + 18} className="mini" role="img" aria-label="Chart">
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((g, k) => (
          <g key={k}>
            <line className="grid" x1={L} x2={W - R} y1={y(g)} y2={y(g)} />
            <text className="tick" x={L - 6} y={y(g) + 4} textAnchor="end">{top - bot < 6 ? g.toFixed(1) : Math.round(g)}</text>
          </g>
        ))}
        {band && band.at > bot && band.at < top && (
          <g>
            <line x1={L} x2={W - R} y1={y(band.at)} y2={y(band.at)} stroke="#E0730D" strokeDasharray="5 4" strokeWidth="1.3" />
            <text x={W - R} y={y(band.at) - 4} textAnchor="end" style={{ font: "600 11px var(--dic-sans)", fill: "#E0730D" }}>{band.label}</text>
          </g>
        )}
        {kind === "bar"
          ? vals.map((v, i) => {
              const bw = Math.min(34, (iw / n) * 0.66);
              const h = Math.max(2, H - y(v));
              return (
                <rect key={i} x={x(i) - bw / 2} y={H - h} width={bw} height={h} rx="3" fill={i === n - 1 ? color : `url(#${id})`}
                  stroke={color} strokeOpacity={i === n - 1 ? 0 : 0.5}>
                  <title>{`${labels[i]}: ${fmt(v)}`}</title>
                </rect>
              );
            })
          : (() => {
              const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
              return (
                <>
                  <path d={`${d} L${x(n - 1)} ${H} L${x(0)} ${H}Z`} fill={`url(#${id})`} />
                  <path className="ln-d" d={d} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
                  {vals.map((v, i) => (
                    <circle key={i} cx={x(i)} cy={y(v)} r={i === n - 1 ? 5 : n <= 31 ? 2.4 : 0} fill={i === n - 1 ? color : "#fff"} stroke={color} strokeWidth="1.6">
                      <title>{`${labels[i]}: ${fmt(v)}`}</title>
                    </circle>
                  ))}
                </>
              );
            })()}
        <line className="axis" x1={L} x2={W - R} y1={H} y2={H} />
        {ticks(n, iw).map((i) => {
          const edge = x(i) - L < 26 ? "start" : W - R - x(i) < 26 ? "end" : "middle";
          return <text key={i} className="tick" x={edge === "start" ? Math.max(L - 4, x(i) - 6) : edge === "end" ? W - R : x(i)} y={H + 14} textAnchor={edge}>{labels[i]}</text>;
        })}
      </svg>
    );
  };
  return <div ref={ref} className="env-chart">{body()}</div>;
}

const BLUES = ["#1560E8", "#3B7CF0", "#6699F5", "#8FB5F8", "#B7CFFA"];
export function HBars({ rows }: { rows: { l: string; v: number; onClick?: () => void }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className="hb">
      {rows.map((r, ix) => (
        <button key={r.l + ix} className="hb-row" onClick={r.onClick} title={`${r.l}: ${r.v}`}>
          <span className="hb-l">{r.l}</span>
          <span className="hb-v">{r.v.toLocaleString("en-IN")}</span>
          <span className="hb-t">
            <span className="hb-b" style={{
              width: `${((r.v / max) * 100).toFixed(1)}%`,
              background: `linear-gradient(90deg,${BLUES[Math.min(ix, 4)]},${BLUES[Math.min(ix + 1, 4)]})`
            }} />
          </span>
        </button>
      ))}
    </div>
  );
}

export function Donut({ parts }: { parts: { l: string; v: number; c: string; sub?: string }[] }) {
  const tot = Math.max(1, sum(parts, (p) => p.v));
  let a = -Math.PI / 2;
  const R = 56, r = 37, C = 66;
  const arcs = parts.filter((p) => p.v > 0).map((p) => {
    const a0 = a, a1 = a + (p.v / tot) * Math.PI * 2 - (parts.length > 1 ? 0.02 : 0);
    a += (p.v / tot) * Math.PI * 2;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const P = (ang: number, rad: number) => `${(C + rad * Math.cos(ang)).toFixed(2)} ${(C + rad * Math.sin(ang)).toFixed(2)}`;
    return { p, d: `M${P(a0, R)} A${R} ${R} 0 ${big} 1 ${P(a1, R)} L${P(a1, r)} A${r} ${r} 0 ${big} 0 ${P(a0, r)}Z` };
  });
  return (
    <div className="donut">
      <svg viewBox="0 0 132 132" role="img" aria-label="Share by severity">
        {arcs.length === 1 ? <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke={arcs[0].p.c} strokeWidth={R - r} />
          : arcs.map((x) => <path key={x.p.l} d={x.d} fill={x.p.c}><title>{`${x.p.l}: ${x.p.v}`}</title></path>)}
        <text x={C} y={C - 2} textAnchor="middle" style={{ font: "800 22px var(--dic-display)", fill: "var(--text)" }}>{sum(parts, (p) => p.v).toLocaleString("en-IN")}</text>
        <text x={C} y={C + 16} textAnchor="middle" style={{ font: "600 11px var(--dic-sans)", fill: "var(--text-3)" }}>incidents</text>
      </svg>
      <ul>
        {parts.map((p) => (
          <li key={p.l}><i style={{ background: p.c }} />{p.l}<span><b>{p.v.toLocaleString("en-IN")}</b><small>{p.sub}</small></span></li>
        ))}
      </ul>
    </div>
  );
}
