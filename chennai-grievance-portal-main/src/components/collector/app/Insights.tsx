"use client";

import { useState } from "react";
import type { Insights } from "@/lib/collector/insights";
import { I } from "./icons";
import { Empty, SEV_HEX, SevChip, deptIcon, fmtDate, fmtShort, rel, sevTone, type Row } from "./lib";
import type { Console } from "./CollectorApp";
import { itemWhen, itemWhere } from "./Added";

const Loading = () => <div className="empty" style={{ margin: "auto" }}><I n="refresh" className="spin" />Preparing…</div>;

// ================================================================ briefing ==

export function BriefingPage({ ins, c }: { ins: Insights | null; c: Console }) {
  if (!ins) return <section className="p3"><article className="card" style={{ gridColumn: "1 / -1" }}><Loading /></article></section>;
  const b = ins.briefing;
  return (
    <section className="p3">
      <article className="card bf" style={{ gridColumn: "span 7", gridRow: "span 2" }}>
        <div className="ch"><I n="doc" /><h3>Collector&apos;s Briefing <span>· {ins.scope} · {c.periodLabel.toLowerCase()}</span></h3>
          <button className="more" onClick={() => c.showText("Collector's Briefing", b.md)} title="Read the whole briefing"><I n="doc" />Full text</button>
          <button className="more" onClick={() => download(`district-iq-briefing-${c.period}.md`, b.md)} title="Download as text"><I n="download" />Download</button>
          <button className="more" onClick={() => c.openWorkspace()} title="Save this view with a frozen copy of the briefing"><I n="layers" />Save</button>
        </div>
        {c.archived && <ArchivedBanner c={c} />}
        {c.archived ? <div className="bf-body md" dangerouslySetInnerHTML={{ __html: mdToHtml(c.archived.markdown) }} /> : (
          <div className="bf2">
            <div className="bf2-stats">
              <Stat l="Reported" v={b.stats.reported} sub={b.stats.change == null ? "no earlier data" : b.stats.change === 0 ? "same as before" : `${b.stats.change > 0 ? "▲" : "▼"} ${Math.abs(b.stats.change)}% vs. previous period`}
                tone={b.stats.change != null && b.stats.change > 0 ? "bad" : "ok"} />
              <Stat l="Still open" v={b.stats.open} sub="incidents not yet closed" />
              <Stat l="Past deadline" v={b.stats.overdue} sub="open beyond the service deadline" tone={b.stats.overdue ? "bad" : "ok"} />
              <Stat l="Severe" v={b.stats.severe} sub="severe events reported" tone={b.stats.severe ? "bad" : "ok"} />
            </div>

            <div className="bf2-cond">
              {b.env.rain != null && <span><I n="cloud" /><b>Rain</b> {b.env.rain} mm in 24 h</span>}
              {b.env.aqi != null && <span><I n="wind" /><b>Air</b> AQI {b.env.aqi} ({b.env.aqi <= 50 ? "good" : b.env.aqi <= 100 ? "satisfactory" : b.env.aqi <= 200 ? "moderate" : "poor"})</span>}
              {b.env.lakes != null && <span><I n="drop" /><b>Reservoirs</b> {b.env.lakes}% full</span>}
              {b.stats.newsOnly > 0 && <span><I n="news" /><b>{b.stats.newsOnly}</b> seen only in the news</span>}
            </div>
            {b.market.length > 0 && <div className="bf2-market"><I n="chart" /><span><b>Vegetable prices:</b> {b.market[0]}.</span></div>}

            <h4 className="bf2-h"><span>1</span>Needs your attention <small>{b.attention.length} open incident{b.attention.length === 1 ? "" : "s"}, most urgent first</small></h4>
            {b.attention.length ? (
              <ol className="bf2-list">
                {b.attention.map((a, k) => (
                  <li key={a.id} style={{ "--c": SEV_HEX[a.sev] } as React.CSSProperties}>
                    <div className="bf2-top">
                      <i className="bf2-n">{k + 1}</i>
                      <button className="bf2-t" onClick={() => c.openInc(a.id)} title="Open the incident">{a.title}</button>
                      <SevChip s={a.sev} />
                    </div>
                    <div className="bf2-where">
                      <span><I n="pin" />{a.zone ?? "Chennai"}</span><span><I n="gov" />{a.dept}</span><span>{a.status}</span>
                      {a.overdue && <span className="bf2-late">Past deadline</span>}
                    </div>
                    <div className="bf2-why">
                      <b>Why it matters</b>
                      <ul>{[...a.why.what, ...a.why.why].slice(0, 3).map((w) => <li key={w}>{w}</li>)}</ul>
                    </div>
                    {a.next && (
                      <div className="bf2-next">
                        <b>Next step</b>
                        <span>{a.next.text}{a.next.owner ? <> — <em>{a.next.owner}</em></> : null}{a.next.due ? <>, due <em>{fmtShort(a.next.due)}</em></> : null}</span>
                      </div>
                    )}
                    <div className="bf2-ev">Based on {a.evidence}{a.confidence != null ? ` · ${Math.round(a.confidence * 100)}% sure of the match and place` : ""}</div>
                  </li>
                ))}
              </ol>
            ) : <Empty>No open incident needs your attention in this scope.</Empty>}

            <h4 className="bf2-h"><span>2</span>From added sources
              <small>{b.addedCount ? `${b.addedCount} item${b.addedCount === 1 ? "" : "s"} in the last ${b.addedDays} days` : `none in the last ${b.addedDays} days`}</small>
              <button className="lnk" onClick={() => (b.addedCount ? c.openAdded() : c.openSources("add"))}>{b.addedCount ? "See all ›" : "Add a source ›"}</button>
            </h4>
            <div className="bf2-src">
              {b.fromSources.slice(0, 4).map((i) => (
                <button key={i.item_id} onClick={() => c.openItem(i)} title="Open the item and its source link">
                  <i className={i.is_incident ? "civic" : ""} />
                  <b>{i.title}</b>
                  <small>{[i.source, itemWhere(i), i.category_label, itemWhen(i.t, ins.now)].filter(Boolean).join(" · ")}</small>
                </button>
              ))}
            </div>

            {b.emerging.length > 0 && (
              <>
                <h4 className="bf2-h"><span>3</span>Unusual rises <small>more reports than usual for the place and day</small></h4>
                <ul className="bf2-em">{b.emerging.slice(0, 4).map((e, k) => <li key={k}>{e.text}</li>)}</ul>
              </>
            )}
            <p className="bf-note">{b.method}</p>
          </div>
        )}
      </article>

      <article className="card" style={{ gridColumn: "span 5" }}>
        <DeptFollowUps ins={ins} c={c} />
      </article>
      <article className="card" style={{ gridColumn: "span 5" }}>
        <NewsGaps ins={ins} c={c} />
      </article>
    </section>
  );
}

