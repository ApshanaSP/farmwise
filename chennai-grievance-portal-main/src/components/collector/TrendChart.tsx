"use client";

import { useMemo, useState } from "react";
import type { Overview } from "@/lib/collector/queries";
import { SOURCE_LABEL } from "@/components/collector/ui";

// Categorical order and colours, most records first; news is small so it sits on top.
const SERIES = [
  { key: "grievance", color: "#0B3D91" },
  { key: "police", color: "#5B86D4" },
  { key: "pwd", color: "#C8891B" },
  { key: "hospital", color: "#0E9F6E" },
  { key: "news", color: "#8B5CF6" }
];

const W = 640;
const H = 190;
const PAD = { l: 34, r: 8, t: 10, b: 22 };

export default function TrendChart({ trend, calendar }: { trend: Overview["trend"]; calendar: Overview["calendar"] }) {
  const [hover, setHover] = useState<number | null>(null);

  const { days, max } = useMemo(() => {
    const byDay = new Map<string, Record<string, number>>();
    for (const r of trend) {
      const d = byDay.get(r.date) ?? {};
      d[r.source] = Number(r.n);
      byDay.set(r.date, d);
    }
    const cal = new Map(calendar.map((c) => [c.date, c]));
    const days = [...byDay.keys()].sort().map((date) => {
      const v = byDay.get(date)!;
      const total = SERIES.reduce((s, x) => s + (v[x.key] ?? 0), 0);
      return { date, v, total, rain: !!cal.get(date)?.rain_event, festival: cal.get(date)?.festival || null };
    });
    const max = Math.max(1, ...days.map((d) => d.total));
    return { days, max: niceMax(max) };
  }, [trend, calendar]);

  if (days.length === 0) return <p className="py-8 text-center text-sm text-ink-subtle">No daily counts yet.</p>;

  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const bw = iw / days.length;
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const h = hover != null ? days[hover] : null;

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-muted">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <i className="block h-2 w-2 rounded-sm" style={{ background: s.color }} />
            {SOURCE_LABEL[s.key]}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <i className="block h-2 w-3 rounded-sm bg-sky-100 ring-1 ring-sky-200" /> Rain day
        </span>
        <span className="ml-auto min-h-[1rem] font-medium text-ink">
          {h
            ? `${h.date}: ${h.total.toLocaleString("en-IN")} records` + (h.rain ? " · rain" : "") + (h.festival ? ` · ${h.festival}` : "")
            : "Hover a day for its counts"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" onMouseLeave={() => setHover(null)} role="img"
        aria-label="Records per day by source">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} stroke="#E4E9F2" strokeDasharray={f ? "3 3" : undefined} />
            <text x={PAD.l - 5} y={y(max * f) + 3} textAnchor="end" fontSize="9" fill="#7A879E">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          let acc = 0;
          const x = PAD.l + i * bw;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              {d.rain && <rect x={x} y={PAD.t} width={bw} height={ih} fill="#E0F2FE" />}
              <rect x={x} y={PAD.t} width={bw} height={ih} fill="transparent" />
              {SERIES.map((s) => {
                const v = d.v[s.key] ?? 0;
                if (!v) return null;
                const top = y(acc + v);
                const rect = (
                  <rect key={s.key} x={x + bw * 0.15} y={top} width={bw * 0.7} height={y(acc) - top} fill={s.color}
                    opacity={hover == null || hover === i ? 1 : 0.45} />
                );
                acc += v;
                return rect;
              })}
              {(i === 0 || i === days.length - 1 || i % Math.ceil(days.length / 6) === 0) && (
                <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="9" fill="#7A879E">
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v;
}
