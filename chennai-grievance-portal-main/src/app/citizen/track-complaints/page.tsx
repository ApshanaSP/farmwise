"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  ChevronDown,
  FileSearch,
  MapPin,
  Paperclip,
  Search,
  Tag
} from "lucide-react";
import Header from "@/components/Header";
import { CITIZEN_NAV } from "@/lib/constants";
import Footer from "@/components/Footer";
import StatusBadge from "@/components/StatusBadge";
import StatusTracker from "@/components/StatusTracker";
import { ComplaintStatus } from "@/types";
import { COMPLAINT_STATUSES } from "@/lib/constants";

interface ComplaintListItem {
  id: number;
  complaint_code: string;
  title: string;
  status: ComplaintStatus;
  rejected_stage: "Department Officer" | "Collector" | null;
  remarks: string | null;
  created_at: string;
  department_name: string;
  complaint_type_name: string;
  zone_name: string;
  locality_name: string;
}

export default function TrackComplaintsPage() {
  const [me, setMe] = useState<any>(null);
  const [complaints, setComplaints] = useState<ComplaintListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((d) => d && setMe(d.user));
    loadComplaints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadComplaints(codeQuery?: string, status?: string) {
    setLoading(true);
    const params = new URLSearchParams();
    if (codeQuery) params.set("code", codeQuery);
    if (status) params.set("status", status);
    const res = await fetch(`/api/complaints?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setComplaints(data.complaints || []);
    }
    setLoading(false);
  }

  async function toggleDetails(code: string) {
    if (expandedCode === code) {
      setExpandedCode(null);
      setDetail(null);
      return;
    }
    setExpandedCode(code);
    setDetailLoading(true);
    const res = await fetch(`/api/complaints/${code}`);
    if (res.ok) {
      const data = await res.json();
      setDetail(data.complaint);
    }
    setDetailLoading(false);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    loadComplaints(search, statusFilter);
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header userName={me?.email} homeHref="/citizen" nav={CITIZEN_NAV} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-7">
          <Link
            href="/citizen"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-subtle transition hover:text-navy"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to dashboard
          </Link>
          <h1 className="mt-3 text-[1.75rem] font-extrabold leading-tight text-ink sm:text-[2rem]">
            Track Complaint Status
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Every complaint you&apos;ve filed, with its current stage.
          </p>
        </div>

        <form onSubmit={handleSearchSubmit} className="mb-6 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <span className="input-affix">
              <Search className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <input
              type="text"
              placeholder="Search by Complaint Number..."
              className="form-input pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="form-input sm:w-60" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {COMPLAINT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button type="submit" className="btn-primary sm:w-auto">
            <Search className="h-4 w-4" aria-hidden="true" />
            Search
          </button>
        </form>

        {loading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card-flat space-y-3">
                <div className="flex justify-between">
                  <div className="skeleton h-6 w-40" />
                  <div className="skeleton h-6 w-28 rounded-full" />
                </div>
                <div className="skeleton h-4 w-3/4" />
                <div className="skeleton h-4 w-1/2" />
              </div>
            ))}
          </div>
        ) : complaints.length === 0 ? (
          <div className="card flex flex-col items-center py-14 text-center">
            <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-navy-50 text-navy">
              <FileSearch className="h-7 w-7" aria-hidden="true" />
            </span>
            <p className="font-display text-base font-bold text-ink">No complaints found</p>
            <p className="mb-6 mt-1 max-w-sm text-sm text-ink-muted">
              You haven&apos;t filed any complaints matching this search yet.
            </p>
            <Link href="/citizen/file-complaint" className="btn-primary">File a Complaint</Link>
          </div>
        ) : (
          <div className="stagger space-y-4">
            {complaints.map((c) => {
              const expanded = expandedCode === c.complaint_code;
              return (
                <article
                  key={c.id}
                  className={`overflow-hidden rounded-2xl border bg-white transition-all duration-300 ${
                    expanded ? "border-navy-200 shadow-lift" : "border-canvas-border shadow-card"
                  }`}
                >
                  <div className="p-5 sm:p-6">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                      <div className="min-w-0">
                        <p className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                          Complaint Number
                        </p>
                        <p className="font-mono text-lg font-bold tracking-tight text-navy">
                          {c.complaint_code}
                        </p>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>

                    <h3 className="mt-3 font-display text-base font-bold text-ink">{c.title}</h3>

                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                      {[
                        { icon: Building2, label: "Department", value: c.department_name },
                        { icon: Tag, label: "Type", value: c.complaint_type_name },
                        { icon: MapPin, label: "Location", value: `${c.locality_name}, ${c.zone_name}` },
                        {
                          icon: CalendarDays,
                          label: "Filed On",
                          value: new Date(c.created_at).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric"
                          })
                        }
                      ].map(({ icon: Icon, label, value }) => (
                        <div key={label} className="flex items-start gap-2">
                          <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-ink-faint" aria-hidden="true" />
                          <div className="min-w-0">
                            <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                              {label}
                            </dt>
                            <dd className="truncate text-xs font-medium text-ink-muted" title={value}>
                              {value}
                            </dd>
                          </div>
                        </div>
                      ))}
                    </dl>

                    {c.remarks && c.status !== "Rejected" && (
                      <p className="mt-4 rounded-xl bg-canvas p-3 text-xs text-ink-muted">
                        <span className="font-semibold text-ink">Remarks: </span>
                        {c.remarks}
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleDetails(c.complaint_code)}
                      aria-expanded={expanded}
                      className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-navy transition hover:text-navy-700"
                    >
                      {expanded ? "Hide details" : "View details"}
                      <ChevronDown
                        className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>

                  {expanded && (
                    <div className="animate-fade-in border-t border-canvas-border bg-canvas p-5 sm:p-6">
                      {detailLoading ? (
                        <div className="space-y-3">
                          <div className="skeleton h-4 w-1/3" />
                          <div className="skeleton h-20 w-full" />
                        </div>
                      ) : (
                        <StatusTracker status={c.status} rejectedStage={c.rejected_stage} remarks={c.remarks} />
                      )}

                      {detail && (
                        <dl className="mt-5 grid grid-cols-1 gap-3 border-t border-canvas-border pt-5 text-sm sm:grid-cols-2">
                          <div>
                            <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">Street</dt>
                            <dd className="text-ink-muted">{detail.street_name}</dd>
                          </div>
                          <div>
                            <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">Specific Location</dt>
                            <dd className="text-ink-muted">{detail.specific_location || "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">Ward</dt>
                            <dd className="text-ink-muted">{detail.ward_number}</dd>
                          </div>
                          <div>
                            <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">Anonymous</dt>
                            <dd className="text-ink-muted">{detail.is_anonymous ? "Yes" : "No"}</dd>
                          </div>
                          <div className="sm:col-span-2">
                            <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">Description</dt>
                            <dd className="leading-relaxed text-ink-muted">{detail.description}</dd>
                          </div>
                          {detail.media_path && (
                            <div className="sm:col-span-2">
                              <a
                                href={detail.media_path}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy hover:underline"
                              >
                                <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                                View attached photo/video
                              </a>
                            </div>
                          )}
                        </dl>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
