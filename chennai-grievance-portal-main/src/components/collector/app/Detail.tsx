"use client";

import type { IncidentDetail } from "@/lib/collector/intel";
import { I } from "./icons";
import { SOURCE_KIND, fmtDate, fmtShort, type Row } from "./lib";
import type { Console } from "./CollectorApp";

/* Incident detail pieces shared by the drawer: timeline, source evidence, action list. */

export function Timeline({ steps }: { steps: Row[] }) {
  return (
    <ul className="vtl">
      {steps.map((s, k) => (
        <li key={k} className={/resolved/i.test(s.label) ? "fin" : /escalat|reject/i.test(s.label) ? "esc" : ""}>
          <i /><time>{fmtShort(s.t)}</time>
          <span>{s.label}<small>{[s.actor, s.note].filter(Boolean).join(" — ")}</small></span>
        </li>
      ))}
    </ul>
  );
}

export function Evidence({ members }: { members: Row[] }) {
  return (
    <>
      {members.map((m) => {
        const k = SOURCE_KIND[m.source] ?? SOURCE_KIND.grievance;
        return (
          <div className="src" key={m.event_id}>
            <span className={`sic ${k.tone}`}><I n={k.ic} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{m.title || k.k}</b>
              <small>{k.k} · {m.source_record_id} · {fmtShort(m.t)}</small>
              {m.text && <q>{String(m.text).slice(0, 180)}{String(m.text).length > 180 ? "…" : ""}</q>}
              <small style={{ color: "var(--accent)" }}>
                {m.role === "first_report" ? "First report" : m.link_prob != null ? `Linked ${Math.round(m.link_prob * 100)}% · ${m.link_method}` : m.role}
                {m.is_overlay ? " · scenario record" : ""}
                {m.deep_link && <> · <a href={m.deep_link} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>open record ↗</a></>}
              </small>
            </span>
          </div>
        );
      })}
    </>
  );
}

const ACT_CLS: Record<string, string> = { Done: "st-resolved", "In progress": "st-open", Pending: "st-progress", Draft: "st-review" };
export function Actions({ data, c }: { data: IncidentDetail; c: Console }) {
  if (!data.actions.length) return <div className="empty">No actions yet. Use Add to create one.</div>;
  return (
    <div className="tbl-wrap">
      <table className="acts">
        <tbody>
          {data.actions.map((a) => (
            <tr key={a.id} className={a.added ? "src-new" : ""} title="Click to move the status forward" onClick={() => c.cycleAction(data.incident.id, a)}>
              <td>{a.text}<div className="dim" style={{ fontSize: 11 }}>{a.owner || a.dept_code}{a.due ? ` · due ${fmtDate(a.due)}` : ""}{a.added ? " · added by Collector" : ""}</div></td>
              <td style={{ textAlign: "right" }}><span className={`st ${ACT_CLS[a.status] ?? "st-review"}`}>{a.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
