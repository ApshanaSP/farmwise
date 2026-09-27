"use client";

import { useEffect, useState } from "react";
import { X, ExternalLink, CheckCircle2, ArrowUpRight, Ban, RotateCcw, Loader2, MessageSquarePlus } from "lucide-react";
import type { Decision, IncidentDetail } from "@/lib/collector/queries";
import {
  DECISION_LABEL,
  DecisionChip,
  SeverityChip,
  SOURCE_LABEL,
  fmtDateTime,
  fmtHours
} from "@/components/collector/ui";

interface Props {
  incidentId: string;
  onClose: () => void;
  onDecision: (d: Decision) => void;
}

type Mode = null | "verify" | "escalate" | "reject" | "resolve" | "reopen" | "note";

export default function IncidentDrawer({ incidentId, onClose, onDecision }: Props) {
  const [data, setData] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [note, setNote] = useState("");
  const [escalateTo, setEscalateTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    setMode(null);
    fetch(`/api/collector/incidents/${encodeURIComponent(incidentId)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "Could not load the incident.");
        if (live) setData(body);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [incidentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (!mode) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch("/api/collector/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId, decision: mode, note: note || null, escalateTo: escalateTo || null })
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Could not save the decision.");
      setData((d) => (d ? { ...d, decisions: [body.decision, ...d.decisions] } : d));
      onDecision(body.decision);
      setMode(null);
      setNote("");
      setEscalateTo("");
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const inc = data?.incident;
  const latest = data?.decisions.find((d) => d.decision !== "note") ?? null;

  return (
    <>
      <div className="fixed inset-0 z-[1000] bg-navy-950/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Incident details"
        className="fixed inset-y-0 right-0 z-[1001] flex w-full max-w-xl flex-col bg-white shadow-lift animate-fade-in"
      >
        <header className="relative flex flex-col gap-2 bg-navy px-5 pb-4 pt-5 text-white mesh-navy">
          <button onClick={onClose} className="absolute right-4 top-4 rounded-lg p-1.5 hover:bg-white/15" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
          <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-navy-200">{incidentId}</p>
          <h2 className="pr-10 text-lg font-bold leading-snug">{inc?.title ?? (error ? "Incident" : "Loading…")}</h2>
          {inc && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-navy-100">
              <SeverityChip level={inc.severity_level} />
              <span className="rounded-md bg-white/15 px-1.5 py-0.5 font-semibold">{inc.status_std}</span>
              <DecisionChip decision={latest} />
              <span>
                {inc.category_label} · {inc.zone_name ?? "Zone ?"}
                {inc.ward_no ? `, ward ${inc.ward_no}` : ""}
              </span>
            </div>
          )}
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {error && <div className="alert-error">{error}</div>}
          {!data && !error && (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-14" />
              ))}
            </div>
          )}

          {inc && data && (
            <>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <Fact label="First reported" value={fmtDateTime(inc.first_reported_at)} />
                <Fact label="Deadline" value={fmtDateTime(inc.sla_due_at)} warn={!!inc.sla_breached && !!inc.is_open} />
                <Fact label="Lead department" value={inc.lead_dept ?? "—"} />
                <Fact label="Open for" value={inc.is_open ? fmtHours(inc.hours_open) : "Closed"} />
                <Fact label="Place" value={inc.place_text ?? "—"} />
                <Fact label="Priority" value={`${Math.round(inc.priority_score ?? 0)}`} />
              </dl>

              {(inc.priority_reasons || inc.attention_reason) && (
                <Section title="Why it needs attention">
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-muted">
                    {[inc.attention_reason, ...(String(inc.priority_reasons ?? "").split(/[;|]/))]
                      .map((s) => (s ?? "").trim())
                      .filter(Boolean)
                      .slice(0, 6)
                      .map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                  </ul>
                </Section>
              )}

              <Section title={`Evidence · ${data.members.length} linked record${data.members.length === 1 ? "" : "s"}`}>
                <ul className="divide-y divide-canvas-border rounded-xl border border-canvas-border">
                  {data.members.map((m) => (
                    <li key={m.event_id} className="px-3 py-2.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-navy-50 px-1.5 py-0.5 text-2xs font-semibold text-navy">
                          {SOURCE_LABEL[m.source] ?? m.source}
                        </span>
                        <span className="truncate font-medium text-ink">{m.title || m.category_src || m.source_record_id}</span>
                        {m.deep_link && (
                          <a href={m.deep_link} target="_blank" rel="noreferrer" className="ml-auto flex-none text-navy hover:underline">
                            <ExternalLink className="h-3.5 w-3.5" aria-label="Open source record" />
                          </a>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {fmtDateTime(m.reported_at)} · {m.source_record_id}
                        {m.role === "first_report"
                          ? " · first report"
                          : m.link_prob != null
                            ? ` · linked ${Math.round(m.link_prob * 100)}% (${m.link_method})`
                            : ""}
                        {m.is_overlay ? " · scenario record" : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </Section>

              {data.documents.length > 0 && (
                <Section title="News coverage">
                  <ul className="space-y-1 text-sm">
                    {data.documents.map((d) => (
                      <li key={d.doc_id} className="flex gap-2">
                        <span className="flex-none text-xs font-semibold text-ink-subtle">{d.publisher}</span>
                        {d.url ? (
                          <a className="truncate text-navy hover:underline" href={d.url} target="_blank" rel="noreferrer">
                            {d.title}
                          </a>
                        ) : (
                          <span className="truncate">{d.title}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {data.actions.length > 0 && (
                <Section title="Department actions">
                  <ul className="space-y-1.5 text-sm">
                    {data.actions.map((a) => (
                      <li key={a.action_id} className="flex items-start gap-2">
                        <span
                          className={`mt-0.5 flex-none rounded-md px-1.5 py-0.5 text-2xs font-semibold ${
                            a.status === "Done" ? "bg-emerald-50 text-emerald-700" : "bg-canvas-sunken text-ink-muted"
                          }`}
                        >
                          {a.status}
                        </span>
                        <span className="text-ink-muted">
                          <b className="font-semibold text-ink">{a.dept_code}</b> {a.text}
                          {a.due_at ? <span className="text-ink-subtle"> · due {fmtDateTime(a.due_at)}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="Timeline">
                <ol className="relative space-y-2 border-l-2 border-canvas-border pl-4 text-sm">
                  {data.timeline.map((t, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-navy-400 ring-4 ring-white" />
                      <span className="font-semibold text-ink">{t.step}</span>
                      <span className="text-ink-subtle"> · {fmtDateTime(t.at)}</span>
                      {(t.actor || t.note) && (
                        <p className="text-xs text-ink-muted">
                          {[t.actor, t.note].filter(Boolean).join(" — ")}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </Section>

              {data.decisions.length > 0 && (
                <Section title="Collector decisions">
                  <ul className="space-y-1.5 text-sm">
                    {data.decisions.map((d) => (
                      <li key={d.decision_id}>
                        <span className="font-semibold">{DECISION_LABEL[d.decision]}</span>
                        {d.escalate_to ? ` to ${d.escalate_to}` : ""}
                        <span className="text-ink-subtle">
                          {" "}
                          · {fmtDateTime(d.decided_at)} · {d.decided_by}
                        </span>
                        {d.note && <p className="text-xs text-ink-muted">{d.note}</p>}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </>
          )}
        </div>

        {data && (
          <footer className="border-t border-canvas-border bg-canvas px-5 py-3">
            {mode ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-ink">{MODE_TITLE[mode]}</p>
                {mode === "escalate" && (
                  <select className="form-input py-2" value={escalateTo} onChange={(e) => setEscalateTo(e.target.value)}>
                    <option value="">Choose a department…</option>
                    {data.departments.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.name} ({d.code})
                      </option>
                    ))}
                  </select>
                )}
                <textarea
                  className="form-input min-h-[70px] py-2"
                  placeholder={mode === "reject" || mode === "note" ? "Note (required)" : "Note (optional)"}
                  value={note}
                  maxLength={2000}
                  onChange={(e) => setNote(e.target.value)}
                />
                {saveError && <p className="form-error">{saveError}</p>}
                <div className="flex gap-2">
                  <button className="btn-primary px-4 py-2" onClick={submit} disabled={saving}>
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save
                  </button>
                  <button className="btn-ghost px-4 py-2" onClick={() => setMode(null)} disabled={saving}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {inc?.is_open ? (
                  <>
                    <ActionButton icon={<CheckCircle2 className="h-4 w-4" />} label="Verify" onClick={() => setMode("verify")} primary />
                    <ActionButton icon={<ArrowUpRight className="h-4 w-4" />} label="Escalate" onClick={() => setMode("escalate")} />
                    <ActionButton icon={<CheckCircle2 className="h-4 w-4" />} label="Mark resolved" onClick={() => setMode("resolve")} />
                    <ActionButton icon={<Ban className="h-4 w-4" />} label="Reject" onClick={() => setMode("reject")} />
                  </>
                ) : (
                  <ActionButton icon={<RotateCcw className="h-4 w-4" />} label="Reopen" onClick={() => setMode("reopen")} />
                )}
                <ActionButton icon={<MessageSquarePlus className="h-4 w-4" />} label="Add note" onClick={() => setMode("note")} />
              </div>
            )}
          </footer>
        )}
      </aside>
    </>
  );
}

const MODE_TITLE: Record<Exclude<Mode, null>, string> = {
  verify: "Verify this incident",
  escalate: "Escalate to a department",
  reject: "Reject this incident",
  resolve: "Mark this incident resolved",
  reopen: "Reopen this incident",
  note: "Add a note"
};

function Fact({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-canvas-border bg-canvas px-3 py-2">
      <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className={`truncate font-semibold ${warn ? "text-red-700" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-2xs font-bold uppercase tracking-[0.1em] text-navy">{title}</h3>
      {children}
    </section>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  primary
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button onClick={onClick} className={`${primary ? "btn-primary" : "btn-secondary"} px-3.5 py-2`}>
      {icon}
      {label}
    </button>
  );
}
