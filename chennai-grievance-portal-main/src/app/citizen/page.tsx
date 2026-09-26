import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileText,
  Loader,
  Phone
} from "lucide-react";
import { getSessionFromCookies } from "@/lib/auth";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import StatusBadge from "@/components/StatusBadge";
import { ComplaintStatus } from "@/types";
import pool from "@/lib/db";
import { CITIZEN_NAV } from "@/lib/constants";
import { RowDataPacket } from "mysql2";

export default async function CitizenLandingPage() {
  const session = await getSessionFromCookies();
  if (!session || session.role !== "citizen") {
    redirect("/login");
  }

  const [profileRows] = await pool.query<RowDataPacket[]>(
    "SELECT first_name FROM user_profiles WHERE user_id = ?",
    [session.userId]
  );
  const firstName = profileRows[0]?.first_name as string | undefined;

  const [statRows] = await pool.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'Verified by Collector') AS resolved,
       SUM(status NOT IN ('Verified by Collector', 'Rejected')) AS open
     FROM complaints WHERE user_id = ?`,
    [session.userId]
  );
  const stats = {
    total: Number(statRows[0]?.total ?? 0),
    resolved: Number(statRows[0]?.resolved ?? 0),
    open: Number(statRows[0]?.open ?? 0)
  };

  const [recentRows] = await pool.query<RowDataPacket[]>(
    `SELECT c.complaint_code, c.title, c.status, c.created_at, d.name AS department_name
     FROM complaints c
     JOIN departments d ON d.id = c.department_id
     WHERE c.user_id = ?
     ORDER BY c.created_at DESC
     LIMIT 3`,
    [session.userId]
  );

  const statCards = [
    { label: "Total Filed", value: stats.total, icon: ClipboardList, tone: "text-navy", bg: "bg-navy-50" },
    { label: "In Progress", value: stats.open, icon: Loader, tone: "text-gold-600", bg: "bg-gold-50" },
    { label: "Resolved", value: stats.resolved, icon: CheckCircle2, tone: "text-emerald-600", bg: "bg-emerald-50" }
  ];

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header userName={firstName || session.email} homeHref="/citizen" nav={CITIZEN_NAV} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {/* Hero */}
        <section className="mesh-navy grain relative mb-6 overflow-hidden rounded-3xl px-8 py-9 text-white shadow-lift sm:px-10 sm:py-10">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 animate-drift rounded-full bg-white/10 blur-3xl"
          />
          <div className="relative z-10 max-w-xl">
            <p className="eyebrow text-gold-300">Public Grievance Redressal</p>
            <h1 className="mt-2.5 text-balance text-[1.875rem] font-extrabold leading-[1.15] sm:text-[2.25rem]">
              Welcome{firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-navy-100">
              Report a civic issue in your neighbourhood, or follow the progress of a complaint
              you&apos;ve already filed. Most complaints are routed to a department within minutes.
            </p>
          </div>
        </section>

        {/* Stats */}
        <section className="stagger mb-6 grid grid-cols-3 gap-3 sm:gap-4">
          {statCards.map(({ label, value, icon: Icon, tone, bg }) => (
            <div key={label} className="card-flat p-4 sm:p-5">
              <span className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${bg}`}>
                <Icon className={`h-[18px] w-[18px] ${tone}`} aria-hidden="true" />
              </span>
              <p className="font-display text-2xl font-extrabold tabular-nums text-ink sm:text-3xl">{value}</p>
              <p className="mt-0.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</p>
            </div>
          ))}
        </section>

        {/* Recent activity */}
        <section className="card-flat animate-fade-up">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">Recent Complaints</h2>
            {recentRows.length > 0 && (
              <Link
                href="/citizen/track-complaints"
                className="inline-flex items-center gap-1 text-xs font-semibold text-navy hover:underline"
              >
                View all
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            )}
          </div>

          {recentRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy-50 text-navy"
              >
                <FileText className="h-5 w-5" />
              </span>
              <p className="mt-1 text-sm font-semibold text-ink">No complaints yet</p>
              <p className="max-w-sm text-sm leading-relaxed text-ink-muted">
                When you report a civic issue, it will appear here with its current stage.
                Use <span className="font-semibold text-ink">File a Complaint</span> in the
                menu above to get started.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-canvas-border">
              {recentRows.map((c) => (
                <li key={c.complaint_code as string} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{c.title as string}</p>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      <span className="font-mono">{c.complaint_code as string}</span> &middot;{" "}
                      {c.department_name as string} &middot;{" "}
                      {new Date(c.created_at as string).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric"
                      })}
                    </p>
                  </div>
                  <StatusBadge status={c.status as ComplaintStatus} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Helpline */}
        <section className="mt-6 flex items-center gap-3 rounded-2xl border border-gold-200 bg-gold-50 p-4">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gold-100 text-gold-700">
            <Phone className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <p className="text-sm text-gold-800">
            Emergency or life-threatening civic issue? Call the GCC helpline{" "}
            <span className="font-bold">1913</span> &mdash; available 24&times;7.
          </p>
        </section>
      </main>

      <Footer />
    </div>
  );
}
