"use client";

import { useState } from "react";
import type { Overview as OverviewData } from "@/lib/collector/intel";
import type { Thread, ThreadStep } from "@/lib/collector/threads";
import { I } from "./icons";
import { Empty, SEV_HEX, fmtDate, fmtDay, fmtTime } from "./lib";
import { itemWhen, safeUrl } from "./Added";
import type { Console } from "./CollectorApp";

export const STAGE_COL: Record<string, string> = {
  "First report": "#1560E8", Arrest: "#6A55D8", Death: "#D92D35", Court: "#475569", Probe: "#0891B2", Protest: "#E0730D",
  Action: "#12925F", Warning: "#B98A00", Completed: "#0E7C50", Update: "#6F82A6"
};

const span = (h: number) => (h < 1 ? "within the hour" : h < 36 ? `over ${h} h` : `over ${Math.round(h / 24)} days`);
const where = (t: Thread, c: Console) => t.place ?? (t.zones.length === 1 ? c.zoneNameOf(t.zones[0]) : null) ?? "Chennai";

/** Stage chips in order: "First report 27 Sep → Arrest 27 Sep → Death 28 Sep". */
function StageStrip({ t, max = 4 }: { t: Thread; max?: number }) {
  const st = t.stages.length > max ? [...t.stages.slice(0, max - 1), t.stages[t.stages.length - 1]] : t.stages;
  const updates = t.days.reduce((a, d) => a + d.steps.filter((s) => s.stage === "Update").length, 0);
  return (
    <span className="thr-steps">
      {st.map((s, k) => (
        <span key={s.stage} className="stg-w">
          {k > 0 && <I n="right" />}
          <span className="stg" style={{ color: STAGE_COL[s.stage], background: `${STAGE_COL[s.stage]}14` }}>{s.stage}<em>{fmtDate(s.t)}</em></span>
        </span>
      ))}
      {updates > 0 && <span className="stg-more">+{updates} update{updates === 1 ? "" : "s"}</span>}
    </span>
  );
}

/** Environment & markets page card: the developing stories, newest update first. */
export function StoriesCard({ d, c }: { d: OverviewData; c: Console }) {
  const { threads, days, total } = d.stories;
  return (
    <>
      <div className="ch"><I n="clock" /><h3 title={`The same event reported again as it developed, last ${days} days`}>Developing stories <span>· same event over time</span></h3>
        <span className="cnt-b">{total}</span>
        <button className="more" onClick={() => c.openStories(null)}>See all<I n="right" /></button>
      </div>
      <div className="fitlist">
        {threads.length ? threads.map((t) => (
          <button key={t.id} className="thr" onClick={() => c.openStories(t.id)} title="See what happened, in order">
            <span className="thr-h">
              <b title={t.title}>{t.title}</b>
              <span className="thr-n">{t.reports} reports · {t.outlets.length} outlet{t.outlets.length === 1 ? "" : "s"}</span>
            </span>
            <span className="thr-m">
              <StageStrip t={t} max={3} />
              <span className="thr-w">
                {t.sev && <i style={{ background: SEV_HEX[t.sev] }} />}
                {[where(t, c), t.catLabel, span(t.hours), `latest ${itemWhen(t.last, d.now)}`].filter(Boolean).join(" · ")}
              </span>
            </span>
          </button>
        )) : <Empty>No event was reported more than once in the last {days} days in this scope.</Empty>}
      </div>
    </>
  );
}

/** Full view: the list of stories on the left, the chosen story's reports in time order on the right. */
export function StoriesBody({ d, c, focus }: { d: OverviewData; c: Console; focus: string | null }) {
  const list = d.stories.threads;
  const [sel, setSel] = useState<string | null>(focus ?? list[0]?.id ?? null);
  const t = list.find((x) => x.id === sel) ?? list[0];
  if (!t) return <Empty>No developing stories in this scope.</Empty>;
  return (
    <div className="thv">
      <div className="thv-l">
        <div className="thv-note">
          Reports are threaded when they share a story or an incident, or when their headlines name the same people or places within four days.
          Each report is labelled by what it says happened.
        </div>
        {list.map((x) => (
          <button key={x.id} className={`thv-i${x.id === t.id ? " on" : ""}`} onClick={() => setSel(x.id)}>
            <b>{x.title}</b>
            <small>{where(x, c)} · {x.reports} reports · {fmtDate(x.first)}{x.first.slice(0, 10) !== x.last.slice(0, 10) ? ` – ${fmtDate(x.last)}` : ""}</small>
          </button>
        ))}
      </div>
      <div className="thv-r">
        <h3>{t.title}</h3>
        <div className="thv-meta">
          <span><I n="pin" />{where(t, c)}</span>
          {t.catLabel && <span><I n="doc" />{t.catLabel}</span>}
          <span><I n="clock" />{fmtDay(t.first)} {fmtTime(t.first)} → {fmtDay(t.last)} {fmtTime(t.last)} ({span(t.hours)})</span>
          <span><I n="news" />{t.reports} reports from {t.outlets.length} outlet{t.outlets.length === 1 ? "" : "s"}{t.added ? `, ${t.added} from added sources` : ""}</span>
        </div>
        <div className="thv-sum">
          <b>What happened:</b> <StageStrip t={t} max={8} />
        </div>
        {t.incidents.length > 0 && (
          <div className="thv-inc">
            Linked incident{t.incidents.length === 1 ? "" : "s"}:
            {t.incidents.map((id) => <button key={id} className="lnk" onClick={() => c.openInc(id)}>{id}</button>)}
            {t.open != null && <span className="dim"> · {t.open ? "still open" : "closed"}</span>}
          </div>
        )}
        <ol className="tl2">
          {t.days.map((g, k) => (
            <li key={g.day}>
              <div className="tl2-d">Day {dayNo(t.first, g.day)} · {fmtDay(g.day + " 00:00:00")}</div>
              {g.steps.map((s, j) => <Step key={j} s={s} c={c} first={k === 0 && j === 0} />)}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

const dayNo = (first: string, day: string) => Math.round((Date.parse(day) - Date.parse(first.slice(0, 10))) / 864e5) + 1;

function Step({ s, c, first }: { s: ThreadStep; c: Console; first: boolean }) {
  const url = safeUrl(s.url);
  const col = STAGE_COL[s.stage] ?? STAGE_COL.Update;
  return (
    <div className="tl2-s" style={{ "--c": col } as React.CSSProperties}>
      <span className="tl2-t">{fmtTime(s.t)}</span>
      <span className="tl2-b">
        <span className="stg" style={{ color: col, background: `${col}14` }}>{s.stage}</span>
        {url ? <a href={url} target="_blank" rel="noopener noreferrer" className={first ? "strong" : undefined}>{s.title}<I n="ext" /></a> : <b>{s.title}</b>}
        <small>
          {[s.publisher, ...s.also].filter(Boolean).join(", ") || "News"}
          {s.added && <span className="tg-add">added source</span>}
          {s.incident && <button className="lnk" onClick={() => c.openInc(s.incident!)}>open incident</button>}
        </small>
      </span>
    </div>
  );
}
