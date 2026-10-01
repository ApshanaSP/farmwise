"use client";

import { useEffect, useState } from "react";
import { I } from "@/components/collector/app/icons";
import { SOURCE_KIND, SevChip, fmtShort, fullTitle, type Row } from "@/components/collector/app/lib";
import type { GrievanceDetail } from "@/lib/officer/data";
import { STAGE_INDEX, STEP_LABELS, type Stage } from "@/lib/officer/stages";
import { StageChip } from "./Cards";
import type { Ctx } from "./OfficerApp";

type Report = GrievanceDetail["reports"][number];

/** Received -> In action -> Sent to Collector -> Verified */
function Steps({ stage }: { stage: Stage }) {
  const k = STAGE_INDEX[stage] ?? 0;
  const last = STEP_LABELS.length - 1;
  return (
    <div className="wfs" aria-label={`Stage ${k + 1} of ${STEP_LABELS.length}: ${STEP_LABELS[k]}`}>
      <span className="rail"><i style={{ width: `${(k / last) * 100}%` }} /></span>
      {STEP_LABELS.map((l, ix) => {
        const done = ix < k || k === last;
        return <div key={l} className={done ? "dn" : ix === k ? "cur" : ""}><s>{done ? <I n="check" /> : null}</s>{l}</div>;
      })}
    </div>
  );
}

