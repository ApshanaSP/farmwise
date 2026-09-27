"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Department as DeptData, Overview as OverviewData, Period } from "@/lib/collector/intel";
import type { MapShapes } from "@/lib/collector/geo";
import { I, type IconName } from "./icons";
import Overview from "./Overview";
import Department from "./Department";
import { Ask, ContactBody, DeptsBody, Drawer, ExportBody, FeedsBody, ListBody, Modal, NewsAllBody, ZonesBody } from "./Overlays";
import { deptIcon, fmtTime, fullTitle, rel, sevTone, shortDept, type Row } from "./lib";
import { esc } from "./MapSvg";
import "./collector.css";

const PERIOD_KEYS: Period[] = ["daily", "weekly", "monthly", "quarterly"];
const ACTION_ORDER = ["Not started", "Pending", "In progress", "Done"];

export type ListPreset = Partial<{ dept: string; sev: string; status: string; q: string; sort: string; dir: number; scope: string }>;
export interface DeptNav { code: string; name: string; head?: string | null; open: number; n: number; severe: number; unverified: number }
type ModalState =
  | { kind: "list"; title: string; preset: ListPreset }
  | { kind: "zones" | "depts" | "feeds" | "export" | "news"; title: string }
  | { kind: "contact"; title: string; dept: Row; offices: Row[]; office?: Row };
interface Toast { id: number; msg: string; kind: "ok" | "alert"; act?: { label: string; run: () => void } }

/** Everything the screens need from the shell: state, navigation and actions. */
export interface Console {
  view: string;
  period: Period;
  periodLabel: string;
  zone: number | null;
  zoneName: string | null;
  now: string;
  zoom: number;
  depts: DeptNav[];
  layers: Record<string, boolean>;
  toggleLayer: (k: string) => void;
  rtab: "all" | "portal" | "news";
  setRtab: (t: "all" | "portal" | "news") => void;
  hist: string | null;
  setHist: (id: string) => void;
  page: number;
  setPage: (p: number) => void;
  dsel: string | null;
  setDsel: (id: string) => void;
  qtab: "officers" | "queue" | "news";
  setQtab: (t: "officers" | "queue" | "news") => void;
  qsel: Set<string>;
  toggleQsel: (id: string) => void;
  trend: string;
  setTrend: (t: string) => void;
  busyIds: Set<string>;
  reloadKey: number;
  chat: { r: "q" | "a"; h: ReactNode }[];
  setChat: React.Dispatch<React.SetStateAction<{ r: "q" | "a"; h: ReactNode }[]>>;
  setAsk: (v: boolean) => void;
  go: (view: string) => void;
  setZone: (z: number | null) => void;
  openInc: (id: string, mode?: "news") => void;
  openInDept: (i: Row) => void;
  openList: (preset: ListPreset, title: string) => void;
  openNewsAll: () => void;
  openZones: () => void;
  openDepts: () => void;
  openFeeds: () => void;
  openContact: (dept: Row, offices: Row[], office?: Row) => void;
  openMenu: (i: Row, e: React.MouseEvent) => void;
  tip: (html: string | null, e?: React.MouseEvent) => void;
  zoneTip: (z: number) => string;
  verify: (rows: Row[]) => Promise<boolean>;
  decide: (rows: Row[], decision: string, note?: string) => Promise<boolean>;
  cycleAction: (incidentId: string, a: Row) => void;
  addAction: (incidentId: string, text: string) => Promise<boolean>;
  toast: (msg: string, kind?: "ok" | "alert", act?: Toast["act"]) => void;
  closeAll: () => void;
}

async function api(path: string, body?: unknown) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Request failed.");
  return j;
}

