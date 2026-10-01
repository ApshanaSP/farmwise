"use client";

/**
 * One answer: headline, the short answer, then the chart, tiles, map or table the answer
 * chose, with the evidence underneath (scope, as-of, sources, how it was calculated) and
 * what to do next (follow-up questions, console actions).
 */
import dynamic from "next/dynamic";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type * as Echarts from "echarts/core";
import { allowedTypes, defaultSpec, fmtValue, switchType } from "@/lib/assistant/chartspec";
import { canSpeak, speak, stopSpeaking } from "./speech";
import type { AnswerCard as Card, ChartSpec, ChartType, ConsoleAction, Dataset } from "@/lib/assistant/answer";
import type { Lang } from "@/lib/assistant/lang";
import type { MapGeo } from "@/lib/collector/geo";
import { I, type IconName } from "../icons";
import { mdToHtml } from "../Insights";
import { T, X } from "./text";

const ChartRenderer = dynamic(() => import("./ChartRenderer"), { ssr: false, loading: () => <div className="aq-chart-wait" /> });
const MapAnswer = dynamic(() => import("./MapAnswer"), { ssr: false, loading: () => <div className="aq-chart-wait" /> });

const TYPE_ICON: Partial<Record<ChartType, IconName>> = {
  horizontal_bar: "barH", bar: "chart", line: "line", area: "line", donut: "donut", grouped_bar: "chart", stacked_bar: "chart",
  map_zones: "map", map_wards: "map", map_points: "map", map_hotspots: "map", table: "table", heatmap: "layers", small_multiples: "grid", dumbbell: "compare", rose: "spark", treemap: "layers", gauge: "target"
};

export default memo(AnswerCard);

