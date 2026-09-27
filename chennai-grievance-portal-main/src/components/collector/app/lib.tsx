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

// ------------------------------------------------------ severity, status --

export const SEVS = ["Severe", "High", "Medium", "Low"] as const;
export const SEV_COL: Record<string, string> = {
  Severe: "var(--sev)",
  High: "var(--high)",
  Medium: "var(--med)",
  Low: "var(--accent)"
};
export const CAT_COL: Record<string, string> = { severe: "var(--sev)", complaint: "var(--high)", other: "var(--accent)" };
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
  pwd: { k: "PWD record", ic: "doc", tone: "t-low" },
  hospital: { k: "Hospital report", ic: "health", tone: "t-sev" },
  news: { k: "News report", ic: "news", tone: "t-high" },
  imd: { k: "IMD warning", ic: "cloud", tone: "t-med" },
  collector: { k: "Collector", ic: "gov", tone: "t-blue" }
};
export const isPortal = (i: Row) => String(i.sources ?? "").split("|").includes("grievance");
export const isNews = (i: Row) => Number(i.outlets) > 0 || String(i.sources ?? "").split("|").includes("news");

/** "Waterlogging – Ward 15" style title, avoiding repetition. */
export const fullTitle = (i: Row) => i.title || `${i.type} – ${i.loc ?? i.zone_name ?? ""}`;

// ------------------------------------------------------------------ UI --

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <I n="checkc" />
      {children}
    </div>
  );
}

/** Count-up number, as in the design (respects reduced motion). */
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
  return <>{dec ? shown.toFixed(dec) : Math.round(shown) < 100 ? pad2(Math.round(shown)) : Math.round(shown).toLocaleString("en-IN")}</>;
}

// -------------------------------------------------------------- charts --

let gid = 0;
const uid = (p: string) => `${p}${++gid}`;

export function Spark({ vals }: { vals: number[] }) {
  const W = 64, H = 34, n = vals.length;
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

function ticks(n: number) {
  return n <= 7 ? [...Array(n).keys()] : [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
}

export function Bars({ vals, labels, unit, highlight }: { vals: number[]; labels: string[]; unit: string; highlight?: boolean[] }) {
  const W = 260, H = 48, n = vals.length;
  if (!n) return null;
  const max = Math.max(...vals, 0.1), bw = W / n;
  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} className="mini" role="img" aria-label="Bar chart">
      {[0.5, 1].map((f) => (
        <line key={f} className="grid" x1="0" x2={W} y1={H - (H - 6) * f} y2={H - (H - 6) * f} />
      ))}
      <line className="axis" x1="0" x2={W} y1={H} y2={H} />
      {vals.map((v, i) => {
        const h = Math.max(1.5, (v / max) * (H - 6));
        return (
          <rect key={i} className={i === n - 1 || highlight?.[i] ? "bar-last" : "bar"} x={(i * bw + bw * 0.16).toFixed(1)}
            y={(H - h).toFixed(1)} width={(bw * 0.68).toFixed(1)} height={h.toFixed(1)} rx="1.5"
            style={{ animationDelay: `${(0.15 + i * 0.015).toFixed(2)}s` }}>
            <title>{`${labels[i]}: ${v.toFixed(1)} ${unit}`}</title>
          </rect>
        );
      })}
      {ticks(n).map((i) => (
        <text key={i} className="tick" x={Math.min(W - 14, Math.max(14, i * bw + bw / 2))} y={H + 12} textAnchor="middle">
          {labels[i]}
        </text>
      ))}
    </svg>
  );
}

export function Line({ vals, labels, color, fmt }: { vals: number[]; labels: string[]; color: string; fmt: (v: number) => string }) {
  const W = 260, H = 46, n = vals.length;
  const id = useRef(uid("g")).current;
  if (!n) return null;
  const mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
  const x = (i: number) => (n === 1 ? W / 2 : 6 + (i * (W - 12)) / (n - 1));
  const y = (v: number) => 6 + (1 - (v - mn) / rg) * (H - 14);
  const pts = vals.map((v, i) => [x(i), y(v)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} className="mini" role="img" aria-label="Line chart">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".3" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.33, 0.66].map((f) => (
        <line key={f} className="grid" x1="0" x2={W} y1={6 + (H - 14) * f} y2={6 + (H - 14) * f} />
      ))}
      <path d={`${d} L${x(n - 1)} ${H} L${x(0)} ${H}Z`} fill={`url(#${id})`} />
      <path className="ln-d" d={d} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {n <= 31 ? (
        pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={i === n - 1 ? 4.5 : 2} fill={i === n - 1 ? color : "#fff"} stroke={color} strokeWidth="1.5">
            <title>{`${labels[i]}: ${fmt(vals[i])}`}</title>
          </circle>
        ))
      ) : (
        <circle cx={pts[n - 1][0]} cy={pts[n - 1][1]} r="4.5" fill={color} />
      )}
      {ticks(n).map((i) => (
        <text key={i} className="tick" x={Math.min(W - 14, Math.max(14, x(i)))} y={H + 12} textAnchor="middle">
          {labels[i]}
        </text>
      ))}
    </svg>
  );
}

const BLUES = ["--b1", "--b2", "--b3", "--b4", "--b5"];
export function HBars({ rows }: { rows: { l: string; v: number; onClick?: () => void }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className="hb">
      {rows.map((r, ix) => (
        <button key={r.l + ix} className="hb-row" onClick={r.onClick} title={`${r.l}: ${r.v}`}>
          <span className="hb-l">{r.l}</span>
          <span className="hb-t">
            <span className="hb-b" style={{
              width: `${((r.v / max) * 100).toFixed(1)}%`,
              background: `linear-gradient(90deg,var(${BLUES[Math.min(ix, 4)]}),var(${BLUES[Math.min(ix + 1, 4)]}))`
            }} />
          </span>
          <span className="hb-v">{r.v.toLocaleString("en-IN")}</span>
        </button>
      ))}
    </div>
  );
}