function Stat({ l, v, sub, tone }: { l: string; v: number; sub: string; tone?: "ok" | "bad" }) {
  return (
    <div className={`bf2-stat${tone ? " " + tone : ""}`}>
      <small>{l}</small>
      <b>{v.toLocaleString("en-IN")}</b>
      <span>{sub}</span>
    </div>
  );
}

function ArchivedBanner({ c }: { c: Console }) {
  const a = c.archived!;
  return (
    <div className="banner teal" style={{ margin: "0 14px 8px" }}>
      <I n="clock" />
      <span>Saved version: <b>{a.name} v{a.version}</b>, frozen {fmtShort(a.issued_at)} (data as of {fmtShort(a.as_of)}).</span>
      <button className="lnk" style={{ marginLeft: "auto" }} onClick={() => c.closeArchived()}>Back to live</button>
    </div>
  );
}

function DeptFollowUps({ ins, c }: { ins: Insights; c: Console }) {
  const [open, setOpen] = useState<string | null>(ins.deptActions[0]?.code ?? null);
  return (
    <>
      <div className="ch"><I n="tasks" /><h3>Department follow-ups <span>· proposed next steps</span></h3><span className="cnt-b">{ins.deptActions.length}</span></div>
      <div className="cb dfu">
        {ins.deptActions.length ? ins.deptActions.map((d) => (
          <div key={d.code} className={`dfu-d${open === d.code ? " on" : ""}`}>
            <button className="dfu-h" onClick={() => setOpen(open === d.code ? null : d.code)}>
              <span className="bic t-info" style={{ width: 30, height: 30 }}><I n={deptIcon(d.code)} /></span>
              <b>{d.name}</b>
              <span className="dfu-n" title="Open incidents">{d.open} open</span>
              {d.overdue > 0 && <span className="dfu-n late" title="Past deadline">{d.overdue} late</span>}
              {d.awaiting > 0 && <span className="dfu-n ok" title="Waiting for your verification">{d.awaiting} to verify</span>}
              <I n={open === d.code ? "chevd" : "chevr"} />
            </button>
            {open === d.code && (
              <ul>
                {d.followUps.map((f) => (
                  <li key={f.id} onClick={() => c.openInc(f.id)}>
                    <i style={{ background: SEV_HEX[f.sev] }} />
                    <span><b>{f.title}</b>{f.next ? <small>{f.next.text}{f.next.due ? ` · due ${fmtShort(f.next.due)}` : ""}{f.overdue ? " · past deadline" : ""}</small> : null}</span>
                  </li>
                ))}
                <li className="dfu-all"><button className="lnk" onClick={() => c.setDept(d.code)}>Filter the dashboard to {d.name} ›</button></li>
              </ul>
            )}
          </div>
        )) : <Empty>No open work in this scope.</Empty>}
      </div>
    </>
  );
}