export default function CollectorApp({ initial, shapes, allDepts, user }: {
  initial: OverviewData; shapes: MapShapes; allDepts: { code: string; name: string; head: string | null }[]; user: string;
}) {
  const [view, setView] = useState("overview");
  const [period, setPeriod] = useState<Period>("daily");
  const [zone, setZoneState] = useState<number | null>(null);
  const [ov, setOv] = useState<OverviewData>(initial);
  const [dp, setDp] = useState<DeptData | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [anim, setAnim] = useState(true);
  const [layers, setLayers] = useState<Record<string, boolean>>({ severe: true, complaint: true, other: true });
  const [rtab, setRtab] = useState<"all" | "portal" | "news">("all");
  const [hist, setHist] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [dsel, setDsel] = useState<string | null>(null);
  const [qtab, setQtab] = useState<"officers" | "queue" | "news">("officers");
  const [qsel, setQsel] = useState<Set<string>>(new Set());
  const [trend, setTrend] = useState("all");
  const [drawer, setDrawer] = useState<{ id: string; mode?: "news" } | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [menu, setMenu] = useState<{ i: Row; top: number; left: number } | null>(null);
  const [pop, setPop] = useState<"bell" | "profile" | null>(null);
  const [bellRead, setBellRead] = useState(false);
  const [ask, setAsk] = useState(false);
  const [chat, setChat] = useState<{ r: "q" | "a"; h: ReactNode }[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tipState, setTipState] = useState<{ html: string; x: number; y: number } | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [navOpen, setNavOpen] = useState(false);
  const [fit, setFit] = useState({ on: false, z: 1, w: 1600, h: 860 });
  const appRef = useRef<HTMLDivElement>(null);
  const firstLoad = useRef(true);
  const lastExport = useRef(initial.exportedAt);
  const dirty = useRef(false);
  const pendingSel = useRef<string | null>(null); // incident to select once a department page opens

  // ------------------------------------------------ fit-to-screen scaling --
  useLayoutEffect(() => {
    const f = () => {
      const w = window.innerWidth, h = window.innerHeight;
      const on = w >= 980 && h >= 540;
      setFit({ on, z: on ? Math.min(w / 1600, h / 860) : 1, w, h });
    };
    f();
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => { clearTimeout(t); t = setTimeout(f, 120); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ------------------------------------------------------------ routing --
  useEffect(() => {
    const route = () => {
      const h = window.location.hash.replace("#", "");
      const v = h.startsWith("dept-") ? h.slice(5) : "overview";
      setView((cur) => {
        if (cur !== v) {
          setAnim(true); setPage(0); setTrend("all"); setQsel(new Set()); setQtab("officers");
          setDsel(pendingSel.current);
          pendingSel.current = null;
        }
        return v;
      });
    };
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, []);

  const toast = useCallback((msg: string, kind: "ok" | "alert" = "ok", act?: Toast["act"]) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind, act }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "alert" ? 7000 : 3600);
  }, []);

  // --------------------------------------------------------------- data --
  useEffect(() => {
    if (firstLoad.current && period === "daily" && zone === null && reloadKey === 0) {
      firstLoad.current = false;
      return;
    }
    let live = true;
    setLoading(true);
    api(`/api/collector/overview?period=${period}${zone ? `&zone=${zone}` : ""}`)
      .then((j) => live && setOv(j))
      .catch((e) => live && toast(e.message, "alert"))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [period, zone, reloadKey, toast]);

  useEffect(() => {
    if (view === "overview") return;
    let live = true;
    setLoading(true);
    api(`/api/collector/department?code=${encodeURIComponent(view)}&period=${period}${zone ? `&zone=${zone}` : ""}`)
      .then((j) => live && setDp(j))
      .catch((e) => live && (toast(e.message, "alert"), setDp(null)))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [view, period, zone, reloadKey, toast]);

  useEffect(() => {
    if (!anim) return;
    const t = setTimeout(() => setAnim(false), 1200);
    return () => clearTimeout(t);
  }, [anim, view, ov, dp]);

  // New data from the pipeline: check every minute, refresh when nothing is open.
  const busy = () => !!(drawer || modal || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)));
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const m = await api("/api/collector/overview?meta=1");
        if (m.exportedAt && m.exportedAt !== lastExport.current) {
          lastExport.current = m.exportedAt;
          setBellRead(false);
          toast(`New data from the pipeline (as of ${fmtTime(m.now)}).`, "alert", busy() ? { label: "Refresh", run: () => setReloadKey((k) => k + 1) } : undefined);
          if (busy()) dirty.current = true;
          else setReloadKey((k) => k + 1);
        }
      } catch { /* offline: try again next minute */ }
    }, 60_000);
    return () => clearInterval(t);
  });

  // --------------------------------------------------------- navigation --
  const closeAll = useCallback(() => {
    setDrawer(null);
    setModal(null);
    if (dirty.current) { dirty.current = false; setReloadKey((k) => k + 1); }
  }, []);
  const go = (v: string) => {
    closeAll();
    setNavOpen(false);
    window.location.hash = v === "overview" ? "overview" : `dept-${v}`;
  };
  const setZone = (z: number | null) => {
    setZoneState(z);
    setHist(null);
    setPage(0);
    setAnim(true);
    closeAll();
    const name = z ? ov.zoneTable.find((x) => x.zone === z)?.name : null;
    if (z && name) toast(`Showing ${name}. All panels filtered.`);
  };

  const depts: DeptNav[] = useMemo(() => {
    const byCode = new Map(ov.deptNav.map((d) => [d.code, d]));
    return allDepts
      .map((d) => ({ code: d.code, name: d.name, head: d.head, open: 0, n: 0, severe: 0, unverified: 0, ...byCode.get(d.code) }))
      .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  }, [ov.deptNav, allDepts]);

  const zoneName = zone ? ov.zoneTable.find((z) => z.zone === zone)?.name ?? `Zone ${zone}` : null;

  // ------------------------------------------------------------ actions --
  const withBusy = async <T,>(ids: string[], fn: () => Promise<T>): Promise<T> => {
    setBusyIds((s) => new Set([...s, ...ids]));
    try { return await fn(); } finally { setBusyIds((s) => { const n = new Set(s); ids.forEach((x) => n.delete(x)); return n; }); }
  };

  const decide = async (rows: Row[], decision: string, note?: string) => {
    const ids = rows.map((r) => r.id);
    try {
      const j = await withBusy(ids, () => api("/api/collector/decisions", { incidentIds: ids, decision, note: note || null }));
      const one = rows[0];
      const what = rows.length > 1 ? `${rows.length} incidents` : `${one.type}, ${one.zone_name ?? "Chennai"}`;
      const msg: Record<string, string> = {
        verify: rows.length > 1 ? `${rows.length} incidents verified.` : `Verified: ${what}.`,
        escalate: `Escalated ${what}${j.saved?.[0]?.escalated_to_level ? ` to ${j.saved[0].escalated_to_level}` : ""}.`,
        resolve: `Resolved: ${what}.`,
        reject: note === "Dismissed as duplicate" ? `Dismissed ${what} as duplicate.` : `Rejected: ${what}.`,
        reopen: `Reopened: ${what}.`,
        note: "Note added to the incident history."
      };
      toast(msg[decision] ?? "Saved.");
      setQsel((s) => { const n = new Set(s); ids.forEach((x) => n.delete(x)); return n; });
      setReloadKey((k) => k + 1);
      return true;
    } catch (e: any) {
      toast(e.message, "alert");
      return false;
    }
  };

  const cycleAction = async (incidentId: string, a: Row) => {
    const next = ACTION_ORDER[(ACTION_ORDER.indexOf(a.status) + 1) % ACTION_ORDER.length];
    try {
      await api("/api/collector/actions", { incidentId, actionId: a.id, status: next });
      toast(`Action set to ${next}.`);
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      toast(e.message, "alert");
    }
  };

  const addAction = async (incidentId: string, text: string) => {
    try {
      await api("/api/collector/actions", { incidentId, text });
      toast("Action added.");
      setReloadKey((k) => k + 1);
      return true;
    } catch (e: any) {
      toast(e.message, "alert");
      return false;
    }
  };

  const zr = () => {
    const r = appRef.current?.getBoundingClientRect();
    return r && fit.on && Math.abs(r.width - window.innerWidth) < 2 ? fit.z : 1;
  };

  const c: Console = {
    view, period, periodLabel: ov.periodInfo.label, zone, zoneName, now: ov.now, zoom: fit.on ? fit.z : 1, depts,
    layers, toggleLayer: (k) => setLayers((l) => ({ ...l, [k]: !l[k] })),
    rtab, setRtab, hist, setHist, page, setPage, dsel, setDsel, qtab, setQtab, qsel,
    toggleQsel: (id) => setQsel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    trend, setTrend, busyIds, reloadKey, chat, setChat, setAsk,
    go, setZone,
    openInc: (id, mode) => { setModal(null); setMenu(null); setDrawer({ id, mode }); },
    openInDept: (i) => {
      if (view === i.dept) { closeAll(); setDsel(i.id); return; }
      pendingSel.current = i.id;
      go(i.dept);
    },
    openList: (preset, title) => { setDrawer(null); setModal({ kind: "list", title: `${title} · ${zoneName ?? "District-wide"}`, preset }); },
    openNewsAll: () => setModal({ kind: "news", title: `Today's Briefing · news · ${zoneName ?? "District-wide"}` }),
    openZones: () => setModal({ kind: "zones", title: "Zones by open complaints" }),
    openDepts: () => setModal({ kind: "depts", title: "Departments" }),
    openFeeds: () => setModal({ kind: "feeds", title: "Data feeds" }),
    openContact: (dept, offices, office) => setModal({ kind: "contact", title: `Contact ${office?.officer_name ?? dept.head}`, dept, offices, office }),
    openMenu: (i, e) => {
      e.stopPropagation();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const k = zr();
      const vw = window.innerWidth / (fit.on ? fit.z : 1), vh = window.innerHeight / (fit.on ? fit.z : 1);
      setMenu({ i, top: Math.min(r.bottom / k + 6, vh - 230), left: Math.max(8, Math.min(r.right / k - 230, vw - 240)) });
    },
    tip: (html, e) => {
      if (!html || !e) return setTipState(null);
      const z = fit.on ? fit.z : 1;
      setTipState({ html, x: Math.min(e.clientX / z + 14, window.innerWidth / z - 250), y: e.clientY / z + 14 });
    },
    zoneTip: (z) => {
      const r = ov.zoneTable.find((x) => x.zone === z);
      if (!r) return `<b>Zone ${z}</b>`;
      return `<b>${esc(r.name)}</b>${r.open} open · ${r.severe} severe · ${r.complaints} complaints<br><span style="opacity:.7">Click to ${zone === z ? "keep" : "filter to"} this zone</span>`;
    },
    verify: (rows) => decide(rows, "verify"),
    decide, cycleAction, addAction, toast, closeAll
  };

  // --------------------------------------------------------- keyboard --
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (drawer || modal) closeAll();
        else if (ask) setAsk(false);
        setMenu(null);
        setPop(null);
        setNavOpen(false);
      }
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName)) {
        e.preventDefault();
        document.getElementById("dic-q")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, modal, ask, closeAll]);

  const bellItems = ov.bell;
  const bellN = bellRead ? 0 : bellItems.length;
  const feedsOk = ov.feeds.filter((f) => f.status === "ok").length;

  return (
    <div className={`dic${fit.on ? " fit" : ""}${navOpen ? " nav-open" : ""}`}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (!t.closest(".pop") && !t.closest("[data-pop]")) setPop(null);
        if (!t.closest(".menu") && !t.closest(".kebab")) setMenu(null);
      }}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <linearGradient id="gBar" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#4D8DFF" /><stop offset="1" stopColor="#B9D2FF" /></linearGradient>
          <linearGradient id="gSea" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#D5E7FC" /><stop offset="1" stopColor="#A9CBF6" /></linearGradient>
        </defs>
      </svg>
      {loading && <div className="loading-bar" />}
      <div className="app" ref={appRef} style={fit.on ? { zoom: fit.z, width: fit.w / fit.z, height: fit.h / fit.z } : undefined}>
        <aside className="side">
          <div className="brand">
            <div className="brand-mark"><I n="gov" /></div>
            <div><b>Chennai District</b><small>Collector&apos;s Intelligence Console</small></div>
          </div>
          <nav className="nav" aria-label="Main">
            <button className={`nav-i ${view === "overview" ? "on" : ""}`} onClick={() => go("overview")}><I n="home" />Overview</button>
            <div className="nav-lbl">Departments</div>
            {depts.slice(0, 8).map((d) => (
              <button key={d.code} className={`nav-i ${view === d.code ? "on" : ""}`} onClick={() => go(d.code)} title={d.name}>
                <I n={deptIcon(d.code)} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                <span className="badge-s">{d.open}</span>
              </button>
            ))}
            <button className="nav-i" onClick={() => c.openDepts()}><I n="layers" />All departments</button>
          </nav>
          <div className="feeds">
            <b>Data feeds <span style={{ color: feedsOk === ov.feeds.length ? "#3FE39A" : "#F6C343" }}>{feedsOk}/{ov.feeds.length} healthy</span></b>
            {ov.feeds.map((f) => (
              <span key={f.source} style={{ cursor: "pointer" }} onClick={() => c.openFeeds()}>
                <i style={f.status === "ok" ? undefined : { background: "#F6C343", boxShadow: "0 0 0 3px rgba(246,195,67,.2)" }} />
                {FEED_NAME[f.source] ?? f.source}
                <em>{f.newest ? rel(f.newest, ov.now) : "—"}</em>
              </span>
            ))}
          </div>
          <div className="side-tag">People · Responsive · Transparent · Inclusive</div>
        </aside>

        <div className="main">
          <header className="top">
            <button className="hamb" onClick={(e) => { e.stopPropagation(); setNavOpen((v) => !v); }} aria-label="Open menu"><I n="menu" /></button>
            <Search c={c} ov={ov} />
            <div className="seg" role="tablist" aria-label="Period">
              {PERIOD_KEYS.map((p) => (
                <button key={p} role="tab" aria-selected={period === p} className={period === p ? "on" : ""}
                  onClick={() => { setPeriod(p); setPage(0); setAnim(true); }}>{p[0].toUpperCase() + p.slice(1)}</button>
              ))}
            </div>
            <Clock />
            <button className="tbtn" onClick={() => setModal({ kind: "export", title: "Export incidents" })}><I n="download" /><span className="lb">Export</span></button>
            <div className="rel">
              <button className="tbtn" data-pop onClick={() => setPop((p) => (p === "bell" ? null : "bell"))} aria-label="Alerts">
                <I n="bell" />{bellN > 0 && <span className="dot-n">{bellN}</span>}
              </button>
              {pop === "bell" && (
                <div className="pop">
                  <div className="pop-h">Severe and high · last 24 hours<button className="lnk" onClick={() => { setBellRead(true); setPop(null); }}>Mark all read</button></div>
                  {bellItems.length ? bellItems.map((i) => (
                    <button key={i.id} className="pop-i" onClick={() => { setPop(null); c.openInc(i.id); }}>
                      <span className={`kpi-ic ${sevTone(i.sev)}`} style={{ width: 32, height: 32 }}><I n={deptIcon(i.dept)} /></span>
                      <span><b>{fullTitle(i)}</b><small>{i.zone_name ?? "Chennai"} · {i.sev} · {rel(i.t, ov.now)}</small></span>
                    </button>
                  )) : <div className="empty">No alerts.</div>}
                </div>
              )}
            </div>
            <div className="rel">
              <button className="me" data-pop onClick={() => setPop((p) => (p === "profile" ? null : "profile"))}>
                <span className="avatar">CO</span>
                <span className="who"><b>Collector&apos;s Office</b><small>{user}</small></span><I n="chevd" />
              </button>
              {pop === "profile" && (
                <div className="pop" style={{ width: 280 }}>
                  <div className="pop-h">Collector&apos;s Office</div>
                  <div style={{ padding: "0 8px 8px", color: "var(--text-3)", fontSize: 12 }}>
                    Signed in as {user}. Figures come from the district intelligence store, as of {fmtTime(ov.now)}.
                  </div>
                  <button className="pop-i" onClick={() => { setPop(null); setReloadKey((k) => k + 1); }}><I n="refresh" /><span><b>Reload data</b><small>Fetch the latest from the store</small></span></button>
                  <button className="pop-i" onClick={() => { setPop(null); go("overview"); }}><I n="home" /><span><b>Go to overview</b></span></button>
                  <button className="pop-i" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}>
                    <I n="user" /><span><b>Sign out</b></span>
                  </button>
                </div>
              )}
            </div>
          </header>

          <div id="view" className={anim ? "anim" : ""}>
            {view === "overview" ? <Overview d={ov} shapes={shapes} c={c} />
              : dp && dp.dept.code === view ? <Department d={dp} shapes={shapes} c={c} />
                : <div className="card" style={{ padding: 24 }}><div className="empty">{loading ? "Loading the department…" : "Department not found."}</div></div>}
          </div>
        </div>

        {(drawer || modal) && <div className="scrim" onClick={closeAll} />}
        {drawer && <Drawer id={drawer.id} mode={drawer.mode} c={c} />}
        {modal && (
          <Modal title={modal.title} c={c}>
            {modal.kind === "list" ? <ListBody key={modal.title} preset={modal.preset} c={c} />
              : modal.kind === "zones" ? <ZonesBody d={ov} c={c} />
                : modal.kind === "depts" ? <DeptsBody c={c} />
                  : modal.kind === "feeds" ? <FeedsBody d={ov} />
                    : modal.kind === "export" ? <ExportBody c={c} />
                      : modal.kind === "news" ? <NewsAllBody d={ov} c={c} />
                        : modal.kind === "contact" ? <ContactBody dept={modal.dept} offices={modal.offices} office={modal.office} c={c} /> : null}
          </Modal>
        )}
        {menu && (
          <div className="menu" style={{ top: menu.top, left: menu.left }}>
            <button onClick={() => c.openInc(menu.i.id)}><I n="doc" />View details</button>
            <button onClick={() => { setMenu(null); decide([menu.i], "escalate"); }}><I n="esc" />Escalate</button>
            <button onClick={() => { setMenu(null); c.openInDept(menu.i); }}><I n={deptIcon(menu.i.dept)} />Open in {shortDept(menu.i.dept)}</button>
            {menu.i.zone && <button onClick={() => { setMenu(null); setZone(menu.i.zone); }}><I n="pin" />Filter to {menu.i.zone_name}</button>}
            <button onClick={() => { setMenu(null); decide([menu.i], "reject", "Dismissed as duplicate"); }}><I n="x" />Dismiss as duplicate</button>
          </div>
        )}
        {tipState && <div className="tip" style={{ left: tipState.x, top: tipState.y }} dangerouslySetInnerHTML={{ __html: tipState.html }} />}
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`toast${t.kind === "alert" ? " alert" : ""}`}>
              <I n={t.kind === "alert" ? "bell" : "checkc"} /><span>{t.msg}</span>
              {t.act && <button onClick={() => { t.act!.run(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.act.label}</button>}
            </div>
          ))}
        </div>
        <button className="ask-fab" onClick={() => setAsk((v) => !v)} aria-label="Open assistant"><I n="spark" />Ask Chennai AI</button>
        {ask && <Ask c={c} d={ov} />}
      </div>
    </div>
  );
}