function AnswerCard({ card, geo, onAsk, onAction, expanded, onExpand, onPin }: {
  card: Card; geo: MapGeo | null; onAsk: (q: string) => void; onAction: (a: ConsoleAction) => void; expanded: boolean; onExpand: () => void;
  /** pin this answer; resolves true when saved */
  onPin?: (messageId: string) => Promise<boolean>;
}) {
  const t = T[card.language as Lang] ?? T.en;
  const [chart, setChart] = useState<ChartSpec | null>(card.chart);
  const [tableView, setTableView] = useState(card.display === "table");
  // which dataset the table shows: the answer's own list at first, then whichever view the Collector picked
  const [tableId, setTableId] = useState<string | null>(card.table);
  const [vote, setVote] = useState<1 | -1 | null>(null);
  const [pinned, setPinned] = useState(false);
  // the question decides: a chart, map or table only when it asked for one (a list, a chart, a graph, a map); otherwise words only
  const open = card.visualAsked === true || card.display === "table";
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const x = X[card.language as Lang] ?? X.en;
  const echart = useRef<Echarts.ECharts | null>(null);
  const ds = useMemo(() => card.datasets.find((d) => d.id === (chart?.dataset ?? card.table)) ?? card.datasets[0] ?? null, [card, chart]);
  const tableDs = card.datasets.find((d) => d.id === tableId) ?? ds;
  const activeId = tableView ? tableDs?.id : ds?.id;
  // an answer with several views of its data (localities, wards, types, map): tabs switch between them here, with no new question
  const tabs = card.datasets.length > 1 ? card.datasets.slice(0, 5) : [];
  const pick = (d: Dataset) => {
    if (card.chart?.dataset === d.id) { setChart(card.chart); setTableView(false); return; }
    const s = defaultSpec(d, card.datasets, card.chart);
    if (s) { setChart(s); setTableView(false); }
    else { setTableId(d.id); setTableView(true); }
  };
  useEffect(() => () => { if (speaking) stopSpeaking(); }, [speaking]);
  const readAloud = () => {
    if (speaking) { stopSpeaking(); setSpeaking(false); return; }
    if (speak(card.voiceSummary || card.headline, card.voiceLang, () => setSpeaking(false))) setSpeaking(true);
  };
  const copy = async () => {
    const plain = card.answerMarkdown.replace(/\*\*/g, "").replace(/^\s*[-*]\s+/gm, "• ");
    const body = [card.headline, card.answerMarkdown !== card.headline ? plain : "", card.scopeLine, ...card.caveats.map((c) => `Note: ${c}`)].filter(Boolean).join("\n\n");
    try { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ }
  };
  const isMap = !!chart && chart.type.startsWith("map");
  const panels = chart?.type === "small_multiples" && chart.series && ds ? Math.min(6, new Set(ds.rows.map((r) => String(r[chart.series!]))).size) : 0;
  const height = panels ? Math.ceil(panels / (panels <= 2 ? panels : panels <= 4 ? 2 : 3)) * (expanded ? 190 : 150)
    : expanded ? 420 : Math.min(360, Math.max(200, 44 + 26 * Math.min(11, ds?.rows.length ?? 6)));

  const drill = (key: string | number | null) => {
    if (!ds?.drill || key == null || !chart?.x) return;
    const row = ds.rows.find((r) => String(r[chart.x!]) === String(key));
    const v = row?.[ds.drill.field];
    if (v == null) return;
    const a = ds.drill.action;
    onAction({ action: a, label: "", zone: a === "filter_zone" ? Number(v) : null, dept: a === "filter_dept" ? String(v) : null, taluk: a === "filter_taluk" ? String(v) : null });
  };
  const feedback = async (rating: 1 | -1) => {
    setVote(rating);
    await fetch("/api/collector/assistant/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: card.id, insightKey: card.insightKey ?? null, rating }) }).catch(() => {});
  };
  const png = () => {
    const url = echart.current?.getDataURL({ pixelRatio: 2, backgroundColor: "#fff" });
    if (url) save(url, `district-iq-${slug(chart?.title ?? "chart")}.png`);
  };
  const csv = () => {
    const d = tableView ? tableDs : ds;
    if (!d) return;
    const cols = d.fields.filter((f) => f.kind !== "geo");
    const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const body = "﻿" + [cols.map((f) => cell(f.label)).join(","), ...d.rows.map((r) => cols.map((f) => cell(r[f.key])).join(","))].join("\n");
    save(URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" })), `district-iq-${slug(d.title)}.csv`);
  };

  const types = ds ? allowedTypes(ds).filter((x) => x !== "kpi" && TYPE_ICON[x]) : [];
  const kind = card.kind;
  // no page redirects from the chat (answers saved before this rule may still carry them)
  const actions = card.consoleActions.filter((a) => a.action !== "open_briefing" && a.action !== "save_briefing");
  const figure = open && !!ds && (!!chart || card.datasets.some((d) => d.rows.length > 0));

  return (
    <article className={`aq-card aq-${kind}`} aria-live="polite">
      <header className="aq-card-h">
        <h3>{card.headline}</h3>
        <div className="aq-badges">
          {card.testData && <span className="aq-badge test" title={t.testTip}><I n="alert" />{t.testData}</span>}
          {card.offline && <span className="aq-badge off" title={t.offlineTip}>{t.offline}</span>}
        </div>
      </header>
      {card.understood && <p className="aq-understood"><I n="info" />{t.understood}: <q>{card.understood}</q></p>}
      {card.answerMarkdown && card.answerMarkdown !== card.headline && <div className="aq-md md" dangerouslySetInnerHTML={{ __html: mdToHtml(card.answerMarkdown) }} />}
      {card.scopeLine && <p className="aq-scope"><I n="clock" />{card.scopeLine}</p>}

      {open && card.kpis.length > 0 && (card.display === "kpi" || tableView || !chart) && (
        <div className="aq-kpis">
          {card.kpis.map((k, i) => {
            const d = k.prev != null && k.prev !== 0 ? Math.round(((k.value - k.prev) / k.prev) * 100) : null;
            return (
              <div key={i} className={`aq-kpi ${k.tone ?? ""}`}>
                <small>{k.label}</small>
                <b>{fmtValue(k.value, k.format ?? (Number.isInteger(k.value) ? "integer" : "decimal1"), k.unit ?? null)}</b>
                {k.prev != null && <span>{d == null ? `${t.prev} ${fmtValue(k.prev, k.format ?? "integer")}` : `${d > 0 ? "▲" : d < 0 ? "▼" : "•"} ${Math.abs(d)}% ${t.vsPrev}`}</span>}
              </div>
            );
          })}
        </div>
      )}

      {figure && ds && (
        <figure className="aq-fig">
          {tabs.length > 0 && (
            <div className="aq-tabs" role="tablist" aria-label={t.views}>
              {tabs.map((d) => (
                <button key={d.id} role="tab" aria-selected={activeId === d.id} className={activeId === d.id ? "on" : ""} onClick={() => pick(d)} title={d.title}>
                  {d.tab ?? d.title}
                </button>
              ))}
            </div>
          )}
          {chart && !tableView && <figcaption><b>{chart.title}</b>{chart.subtitle && <span>{chart.subtitle}</span>}</figcaption>}
          <div className="aq-tools" role="toolbar" aria-label={t.chartTools}>
            {chart && types.map((x) => (
              <button key={x} className={!tableView && chart.type === x ? "on" : ""} title={t.types[x] ?? x} aria-label={t.types[x] ?? x}
                onClick={() => { if (x === "table") { setTableId(ds?.id ?? null); setTableView(true); } else { setTableView(false); setChart(switchType(chart, x, card.datasets)); } }}>
                <I n={TYPE_ICON[x]!} />
              </button>
            ))}
            {!chart && <span className="aq-tools-l">{t.table}</span>}
            <span className="sp" />
            {!isMap && !tableView && chart && <button onClick={png} title={t.png} aria-label={t.png}><I n="photo" /></button>}
            <button onClick={csv} title={t.csv} aria-label={t.csv}><I n="download" /></button>
            <button onClick={onExpand} title={expanded ? t.shrink : t.expand} aria-label={expanded ? t.shrink : t.expand}><I n="expand" /></button>
          </div>
          {tableView || !chart ? <DataTable ds={tableDs ?? ds} lang={card.language as Lang} onOpen={(id) => onAction({ action: "open_incident", label: "", id })} />
            : isMap ? <MapAnswer spec={chart} ds={ds} geo={geo} height={height + 40} onZone={(z) => onAction({ action: "filter_zone", label: "", zone: z })} />
              : <ChartRenderer spec={chart} ds={ds} lang={card.language as Lang} height={height} onDrill={drill} onReady={(e) => { echart.current = e; }} />}
          {ds.normal && chart?.normalBand && !tableView && <p className="aq-note"><i className="band" />{t.usual}: {fmtValue(ds.normal.lo)}–{fmtValue(ds.normal.hi)} ({ds.normal.basis})</p>}
          {ds.total != null && ds.total > ds.rows.length && <p className="aq-note">{t.showing(ds.rows.length, ds.total)}</p>}
        </figure>
      )}

      {card.download && <a className="aq-dl" href={card.download.href} download><I n="download" />{card.download.label}</a>}
      {card.caveats.length > 0 && <ul className="aq-cav">{card.caveats.map((x, i) => <li key={i}><I n="info" />{x}</li>)}</ul>}
      {card.chips.length > 0 && <div className="aq-chips">{card.chips.map((q) => <button key={q} onClick={() => onAsk(q)}>{q}</button>)}</div>}
      {actions.length > 0 && (
        <div className="aq-acts">{actions.map((a, i) => <button key={i} className="btn sm" onClick={() => onAction(a)}><I n={actionIcon(a)} />{a.label}</button>)}</div>
      )}
      {card.followUps.length > 0 && (
        <div className="aq-follow"><small>{t.next}</small>{card.followUps.map((q) => <button key={q} onClick={() => onAsk(q)}><I n="right" />{q}</button>)}</div>
      )}
      <Sources card={card} t={t} onOpen={(id) => onAction({ action: "open_incident", label: "", id })} />
      {(kind === "answer" || kind === "action") && (
        <footer className="aq-foot">
          {canSpeak() && (card.voiceSummary || card.headline) && (
            <button className={speaking ? "on" : ""} onClick={readAloud} title={speaking ? t.stopReading : t.readAloud} aria-label={speaking ? t.stopReading : t.readAloud} aria-pressed={speaking}>
              <I n={speaking ? "stop" : "volume"} /></button>
          )}
          <button className={copied ? "on" : ""} onClick={copy} title={copied ? t.copied : t.copy} aria-label={copied ? t.copied : t.copy}><I n={copied ? "check" : "copy"} /></button>
          <span className="sp" />
          <span>{t.helpful}</span>
          <button className={vote === 1 ? "on" : ""} onClick={() => feedback(1)} aria-pressed={vote === 1} aria-label={t.yes}><I n="thumbUp" /></button>
          <button className={vote === -1 ? "on" : ""} onClick={() => feedback(-1)} aria-pressed={vote === -1} aria-label={t.no}><I n="thumbDown" /></button>
          {onPin && kind === "answer" && card.datasets.length > 0 && (
            <button className={`aq-pin${pinned ? " on" : ""}`} disabled={pinned} title={pinned ? x.pinnedOk : x.pin} aria-label={pinned ? x.pinnedOk : x.pin}
              onClick={async () => setPinned(await onPin(card.id))}><I n="bookmark" />{pinned ? x.pinnedOk : ""}</button>
          )}
        </footer>
      )}
    </article>
  );
}

function actionIcon(a: ConsoleAction): IconName {
  return a.action === "open_incident" ? "ext" : a.action === "open_briefing" ? "doc" : a.action === "save_briefing" ? "bookmark" : a.action === "open_story" ? "news" : a.action === "show_on_map" ? "map"
    : a.action === "set_period" ? "clock" : "sliders";
}

function Sources({ card, t, onOpen }: { card: Card; t: (typeof T)["en"]; onOpen: (id: string) => void }) {
  const s = card.sources;
  if (!s || (card.kind !== "answer" && card.kind !== "action")) return null;
  return (
    <details className="aq-src">
      <summary><I n="layers" />{t.sources}</summary>
      <dl>
        {card.asOf && <><dt>{t.asOf}</dt><dd>{card.asOf}{card.scopeLine ? ` · ${card.scopeLine}` : ""}</dd></>}
        {s.tools.length > 0 && <><dt>{t.tools}</dt><dd>{s.tools.map((x) => <code key={x.name + JSON.stringify(x.args)}>{x.name}({argText(x.args)}) {x.ms} ms</code>)}</dd></>}
        {s.refs.length > 0 && <><dt>{t.data}</dt><dd>{[...new Set(s.refs.map((r) => r.name))].join(", ")}</dd></>}
        {s.sql.length > 0 && <><dt>SQL</dt><dd>{s.sql.map((q, i) => <pre key={i}>{q.text}{"\n-- "}{JSON.stringify(q.params)}</pre>)}</dd></>}
        {s.rows > 0 && <><dt>{t.rows}</dt><dd>{s.rows.toLocaleString("en-IN")}</dd></>}
        {s.incidentIds.length > 0 && <><dt>{t.incidents}</dt><dd className="ids">{s.incidentIds.slice(0, 12).map((id) => <button key={id} onClick={() => onOpen(id)}>{id}</button>)}
          {s.incidentIds.length > 12 ? ` +${s.incidentIds.length - 12}` : ""}</dd></>}
        <dt>{t.testData}</dt><dd>{card.testData ? t.testYes : t.testNo}</dd>
        {s.models.length > 0 && <><dt>{t.models}</dt><dd>{s.models.map((m) => `${m.step}: ${m.provider}/${m.model} (${m.ms} ms, ${m.inTokens != null ? `${m.inTokens} in + ${m.outTokens} out` : `${m.tokens}`} tokens)`).join(" · ")}</dd></>}
        <dt>{t.numbers}</dt><dd>{s.verifier.template ? t.template : s.verifier.checked ? t.verified(s.verifier.checked, s.verifier.regenerated) : t.noNumbers}</dd>
        {s.assumptions.length > 0 && <><dt>{t.assumptions}</dt><dd><ul>{s.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></dd></>}
        {s.limits.length > 0 && <><dt>{t.notes}</dt><dd><ul>{s.limits.map((a, i) => <li key={i}>{a}</li>)}</ul></dd></>}
      </dl>
    </details>
  );
}

const argText = (a: Record<string, unknown>) => Object.entries(a).map(([k, v]) => {
  if (k === "scope" && v && typeof v === "object") return Object.entries(v as Record<string, unknown>).filter(([, x]) => x != null).map(([kk, x]) => `${kk}=${x}`).join(", ");
  return v == null ? "" : `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`;
}).filter(Boolean).join(", ");

function DataTable({ ds, lang, onOpen }: { ds: Dataset; lang: Lang; onOpen: (id: string) => void }) {
  const [more, setMore] = useState(false);
  const t = T[lang] ?? T.en;
  const cols = ds.fields.filter((f) => f.kind !== "geo" && !(f.kind === "id" && f.key !== ds.idField && f.key !== "id"));
  const rows = ds.rows.slice(0, more ? 100 : 20);
  return (
    <div className="aq-table">
      <table>
        <caption className="sr">{ds.title}</caption>
        <thead><tr>{cols.map((f) => <th key={f.key} className={f.kind === "value" ? "num" : ""}>{f.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((f) => {
                const v = r[f.key];
                if ((f.key === ds.idField || f.key === "id") && typeof v === "string" && /^INC-/.test(v)) return <td key={f.key}><button className="lnk" onClick={() => onOpen(v)}>{v}</button></td>;
                return <td key={f.key} className={f.kind === "value" ? "num" : ""}>{f.kind === "value" ? fmtValue(v == null ? null : Number(v), f.format ?? "integer", f.unit ?? null) : v == null ? "—" : String(v)}</td>;
              })}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={cols.length}>{t.none}</td></tr>}
        </tbody>
      </table>
      {!more && ds.rows.length > 20 && <button className="lnk aq-more" onClick={() => setMore(true)}>{t.more}</button>}
    </div>
  );
}

function save(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  if (href.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(href), 2000);
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "data";
