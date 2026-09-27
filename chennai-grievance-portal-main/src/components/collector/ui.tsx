import type { ReactNode } from "react";

/** Stored times are IST wall-clock strings ("2026-09-27 01:50:00"); parse them as IST. */
export function istDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(" ", "T") + (s.length > 10 ? "+05:30" : "T00:00:00+05:30"));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDateTime(s: string | null | undefined): string {
  const d = istDate(s);
  if (!d) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

export function fmtDate(s: string | null | undefined): string {
  const d = istDate(s);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
}

export function fmtHours(h: number | null | undefined): string {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

export const fmtNum = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-IN"));

export const SEVERITY_STYLE: Record<string, { chip: string; dot: string; color: string }> = {
  Severe: { chip: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-600", color: "#DC2626" },
  High: { chip: "bg-orange-50 text-orange-700 ring-orange-200", dot: "bg-orange-500", color: "#EA7A0C" },
  Medium: { chip: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500", color: "#CA8A04" },
  Low: { chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-600", color: "#059669" }
};

export function SeverityChip({ level }: { level: string | null }) {
  const s = SEVERITY_STYLE[level ?? ""] ?? SEVERITY_STYLE.Low;
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-2xs font-semibold ring-1 ring-inset ${s.chip}`}>
      {level ?? "—"}
    </span>
  );
}

export const DECISION_LABEL: Record<string, string> = {
  verify: "Verified",
  escalate: "Escalated",
  reject: "Rejected",
  resolve: "Marked resolved",
  reopen: "Reopened",
  note: "Note"
};

export function DecisionChip({ decision }: { decision: { decision: string; escalate_to?: string | null } | null }) {
  if (!decision) return null;
  const tone =
    decision.decision === "reject"
      ? "bg-red-50 text-red-700 ring-red-200"
      : decision.decision === "escalate"
        ? "bg-violet-50 text-violet-700 ring-violet-200"
        : "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-2xs font-semibold ring-1 ring-inset ${tone}`}>
      {DECISION_LABEL[decision.decision]}
      {decision.decision === "escalate" && decision.escalate_to ? ` → ${decision.escalate_to}` : ""}
    </span>
  );
}

export const SOURCE_LABEL: Record<string, string> = {
  grievance: "Citizen complaint",
  police: "Police",
  pwd: "PWD",
  hospital: "Hospital",
  news: "News",
  imd: "IMD",
  cpcb: "CPCB",
  cfm: "CFM"
};

export function Panel({
  title,
  hint,
  action,
  children,
  className = "",
  bodyClassName = ""
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col rounded-2xl border border-canvas-border bg-white shadow-soft ${className}`}>
      <header className="flex items-center gap-2 px-4 pb-2 pt-3">
        <h2 className="truncate text-sm font-bold text-ink">{title}</h2>
        {hint && <span className="truncate text-xs text-ink-subtle">{hint}</span>}
        {action && <div className="ml-auto flex-none">{action}</div>}
      </header>
      <div className={`min-h-0 flex-1 px-4 pb-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