const FEED_NAME: Record<string, string> = {
  grievance: "Grievance portal", police: "Police reports", pwd: "PWD records", hospital: "Hospitals",
  news: "News monitor", imd: "IMD weather", cpcb: "Air quality", cfm: "Flood monitoring"
};

function Clock() {
  const [t, setT] = useState<Date | null>(null);
  useEffect(() => {
    setT(new Date());
    const i = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(i);
  }, []);
  return (
    <div className="clock">
      <b>{t ? t.toLocaleTimeString("en-US", { timeZone: "Asia/Kolkata", hour12: true }) : "--:--:--"}</b>
      <small>{t ? t.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric" }) : ""} · IST</small>
    </div>
  );
}

interface Hit { g: string; ic: IconName; l: string; s: string; run: () => void }

function Search({ c, ov }: { c: Console; ov: OverviewData }) {
  const [text, setText] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) { setHits(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api(`/api/collector/search?q=${encodeURIComponent(q)}`);
        if (!live) return;
        const out: Hit[] = [];
        r.zones.forEach((z: Row) => out.push({ g: "Zones", ic: "pin", l: z.name, s: `${z.open} open incidents`, run: () => c.setZone(z.zone) }));
        r.depts.forEach((d: Row) => out.push({ g: "Departments", ic: deptIcon(d.code), l: d.name, s: d.org, run: () => c.go(d.code) }));
        r.incidents.forEach((i: Row) => out.push({ g: "Incidents", ic: deptIcon(i.dept), l: fullTitle(i), s: `${i.zone_name ?? "Chennai"} · ${rel(i.t, ov.now)}`, run: () => c.openInc(i.id) }));
        setHits(out);
        setIdx(0);
      } catch { /* ignore */ }
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (h: Hit) => { setText(""); setHits(null); h.run(); };
  let g = "";
  return (
    <div className="search">
      <input id="dic-q" type="search" placeholder="Search incidents, zones, departments…" autoComplete="off" aria-label="Search"
        value={text} onChange={(e) => setText(e.target.value)}
        onBlur={() => setTimeout(() => setHits(null), 150)}
        onKeyDown={(e) => {
          if (!hits) return;
          if (e.key === "ArrowDown") { setIdx((i) => Math.min(hits.length - 1, i + 1)); e.preventDefault(); }
          else if (e.key === "ArrowUp") { setIdx((i) => Math.max(0, i - 1)); e.preventDefault(); }
          else if (e.key === "Enter" && hits[idx]) pick(hits[idx]);
          else if (e.key === "Escape") { setText(""); setHits(null); }
        }} />
      <I n="search" /><kbd>/</kbd>
      {hits && (
        <div className="sres">
          {hits.length ? hits.map((h, k) => {
            const head = h.g !== g ? <div className="sh">{h.g}</div> : null;
            g = h.g;
            return (
              <div key={k}>
                {head}
                <button className={k === idx ? "hl" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)}>
                  <I n={h.ic} /><span>{h.l}</span><small>{h.s}</small>
                </button>
              </div>
            );
          }) : <div className="empty">No matches. Try a zone, street, department or incident ID.</div>}
        </div>
      )}
    </div>
  );
}
