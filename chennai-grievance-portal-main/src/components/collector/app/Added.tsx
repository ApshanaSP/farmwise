"use client";

import { useState } from "react";
import type { Overview as OverviewData } from "@/lib/collector/intel";
import { I } from "./icons";
import { Empty, fmtShort, ms, rel, type Row } from "./lib";
import type { Console } from "./CollectorApp";

/** Items come from sites the Collector added, so only plain web links are ever rendered as links. */
export const safeUrl = (u: unknown) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);

const KIND: Record<string, string> = { rss: "RSS feed", html: "Web page", json: "JSON feed", ocr: "Newspaper page (OCR)" };

/** Added sources can be newer than the store's as-of time: then show the time itself. */
export const itemWhen = (t: string, now: string) => (ms(t) > ms(now) ? fmtShort(t) : rel(t, now));

export const itemWhere = (i: Row) => (i.place ?? i.zone_name ?? null) as string | null;

/** One item in Today's Briefing: headline, source, place and time; opens the item. */
export function AddedRow({ i, now, c }: { i: Row; now: string; c: Console }) {
  return (
    <button className="brief" onClick={() => c.openItem(i)}>
      <span className={`bic ${i.is_incident ? "t-violet" : "t-info"}`}><I n={i.kind === "ocr" ? "photo" : "ext"} /></span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <b>{i.title}</b>
        <span className="loc">{[i.source, itemWhere(i) ?? "Place not found", itemWhen(i.t, now)].join(" · ")}</span>
        {i.category_label && <span className="routed added"><I n="doc" />{i.category_label}</span>}
      </span>
    </button>
  );
}

/** Every added-source item in the scope, with a civic-only filter. */
export function AddedAllBody({ d, c }: { d: OverviewData; c: Console }) {
  const [civic, setCivic] = useState(false);
  const rows = d.added.items.filter((i: Row) => !civic || i.is_incident);
  return (
    <>
      <div className="add-bar">
        <span><b>{d.added.count}</b> items in the last {d.added.days} days · <b>{d.added.civic}</b> read as civic issues · <b>{d.added.placed}</b> placed on the map</span>
        <label className="tgl"><input type="checkbox" checked={civic} onChange={(e) => setCivic(e.target.checked)} />Civic issues only</label>
        <button className="btn sm plain" onClick={() => c.openSources("add")}><I n="plus" />Add a source</button>
      </div>
      {rows.length ? (
        <div className="ngrid">
          {rows.map((i: Row) => (
            <button key={i.item_id} className="ncard" onClick={() => c.openItem(i)}>
              <div className="nout"><span>{i.source}</span>{i.category_label && <span className="alt">{i.category_label}</span>}</div>
              <h4>{i.title}</h4>
              <div className="nmeta"><span>{itemWhere(i) ?? "Place not found"}</span><span>{itemWhen(i.t, d.now)}</span>{i.lat != null && <span><I n="pin" />On the map</span>}</div>
            </button>
          ))}
        </div>
      ) : <Empty>No items from added sources in this scope. Add an RSS feed, web page or JSON link under Data sources.</Empty>}
    </>
  );
}

/** One added-source item: what it says, how it was read (category and place, with the evidence) and its source link. */
export function ItemBody({ item: i, c }: { item: Row; c: Console }) {
  const url = safeUrl(i.url);
  const where = [i.place, i.ward_no ? `Ward ${i.ward_no}` : null, i.zone_name, i.taluk_code ? `${c.talukName(i.taluk_code)} taluk` : null].filter(Boolean).join(" · ");
  return (
    <div className="itm">
      <div className="iv-tags">
        <span className="tg">{KIND[i.kind] ?? "Added source"}</span>
        {i.is_incident ? <span className="tg solid" style={{ color: "#6A55D8" }}>Civic issue</span> : <span className="tg">General news</span>}
        {i.lang === "ta" && <span className="tg">Tamil</span>}
      </div>
      <h3>{i.title}</h3>
      <div className="itm-meta">
        <b>{i.source}</b> · published {fmtShort(i.t)}{i.fetched && i.fetched !== i.t ? ` · collected ${fmtShort(i.fetched)}` : ""}
      </div>
      {i.body && i.body !== i.title && <p className="itm-body">{i.body}</p>}
      <dl className="itm-dl">
        <dt>Category</dt>
        <dd>{i.category_label ? <>{i.category_label}{i.category_conf != null && <small> · {Math.round(Number(i.category_conf) * 100)}% sure</small>}
          {i.matched_terms && <small> · matched “{i.matched_terms}”</small>}</> : <span className="dim">Not a civic category (no keyword matched)</span>}</dd>
        <dt>Place</dt>
        <dd>{where ? <>{where}{i.place_conf != null && <small> · {Math.round(Number(i.place_conf) * 100)}% sure</small>}</> : <span className="dim">No Chennai place named</span>}</dd>
        {i.dept_code && <><dt>Department</dt><dd>{i.dept_code}</dd></>}
      </dl>
      <div className="itm-act">
        {url ? <a className="btn pri" href={url} target="_blank" rel="noopener noreferrer"><I n="ext" />Open the source link</a>
          : <span className="dim">This item has no link.</span>}
        {i.lat != null && <button className="btn plain" onClick={() => c.locate({ id: `item-${i.item_id}`, lat: i.lat, lon: i.lon })}><I n="pin" />Show on the map</button>}
        <button className="btn plain" onClick={() => c.openSources("sources")}><I n="sensor" />Source settings</button>
      </div>
      {url && <div className="itm-url" title={url}>{url}</div>}
    </div>
  );
}