function NewsGaps({ ins, c }: { ins: Insights; c: Console }) {
  const [multi, setMulti] = useState(false);
  const rows = ins.gaps.filter((g) => !multi || Number(g.outlet_count) >= 2);
  return (
    <>
      <div className="ch"><I n="news" /><h3>In the news, not in department records</h3>
        <label className="tgl"><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />2+ outlets</label>
        <span className="cnt-b">{rows.length}</span>
      </div>
      <div className="fitlist">
        {rows.length ? rows.map((g) => (
          <button key={g.id} className="rt" onClick={() => c.openInc(g.id)}>
            <span className={`bic ${sevTone(g.sev)}`}><I n={deptIcon(g.dept)} /></span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <b title={g.title}>{g.title || g.type}</b>
              <small>{g.zone_name ?? "Chennai"} · {g.dept_name ?? g.dept} · {rel(g.t, ins.now)}</small>
              {g.suggested_action && <small style={{ color: "var(--accent-2)" }}>Suggested: {g.suggested_action}</small>}
            </span>
          </button>
        )) : <Empty>Every news report in this scope has a department record.</Empty>}
      </div>
    </>
  );
}

// ================================================================== trends ==


export function TrendsPage({ ins, c }: { ins: Insights | null; c: Console }) {
  const [mode, setMode] = useState<"weekly" | "monthly">("weekly");
  if (!ins) return <section className="p3"><article className="card" style={{ gridColumn: "1 / -1" }}><Loading /></article></section>;
  const t = ins.trends[mode];
  const maxT = Math.max(1, ...ins.taluks.map((x) => x.open));
  return (
    <section className="p3 trends">
      <article className="card" style={{ gridColumn: "span 8" }}>
        <div className="ch"><I n="chart" /><h3>Which problems are rising? <span>· incidents by category · click one to filter everything</span></h3>
          <div className="seg sm" style={{ marginLeft: "auto" }}>
            {(["weekly", "monthly"] as const).map((m) => <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{m === "weekly" ? "By week" : "By month"}</button>)}
          </div>
        </div>
        <CategoryRows t={t} mode={mode} c={c} />
      </article>

      <article className="card" style={{ gridColumn: "span 4" }}>
        <div className="ch"><I n="pin" /><h3>Taluks: unresolved <span>· last 30 days · click to filter</span></h3></div>
        <div className="fitlist">
          {ins.taluks.filter((x) => x.open > 0).map((x) => {
            const d = x.prev ? Math.round(((x.reported - x.prev) / x.prev) * 100) : null;
            return (
              <button key={x.code} className={`tk${c.taluk === x.code ? " on" : ""}`} onClick={() => c.setTaluk(c.taluk === x.code ? null : x.code)}
                title={c.taluk === x.code ? "Clear the taluk filter" : `Filter everything to ${x.name} taluk`}>
                <span className="tk-l"><b>{x.name}</b><small>{x.severe ? `${x.severe} severe · ` : ""}{x.overdue} past deadline</small></span>
                <span className="tk-b"><i style={{ width: `${(x.open / maxT) * 100}%` }} /></span>
                <b className="tk-v">{x.open}</b>
                <span className={`tk-d ${d != null && d > 0 ? "up" : d != null && d < 0 ? "down" : ""}`}
                  title={`${x.reported} incidents reported in the last 30 days, ${x.prev} in the 30 days before`}>{d == null || d === 0 ? "–" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d)}%`}</span>
              </button>
            );
          })}
        </div>
      </article>

      <article className="card" style={{ gridColumn: "span 4" }}>
        <div className="ch"><I n="bolt" /><h3>Emerging: unusual spikes</h3><span className="cnt-b">{ins.patterns.emerging.length}</span></div>
        <div className="fitlist">
          {ins.patterns.emerging.length ? ins.patterns.emerging.map((e, k) => (
            <button key={k} className="rt" onClick={() => { c.setCat(e.cat); if (e.zone) c.setZone(Number(e.zone)); }} title="Filter to this category and zone">
              <span className="bic t-high"><I n="bolt" /></span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <b>{e.label} in {e.zone_name ?? "the district"}</b>
                <small>{e.observed} reports on {fmtDate(e.date + " 00:00:00")}, about {Number(e.expected).toFixed(1)} expected ({Number(e.ratio).toFixed(1)}×)</small>
              </span>
            </button>
          )) : <Empty>No unusual spikes in the last three weeks.</Empty>}
        </div>
      </article>
      <article className="card" style={{ gridColumn: "span 4" }}>
        <div className="ch"><I n="refresh" /><h3>Recurring hotspots</h3><span className="cnt-b">{ins.patterns.hotspots.length}</span></div>
        <div className="fitlist">
          {ins.patterns.hotspots.length ? ins.patterns.hotspots.map((h) => (
            <button key={h.id} className="rt" onClick={() => { c.setCat(h.cat); if (h.zone) c.setZone(Number(h.zone)); }} title="Filter to this category and zone">
              <span className="bic t-violet"><I n="pin" /></span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <b title={h.top_place}>{h.label}: {h.top_place}</b>
                <small>{h.incidents_30d} in 30 days · {h.incidents} since {fmtDate(h.first_seen + " 00:00:00")} · {h.open} open{h.zone_name ? ` · ${h.zone_name}` : ""}</small>
              </span>
            </button>
          )) : <Empty>No recurring hotspot in this scope.</Empty>}
        </div>
      </article>
      <article className="card" style={{ gridColumn: "span 4" }}>
        <div className="ch"><I n="alert" /><h3>Locations needing review</h3><span className="cnt-b">{ins.review.unplaced.length}</span></div>
        <div className="rv-sum">
          <span><b>{ins.review.unplaced.length}</b> open incidents could not be placed on the map</span>
          <span><b>{ins.review.links}</b> uncertain report links are queued for review</span>
        </div>
        <div className="fitlist">
          {ins.review.unplaced.length ? ins.review.unplaced.map((i) => (
            <button key={i.id} className="rt" onClick={() => c.openInc(i.id)}>
              <span className={`bic ${sevTone(i.sev)}`}><I n="pin" /></span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <b title={i.title}>{i.title || i.type}</b>
                <small>Place given: {i.loc || "none"} · {String(i.sources).replace(/\|/g, ", ")}</small>
              </span>
            </button>
          )) : <Empty>Every open incident has a location.</Empty>}
        </div>
      </article>
    </section>
  );
}

/**
 * One row per category: total, a bar per week (or month), the latest complete bucket, and
 * the change between the recent half and the half before it, so a rise reads at a glance.
 */
function CategoryRows({ t, mode, c }: { t: Insights["trends"]["weekly"]; mode: "weekly" | "monthly"; c: Console }) {
  // the current month is still running: compare complete months only
  const complete = mode === "monthly" ? t.keys.length - 1 : t.keys.length;
  const half = mode === "weekly" ? 4 : 2;
  const unit = mode === "weekly" ? "week" : "month";
  const label = (k: string) => (mode === "weekly" ? `week of ${fmtDate(k + " 00:00:00")}` : new Date(k + "-01T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" }));
  const rows = t.lines.map((l) => {
    const v = l.values.slice(0, complete);
    const recent = v.slice(-half).reduce((a, b) => a + b, 0), before = v.slice(-2 * half, -half).reduce((a, b) => a + b, 0);
    const chg = before ? Math.round(((recent - before) / before) * 100) : recent ? null : 0;
    return { ...l, last: v[v.length - 1] ?? 0, recent, before, chg };
  });
  const real = rows.filter((r) => r.cat !== "OTHERS" && r.before >= 5);
  const up = [...real].sort((a, b) => (b.chg ?? 0) - (a.chg ?? 0))[0];
  const down = [...real].sort((a, b) => (a.chg ?? 0) - (b.chg ?? 0))[0];
  const mx = Math.max(1, ...rows.flatMap((r) => r.values));
  return (
    <div className="tr2">
      <p className="tr2-lead">
        {up && (up.chg ?? 0) > 0
          ? <>Biggest rise: <b>{up.label}</b>, {up.recent.toLocaleString("en-IN")} incidents in the last {half} {unit}s, <b>up {up.chg}%</b> on the {half} {unit}s before ({up.before.toLocaleString("en-IN")}). </>
          : <>No category rose in the last {half} {unit}s. </>}
        {down && (down.chg ?? 0) < 0 ? <>Biggest fall: <b>{down.label}</b>, <b>down {Math.abs(down.chg ?? 0)}%</b>.</> : null}
      </p>
      <div className="tr2-head"><span>Category</span><span style={{ textAlign: "right" }}>Total</span>
        <span title={`${label(t.keys[0])} to ${mode === "weekly" ? "last week" : "this month"}`}>Incidents per {unit}, last {t.keys.length} {unit}s</span>
        <span style={{ textAlign: "right" }}>Last {unit}</span><span style={{ textAlign: "center" }}>Change</span></div>
      {rows.map((r) => {
        const other = r.cat === "OTHERS";
        const on = c.cat === r.cat;
        const cls = r.chg == null ? "up" : r.chg > 5 ? "up" : r.chg < -5 ? "down" : "flat";
        return (
          <button key={r.cat} className={`tr2-row${on ? " on" : ""}${c.cat && !on ? " dim" : ""}`} disabled={other}
            onClick={() => c.setCat(on ? null : r.cat)}
            title={other ? "Categories outside the top six" : on ? "Clear the category filter" : `Show only ${r.label} across the dashboard`}>
            <span className="tr2-name">{r.label}</span>
            <span className="tr2-tot">{r.total.toLocaleString("en-IN")}</span>
            <span className="tr2-bars">
              {r.values.map((v, k) => <i key={k} className={k === complete - 1 ? "cur" : ""} style={{ height: `${Math.max(4, (v / mx) * 100)}%`, opacity: k >= complete ? 0.4 : 1 }}
                title={`${label(t.keys[k])}: ${v.toLocaleString("en-IN")} incidents${k >= complete ? " (so far)" : ""}`} />)}
            </span>
            <span className="tr2-last"><b>{r.last.toLocaleString("en-IN")}</b></span>
            <span className={`tr2-chg ${cls}`} title={`${r.recent} in the last ${half} ${unit}s, ${r.before} in the ${half} before`}>
              {r.chg == null ? "new" : r.chg === 0 ? "no change" : `${r.chg > 0 ? "▲" : "▼"} ${Math.abs(r.chg)}%`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ================================================================= markets ==

/** Rs per quintal to ₹ per kg: whole rupees from ₹10 up, one decimal below. */
const kg = (v: number | null | undefined, dec?: number) => (v == null ? "—" : `₹${(v / 100).toFixed(dec ?? (v >= 1000 ? 0 : 1))}`);

/**
 * Mandi prices. "Chennai markets" compares each Chennai market (AGMARKNET's Uzhavar Sandhai
 * reports) commodity by commodity; a market's column opens its own price list. The weekly
 * views average the districts around Chennai or the whole state.
 */
export function MarketsCard({ ins, c, full }: { ins: Insights | null; c: Console; full?: boolean }) {
  const [scope, setScope] = useState<"markets" | "chennai" | "tamilNadu">("markets");
  const [market, setMarket] = useState<string | null>(null);
  const head = (
    <div className="ch"><I n="chart" /><h3>Mandi prices <span>· AGMARKNET, ₹ per kg</span></h3>
      <div className="seg sm" style={{ marginLeft: "auto" }}>
        <button className={scope === "markets" ? "on" : ""} onClick={() => setScope("markets")} title="Each Chennai market (Uzhavar Sandhai farmer markets)">Chennai markets</button>
        <button className={scope === "chennai" ? "on" : ""} onClick={() => setScope("chennai")} title="Weekly average over Thiruvallur, Kancheepuram and Chengalpattu">Around Chennai</button>
        <button className={scope === "tamilNadu" ? "on" : ""} onClick={() => setScope("tamilNadu")}>Tamil Nadu</button>
      </div>
      {!full && scope === "markets" && <button className="more" style={{ marginLeft: 0 }} onClick={() => c.openMarkets()} title="Every commodity at every market">Full table<I n="right" /></button>}
    </div>
  );
  if (!ins) return <>{head}<Loading /></>;
  return (
    <>
      {head}
      <div className={`cb mk-cb${full ? " mk-full" : ""}`}>
        {scope === "markets" ? <ByMarket m={ins.markets.byMarket} c={c} full={full} market={market} setMarket={setMarket} />
          : <Weekly ins={ins} scope={scope} />}
      </div>
    </>
  );
}

export function MarketsFull({ ins, c }: { ins: Insights | null; c: Console }) {
  return <div className="card mk-modal"><MarketsCard ins={ins} c={c} full /></div>;
}

type ByM = Insights["markets"]["byMarket"];

function ByMarket({ m, c, full, market, setMarket }: { m: ByM; c: Console; full?: boolean; market: string | null; setMarket: (k: string | null) => void }) {
  if (!m.markets.length) return <Empty>No Chennai market prices yet. Open Data sources and run AGMARKNET.</Empty>;
  const note = (
    <p className="bf-note" style={{ marginTop: 6 }}>
      <span title="Modal prices from AGMARKNET. A market that has not reported in three days is left blank. Koyambedu, the wholesale market, does not report to AGMARKNET.">
        Uzhavar Sandhai farmer markets{m.latest ? `, prices of ${fmtDate(m.latest + " 00:00:00")}` : ""}. Green = cheapest market, red = dearest. Scroll for more; Full table lists all {m.commodities.length} items.
      </span>
    </p>
  );
  const one = market ? m.markets.find((x) => x.key === market) : null;
  if (one) {
    const rows = m.commodities.filter((x) => x.prices[one.key]);
    return (
      <>
        <div className="mk-back">
          <button className="lnk" onClick={() => setMarket(null)}><I n="chevl" />All markets</button>
          <b>{one.key}</b><span className="dim">{one.area === "Chennai city" ? `Uzhavar Sandhai${one.zone ? ` · ${c.zoneNameOf(one.zone) ?? `Zone ${one.zone}`} zone` : ""}` : "Uzhavar Sandhai · suburbs"} · {rows.length} items · reported {fmtDate(one.latest + " 00:00:00")}</span>
        </div>
        <div className="mk-scroll">
        <table className="mk">
          <thead><tr><th>Commodity</th><th>Price</th><th>Range</th><th>vs. previous report</th><th>vs. Chennai average</th><th>14 days</th></tr></thead>
          <tbody>
            {rows.map((x) => {
              const p = x.prices[one.key];
              const vsAvg = x.avg && x.markets > 1 ? ((p.price - x.avg) / x.avg) * 100 : null;
              return (
                <tr key={x.commodity} style={{ cursor: "default" }}>
                  <td className="ev">{x.commodity}</td>
                  <td className="num"><b>{kg(p.price)}</b></td>
                  <td className="num dim">{p.lo != null && p.hi != null && p.lo !== p.hi ? `${kg(p.lo, 0)}–${kg(p.hi, 0)}` : "—"}</td>
                  <td><Chg v={p.prev ? ((p.price - p.prev) / p.prev) * 100 : null} /></td>
                  <td>{vsAvg == null ? <span className="dim">only market</span> : <Chg v={vsAvg} />}</td>
                  <td><MiniSpark vals={p.series.filter((v): v is number => v != null)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {note}
      </>
    );
  }
  const rows = m.commodities.filter((x) => x.markets >= (full ? 1 : 2)); // items sold in one market only are in the full table
  return (
    <>
      <div className="mk-scroll">
      <table className="mk mx">
        <thead>
          <tr>
            <th>Commodity</th>
            {m.markets.map((k) => (
              <th key={k.key} className={`mx-h${c.zone && k.zone === c.zone ? " mine" : ""}${k.area === "Suburbs" ? " sub" : ""}`}>
                <button onClick={() => setMarket(k.key)} title={`${k.key} (${k.area === "Chennai city" ? "Chennai city" : "suburbs"}): ${k.commodities} items, reported ${fmtDate(k.latest + " 00:00:00")}. Click for its full price list.`}>
                  {k.key}<small>{k.area === "Chennai city" ? "city" : "suburb"}</small>
                </button>
              </th>
            ))}
            <th>Average</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const vals = Object.values(x.prices).map((p) => p.price);
            const lo = Math.min(...vals), hi = Math.max(...vals);
            const chg = x.avg != null && x.avgPrev ? ((x.avg - x.avgPrev) / x.avgPrev) * 100 : null;
            return (
              <tr key={x.commodity} style={{ cursor: "default" }}>
                <td className="ev">{x.commodity}</td>
                {m.markets.map((k) => {
                  const p = x.prices[k.key];
                  if (!p) return <td key={k.key} className="num dim">·</td>;
                  const cls = vals.length >= 3 && lo !== hi ? (p.price === lo ? " lo" : p.price === hi ? " hi" : "") : "";
                  return (
                    <td key={k.key} className={`num mx-c${cls}${c.zone && k.zone === c.zone ? " mine" : ""}`}
                      title={`${x.commodity} at ${k.key}: ${kg(p.price)}/kg on ${fmtDate(p.date + " 00:00:00")}` +
                        (p.lo != null && p.hi != null ? ` (range ${kg(p.lo)}–${kg(p.hi)})` : "") + (p.prev ? `; previous report ${kg(p.prev)}` : "")}>
                      {kg(p.price)}
                    </td>
                  );
                })}
                <td className="num"><b>{kg(x.avg)}</b> <Chg v={chg} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {note}
    </>
  );
}

function Weekly({ ins, scope }: { ins: Insights; scope: "chennai" | "tamilNadu" }) {
  const wk = ins.markets.weekly[scope];
  const daily = new Map((scope === "chennai" ? ins.markets.chennai : ins.markets.tamilNadu).commodities.map((x) => [x.commodity, x]));
  const latest = (scope === "chennai" ? ins.markets.chennai : ins.markets.tamilNadu).latest;
  return (
    <>
      {wk.length ? (
        <div className="mk-scroll">
        <table className="mk">
          <thead><tr><th>Commodity</th><th>Latest day</th><th>This week</th><th>vs. last week</th><th>vs. last month</th><th>8 weeks</th></tr></thead>
          <tbody>
            {wk.map((m) => {
              const d = daily.get(m.commodity);
              const avg = m.series.reduce((a, b) => a + b, 0) / m.series.length;
              const lvl = m.price > avg * 1.1 ? ["HIGH", "#D92D35"] : m.price < avg * 0.9 ? ["LOW", "#12925F"] : ["NORMAL", "#6F82A6"];
              return (
                <tr key={m.commodity} style={{ cursor: "default" }}>
                  <td className="ev">{m.commodity} <span className="lvl sm" style={{ color: lvl[1], background: lvl[1] + "1A" }}>{lvl[0]}</span></td>
                  <td className="num">{d ? kg(d.price) : "—"}<small className="dim"> {d ? fmtDate(d.date + " 00:00:00") : ""}</small></td>
                  <td className="num"><b>{kg(m.price)}</b></td>
                  <td><Chg v={m.chgWeek} /></td>
                  <td><Chg v={m.chgMonth} /></td>
                  <td><MiniSpark vals={m.series} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      ) : <Empty>No AGMARKNET prices yet. Open Data sources and run AGMARKNET.</Empty>}
      <p className="bf-note" style={{ marginTop: 6 }}>
        Weekly averages over {scope === "chennai" ? "the districts around Chennai (Thiruvallur, Kancheepuram, Chengalpattu)" : "all reporting Tamil Nadu districts"}.
        {latest ? ` Daily prices up to ${fmtDate(latest + " 00:00:00")}.` : ""} A rise is marked red: it hurts households.
      </p>
    </>
  );
}

function Chg({ v }: { v: number | null }) {
  if (v == null) return <span className="dim">—</span>;
  const up = v > 0.5, down = v < -0.5;
  return <span className={`chg ${up ? "up" : down ? "down" : ""}`}>{up ? "▲" : down ? "▼" : "–"} {Math.abs(v).toFixed(1)}%</span>;
}

function MiniSpark({ vals }: { vals: number[] }) {
  if (vals.length < 2) return <span className="dim">—</span>;
  const W = 90, H = 24, mx = Math.max(...vals), mn = Math.min(...vals);
  const x = (i: number) => 2 + (i * (W - 4)) / (vals.length - 1), y = (v: number) => 2 + (1 - (v - mn) / (mx - mn || 1)) * (H - 4);
  return (
    <svg width={W} height={H} aria-hidden="true">
      <path d={vals.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join(" ")} fill="none" stroke="#1560E8" strokeWidth="1.8" />
      <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r="2.6" fill="#1560E8" />
    </svg>
  );
}

// ------------------------------------------------------------------ utils --

export function download(name: string, text: string, type = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Tiny Markdown renderer for saved briefings (headings, lists, bold, code); input is escaped first. */
export function mdToHtml(md: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/_(.+?)_/g, "<i>$1</i>");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of md.split("\n")) {
    const h = line.match(/^(#{1,3})\s+(.*)/), ul = line.match(/^\s*-\s+(.*)/), ol = line.match(/^\s*\d+\.\s+(.*)/);
    if (h) { close(); out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`); }
    else if (ul) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(ul[1])}</li>`); }
    else if (ol) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(ol[1])}</li>`); }
    else if (line.trim()) { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return out.join("");
}