function ReportBlock({ r, title }: { r: Report; title: string }) {
  return (
    <div>
      <div className="sec-t">{title}</div>
      <div className="rep">
        <q>“{r.remarks}”</q>
        <span className="meta-row"><I n="user" />{r.by} · sent {fmtShort(r.t)}</span>
        {r.returned && <span className="chip sev-high"><I n="alert" />Returned by Collector{r.returned.note ? `: ${r.returned.note}` : ""}</span>}
        {r.verifiedAt && <span className="chip sev-low"><I n="check" />Verified by Collector · {fmtShort(r.verifiedAt)}</span>}
        <div className="ph-grid">
          {r.photos.map((p, k) => (
            <figure key={p}><a href={p} target="_blank" rel="noreferrer" title="Open the full photo"><img src={p} alt={`Site photo ${k + 1}`} loading="lazy" /></a></figure>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The grievance drawer: the workflow, the completion report, timeline and sources, with
 * the one action the current stage allows. mode "news" shows the news coverage instead.
 */
export function GrievanceDrawer({ id, mode, c, onMode }: { id: string; mode: "off" | "news"; c: Ctx; onMode: (m: "off" | "news") => void }) {
  const [d, setD] = useState<GrievanceDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setErr(null);
    fetch(`/api/officer/grievances/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Could not load the grievance.");
        if (live) setD(j);
      })
      .catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [id, c.reloadKey, retry]);

  const close = <button className="xbtn" onClick={c.closeAll} aria-label="Close"><I n="x" /></button>;
  if (!d || d.grievance.id !== id) {
    return (
      <aside className="odrawer" role="dialog" aria-label="Grievance">
        <div className="odrawer-h">{close}<h2>{err ? "Grievance" : "Loading…"}</h2></div>
        <div className={`o-state${err ? " err" : ""}`}>
          {err ?? "Loading the grievance…"}
          {err && <button className="btn sm plain" onClick={() => setRetry((n) => n + 1)}>Try again</button>}
        </div>
      </aside>
    );
  }

  const g = d.grievance;
  const where = [g.loc, g.zone_name, g.ward ? `Ward ${g.ward}` : null].filter(Boolean).join(", ") || "Chennai";

  if (mode === "news") {
    const news = d.sources.filter((s) => s.kind === "news");
    const outlets = new Set(news.map((s) => s.name).filter(Boolean));
    return (
      <aside className="odrawer" role="dialog" aria-label="News details">
        <div className="odrawer-h">{close}
          <div className="meta-row"><span className="chip chip-src"><I n="news" />News report</span><span>{fmtShort(news[0]?.t ?? g.t)}</span></div>
          <h2>{fullTitle(g)}</h2>
          <div className="meta-row"><I n="pin" />{where} · {c.dept.name}</div>
        </div>
        <div className="odrawer-b">
          {g.summary && <p style={{ margin: 0, color: "var(--text-2)" }}>{g.summary}</p>}
          <div className="dgrid">
            <div><small>Area</small><b>{g.zone_name ?? "Chennai"}</b></div>
            <div><small>Department concerned</small><b>{c.dept.name}</b></div>
            <div><small>Outlets reporting</small><b className="num">{outlets.size || g.outlets}</b></div>
            <div><small>First reported</small><b>{fmtShort(news[0]?.t ?? g.t)}</b></div>
          </div>
          <div>
            <div className="sec-t">Coverage ({news.length})</div>
            {news.map((s, k) => (
              <div key={k} className="osrc">
                <span className="sic t-high"><I n="news" /></span>
                <span style={{ minWidth: 0 }}>
                  <b>{s.name ?? "News outlet"}</b><small>News report · {fmtShort(s.t)}</small>
                  <q>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.note} ↗</a> : s.note}</q>
                </span>
              </div>
            ))}
            {!news.length && <div className="empty">No articles are linked to this grievance.</div>}
          </div>
        </div>
        <div className="odrawer-f"><button className="btn plain" onClick={() => onMode("off")}><I n="tasks" />Open the grievance</button></div>
      </aside>
    );
  }

  const busy = c.busy.has(g.id);
  const lastReturn = d.reports.find((r) => r.returned)?.returned ?? (g.returned ? { note: g.returnNote ?? "", t: g.updated } : null);
  return (
    <aside className="odrawer" role="dialog" aria-label={`Grievance ${g.id}`}>
      <div className="odrawer-h">{close}
        <div className="meta-row"><span className="num" style={{ color: "#fff", fontWeight: 700 }}>{g.id}</span><SevChip s={g.sev} /><StageChip r={g} /></div>
        <h2>{fullTitle(g)}</h2>
        <div className="meta-row"><I n="pin" />{where} · {c.dept.name}</div>
      </div>
      <div className="odrawer-b">
        <Steps stage={g.stage as Stage} />
        {g.returned && lastReturn && (
          <div className="banner" style={{ background: "var(--high-soft)", color: "#8A4A06" }}><I n="refresh" />
            <span><b>Returned by the Collector for rework.</b> {lastReturn.note || "No note was added."} Fix it on site, then complete and send again.</span>
          </div>
        )}
        {g.summary && <p style={{ margin: 0, color: "var(--text-2)" }}>{g.summary}</p>}
        <div className="dgrid">
          <div><small>Reported</small><b>{fmtShort(g.t)}</b></div>
          <div><small>First source</small><b>{d.firstSource}</b></div>
          <div><small>Linked complaints</small><b className="num">{g.complaints}</b></div>
          <div><small>Field officer</small><b>{g.officer ?? "—"}</b></div>
        </div>
        {d.reports.map((r, k) => (
          <ReportBlock key={r.id} r={r} title={k === 0 ? `Completion report from ${c.dept.name}` : `Earlier report · ${fmtShort(r.t)}`} />
        ))}
        <div>
          <div className="sec-t">Timeline</div>
          <ul className="vtl">
            {d.timeline.map((s, k) => (
              <li key={k} className={s.kind}><i /><time>{fmtShort(s.t)}</time><span>{s.label}{s.note ? <small>{s.note}</small> : null}</span></li>
            ))}
          </ul>
        </div>
        <div>
          <div className="sec-t">Sources ({d.sources.length})</div>
          {d.sources.map((s, k) => {
            const kind = SOURCE_KIND[s.kind] ?? SOURCE_KIND.grievance;
            return (
              <div key={k} className="osrc">
                <span className={`sic ${kind.tone}`}><I n={kind.ic} /></span>
                <span style={{ minWidth: 0 }}>
                  <b>{s.name ?? s.label}{s.first ? " · first report" : ""}</b>
                  <small>{s.label} · {fmtShort(s.t)}</small>
                  {s.note && <q>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.note} ↗</a> : s.note}</q>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="odrawer-f">
        {g.stage === "new" ? (
          <><button className="btn" disabled={busy} onClick={() => c.approve(g)}><I n="check" />Approve</button>
            <span className="hint">Approving moves it to In action and assigns it to {g.officer ?? "the field officer"}.</span></>
        ) : g.stage === "approved" || g.stage === "action" ? (
          <><button className="btn ok" disabled={busy} onClick={() => c.openSend(g)}><I n="send" />Complete &amp; send to Collector</button>
            <span className="hint">When the work is done: remarks and photos go to the Collector.</span></>
        ) : g.stage === "sent" ? (
          <span className="st st-await" style={{ padding: "8px 12px", display: "inline-flex", gap: 6, alignItems: "center" }}><I n="clock" />Waiting for the Collector&apos;s verification</span>
        ) : (
          <span className="chip sev-low" style={{ padding: "8px 12px" }}><I n="check" />Verified by Collector</span>
        )}
      </div>
    </aside>
  );
}
