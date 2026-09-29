"use client";

import { useEffect, useState } from "react";
import type { IncidentDetail } from "@/lib/collector/intel";
import { I } from "./icons";
import { OfficerCard } from "./Overview";
import { SOURCE_KIND, deptIcon, fmtDay, fmtShort, fmtTime, fullTitle, ms, plural, rel, sourceItems, type Row } from "./lib";
import type { Console } from "./CollectorApp";

const CHANNEL: Record<string, string> = {
  citizen_app: "Citizen app", citizen_grievance: "Grievance portal", control_room_112: "Control room 112", fir_walk_in: "Police station",
  patrol: "Police patrol", field_staff: "Field staff", collector_office: "Collector's office", hospital_mis: "Hospital MIS",
  control_room: "Control room"
};

/**
 * Read-only incident view for the Collector: what happened, why it matters in plain
 * words, and every report merged into it, each at its own time. No actions here.
 */
export function IncidentView({ id, c }: { id: string; c: Console }) {
  const [data, setData] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    fetch(`/api/collector/incidents/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Could not load the incident.");
        if (live) setData(j);
      })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [id, c.reloadKey]);

  const i = data?.incident as Row | undefined;
  if (!data || !i || i.id !== id) {
    return (
      <div className="modal iv" role="dialog" aria-label="Incident">
        <div className="iv-h"><button className="xbtn" onClick={c.closeAll} aria-label="Close"><I n="x" /></button><h2>{error ? "Incident" : "Loading…"}</h2></div>
        <div className="empty" style={{ color: error ? "var(--sev)" : undefined }}>{error ?? "Loading the incident…"}</div>
      </div>
    );
  }

  const open = Number(i.open) === 1;
  const reports = data.reports as Row[];
  const srcs = sourceItems(i);
  const dec = (data.decisions as Row[]).filter((x) => x.decision !== "note").slice(-1)[0];
  const deptContacts = (data.contacts as Row[]).filter((x) => x.dept_code === i.dept);
  const zoneContact = i.zone != null ? (data.contacts as Row[]).find((x) => x.zone_no != null && x.zone_no === i.zone) : undefined;
  const overdue = open && i.sla_due && ms(i.sla_due) < ms(c.now);
  const why = i.why as { what: string[]; why: string[] };

  // group the linked reports by day
  const days: { day: string; items: Row[] }[] = [];
  for (const r of reports) {
    const day = String(r.t).slice(0, 10);
    const g = days[days.length - 1];
    if (g && g.day === day) g.items.push(r);
    else days.push({ day, items: [r] });
  }

  return (
    <div className="modal iv" role="dialog" aria-label={fullTitle(i)}>
      <div className={`iv-h s-${String(i.sev).toLowerCase()}`}>
        <button className="xbtn" onClick={c.closeAll} aria-label="Close"><I n="x" /></button>
        <div className="iv-tags">
          <span className="tg solid" style={{ color: { Severe: "#C21F2A", High: "#C9600A", Medium: "#8A6700", Low: "#0E7C50" }[i.sev as string] }}>
            <I n="alert" />{i.sev} severity
          </span>
          <span className="tg">{i.status}</span>
          {dec?.decision === "verify" && <span className="tg"><I n="check" />Verified by you {rel(dec.t, c.now)}</span>}
          {data.assigned && <span className="tg"><I n="send" />Sent to {data.assigned.officer_designation ?? i.dept_name}</span>}
          <span className="tg" style={{ opacity: .8 }}>{i.id}</span>
        </div>
        <h2>{fullTitle(i)}</h2>
        <div className="iv-where">
          <span><I n="pin" />{[i.loc, i.zone_name, i.ward ? `Ward ${i.ward}` : null].filter(Boolean).join(" · ") || "Chennai"}</span>
          <span><I n={deptIcon(i.dept)} />{i.dept_name ?? i.dept}</span>
          <span><I n="clock" />First reported {fmtShort(i.t)} ({rel(i.t, c.now)})</span>
          {i.lat != null && <button className="iv-loc" onClick={() => c.locate(i)}><I n="target" />Show on map</button>}
        </div>
      </div>

      <div className="iv-b">
        <section className="iv-col">
          <div>
            <div className="iv-t"><I n="alert" />What happened</div>
            {why.what.length ? <ul className="reasons what">{why.what.map((w) => <li key={w}><I n="alert" />{w}</li>)}</ul>
              : <p style={{ margin: "8px 0 0", color: "var(--text-2)" }}>{i.type}{i.loc ? ` at ${i.loc}` : ""}.</p>}
          </div>
          <div>
            <div className="iv-t"><I n="spark" />Why it needs attention</div>
            {why.why.length ? <ul className="reasons why">{why.why.map((w) => <li key={w}><I n="chevr" />{w}</li>)}</ul>
              : <p style={{ margin: "8px 0 0", color: "var(--text-2)" }}>No extra risk factors: a routine {String(i.sev).toLowerCase()}-severity case.</p>}
          </div>
          <div>
            <div className="iv-t"><I n="doc" />Key facts</div>
            <div className="facts">
              <div><small>{open ? "Open for" : "Closed"}</small><b>{open ? rel(i.t, c.now).replace(" ago", "") : i.closed_at ? fmtShort(i.closed_at) : i.status}</b></div>
              <div><small>Deadline</small><b style={{ color: overdue ? "var(--sev)" : undefined }}>{i.sla_due ? `${fmtShort(i.sla_due)}${overdue ? " · missed" : ""}` : "—"}</b></div>
              <div><small>Citizen complaints</small><b>{Number(i.complaints).toLocaleString("en-IN")}</b></div>
              <div><small>Field officer</small><b>{i.officer || "—"}</b></div>
              <div><small>Taluk</small><b>{i.taluk_name ?? "Not resolved"}</b></div>
              <div title={confidenceNote(i)}><small>Confidence</small><b style={{ color: Number(i.confidence) < 0.7 ? "var(--high)" : undefined }}>
                {i.confidence == null ? "—" : `${Math.round(Number(i.confidence) * 100)}%`}{Number(i.needs_review) ? " · review" : ""}</b></div>
              {Number(i.injured) > 0 || Number(i.dead) > 0 ? <div><small>Casualties</small><b style={{ color: "var(--sev)" }}>{[Number(i.dead) ? `${i.dead} dead` : null, Number(i.injured) ? `${i.injured} injured` : null].filter(Boolean).join(", ")}</b></div> : null}
              {Number(i.persons_affected) > 0 && <div><small>People affected</small><b>about {Number(i.persons_affected).toLocaleString("en-IN")}</b></div>}
            </div>
          </div>
        </section>

        <section className="iv-col">
          <div className="iv-t"><I n="clock" />How it unfolded<span>{plural(reports.length, "report")} from {plural(srcs.length, "source")}, merged into one incident</span></div>
          <ul className="tl">
            {days.map((g) => (
              <li key={g.day} style={{ listStyle: "none" }}>
                <div className="tl-day">{fmtDay(g.day + " 00:00:00")}</div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {g.items.map((r, k) => {
                    const kind = SOURCE_KIND[r.source] ?? SOURCE_KIND.grievance;
                    return (
                      <li className="ev" key={k}>
                        <span className={`dotc ${kind.tone}`}><I n={kind.ic} /></span>
                        <div className="evb">
                          <div className="eh">
                            <b>{r.source === "news" && r.publisher ? r.publisher : r.what}</b>
                            <span>{r.source === "news" ? "News" : CHANNEL[r.channel] ?? ""}</span>
                            {r.first && <span className="first">First</span>}
                            {!r.first && r.link != null && <span className="lk" title={`Merged by ${String(r.method ?? "matching").replace(/_/g, " ")}`}>linked {Math.round(r.link * 100)}%</span>}
                            <time>{fmtTime(r.t)}</time>
                          </div>
                          <p>
                            {r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.title} ↗</a> : (r.text || r.title)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        <section className="iv-col">
          <div>
            <div className="iv-t"><I n="layers" />Reported by</div>
            <div className="smix">
              {srcs.map((s) => {
                const kind = SOURCE_KIND[s.k];
                return (
                  <div key={s.k}>
                    <span className={`si ${kind.tone}`} style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center" }}><I n={kind.ic} /></span>
                    <span style={{ minWidth: 0 }}>{kind.k === "News report" ? "News outlets" : kind.k + "s"}
                      {s.k === "news" && i.src?.outlets?.length ? <small>{i.src.outlets.join(", ")}</small> : null}
                    </span>
                    <b>{s.n}</b>
                  </div>
                );
              })}
            </div>
          </div>
          {data.assigned && (
            <div className="banner teal"><I n="send" />
              <span>Only in the news, so District IQ sent it to <b>{data.assigned.officer_name ?? data.assigned.officer_designation}</b>
                {data.assigned.officer_name ? `, ${data.assigned.officer_designation}` : ""} on {fmtShort(data.assigned.assigned_at)}.</span>
            </div>
          )}
          <div>
            <div className="iv-t"><I n="phone" />Who is responsible</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {deptContacts.slice(0, 2).map((o) => <OfficerCard key={o.contact_id} o={o} />)}
              {!deptContacts.length && (
                <div className="officer"><span className="avatar">{String(i.dept ?? "").slice(0, 2)}</span>
                  <span><b>{i.dept_head ?? "Department head"}</b><small>{i.dept_name} · {i.dept_org}. Not listed on the GCC website.</small></span></div>
              )}
              {zoneContact && <OfficerCard o={zoneContact} label="Zonal officer" />}
            </div>
            {(deptContacts[0] ?? zoneContact) && (
              <div className="src-note">Contacts from the <a href={(deptContacts[0] ?? zoneContact)!.source_url} target="_blank" rel="noreferrer">GCC Who&apos;s who page</a>, retrieved {(deptContacts[0] ?? zoneContact)!.retrieved_on}.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/** What the confidence figure means, for the tooltip. */
function confidenceNote(i: Row) {
  const parts = ["How sure District IQ is that these reports are one incident at this place (the weakest link or location match)."];
  if (Number(i.needs_review)) parts.push(`Flagged for review: ${i.review_reason || "low confidence"}.`);
  if (Number(i.spread_m) > 0) parts.push(`Reports are spread over ${Math.round(Number(i.spread_m))} m.`);
  return parts.join(" ");
}
