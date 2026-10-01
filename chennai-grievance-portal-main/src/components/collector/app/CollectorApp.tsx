"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Overview as OverviewData, Period } from "@/lib/collector/intel";
import type { Insights } from "@/lib/collector/insights";
import type { MapGeo } from "@/lib/collector/geo";
import Logo from "@/components/Logo";
import { I, type IconName } from "./icons";
import { BrandMark } from "./assistant/Brand";
import { EnvPage, Page1 } from "./Overview";
import { BriefingPage, GapsBody, PatternBody, TrendsPage, mdToHtml, type Pattern } from "./Insights";
import { IncidentView } from "./Detail";
import { ContactBody, DeptsBody, ExportBody, ListBody, Modal, NewsAllBody, ZonesBody } from "./Overlays";
import { SourcesBody } from "./Sources";
import { AddedAllBody, ItemBody } from "./Added";
import { StoriesBody } from "./Stories";
import { MarketsFull } from "./Insights";
import { CustomizeBody, DEFAULT_LAYOUT, WorkspaceBody, type Layout } from "./Workspace";
import { deptIcon, fmtDate, fmtShort, fmtTime, fullTitle, rel, sevTone, type Row } from "./lib";
import { esc } from "./SatMap";
import "./collector.css";

// The assistant loads only when it is first opened, so the console stays fast.
const AssistantDialog = dynamic(() => import("./assistant/AssistantDialog"), { ssr: false });

const PERIOD_KEYS: Period[] = ["daily", "weekly", "monthly", "quarterly"];
const PERIOD_WORD: Record<Period, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" };
const PERIOD_HINT: Record<Period, string> = {
  daily: "Daily: only today, from midnight", weekly: "Weekly: incidents reported in the last 7 days",
  monthly: "Monthly: incidents reported in the last 30 days", quarterly: "Quarterly: incidents reported in the last 90 days"
};
const FIT_W = 1366;
const FIT_H = 680;
export type PageKey = "overview" | "briefing" | "trends" | "environment";
const PAGE_TITLE: Record<PageKey, string> = { overview: "Overview", briefing: "Briefing", trends: "Trends", environment: "Environment & markets" };

export type ListPreset = Partial<{ dept: string; sev: string; status: string; q: string; sort: string; dir: number; scope: string; cat: string; taluk: string;
  /** ignore the dashboard's zone filter (lists opened from the district-wide pages) */ anyZone: boolean }>;
export interface DeptNav { code: string; name: string; head?: string | null; open: number; n: number; severe: number; unverified: number }
type ModalState =
  | { kind: "list"; title: string; preset: ListPreset }
  | { kind: "zones" | "depts" | "export" | "news" | "workspace" | "customize"; title: string }
  | { kind: "sources"; title: string; tab?: "sources" | "add" | "ocr" | "audit" }
  | { kind: "contact"; title: string; dept: Row; contacts: Row[] }
  | { kind: "text"; title: string; md: string }
  | { kind: "item"; title: string; item: Row }
  | { kind: "added"; title: string }
  | { kind: "stories"; title: string; focus: string | null }
  | { kind: "markets"; title: string }
  | { kind: "pattern"; title: string; pattern: Pattern }
  | { kind: "gaps"; title: string };
interface Toast { id: number; msg: string; kind: "ok" | "alert"; act?: { label: string; run: () => void } }
export interface Archived { name: string; version: number; markdown: string; as_of: string; issued_at: string }

/** Everything the screens need from the shell: state, navigation and actions. */
export interface Console {
  dept: string | null;
  deptName: string | null;
  period: Period;
  periodLabel: string;
  zone: number | null;
  zoneName: string | null;
  /** category chosen from a chart; filters every panel */
  cat: string | null;
  setCat: (c: string | null) => void;
  /** taluk chosen from the map or the taluk ranking; filters every panel */
  taluk: string | null;
  setTaluk: (t: string | null) => void;
  now: string;
  depts: DeptNav[];
  geo: MapGeo | null;
  page: PageKey;
  setPage: (p: PageKey) => void;
  mapMode: "zones" | "taluks";
  setMapMode: (m: "zones" | "taluks") => void;
  /** incident highlighted on the map */
  focus: { id: string; lat: number; lon: number } | null;
  locate: (i: Row) => void;
  highlight: (i: Row) => void;
  layers: Record<string, boolean>;
  toggleLayer: (k: string) => void;
  sevTab: string | null;
  setSevTab: (s: string) => void;
  envSel: Record<string, string>;
  setEnvSel: (card: string, id: string) => void;
  busyIds: Set<string>;
  reloadKey: number;
  setAsk: (v: boolean) => void;
  setPeriod: (p: Period) => void;
  setDept: (code: string | null) => void;
  setZone: (z: number | null) => void;
  openInc: (id: string) => void;
  openList: (preset: ListPreset, title: string) => void;
  openNewsAll: () => void;
  openZones: () => void;
  openDepts: () => void;
  openFeeds: () => void;
  openContact: (dept: Row, contacts: Row[]) => void;
  /** an item from a source the Collector added: its text, category, place and source link */
  openItem: (item: Row) => void;
  openAdded: () => void;
  openSources: (tab?: "sources" | "add" | "ocr" | "audit") => void;
  /** developing stories: reports about the same event, followed over time */
  openStories: (focus?: string | null) => void;
  openMarkets: () => void;
  /** an unusual spike or a recurring hotspot, with the incidents behind it */
  openPattern: (p: Pattern) => void;
  /** incidents seen only in the news, with no department record */
  openGaps: () => void;
  zoneTip: (z: number) => string;
  zoneNameOf: (z: number) => string | null;
  talukName: (code: string | null) => string | null;
  verify: (rows: Row[]) => Promise<boolean>;
  sendBack: (row: Row) => Promise<boolean>;
  toast: (msg: string, kind?: "ok" | "alert", act?: Toast["act"]) => void;
  closeAll: () => void;
  layout: Layout;
  setLayout: (l: Layout) => void;
  workspaceName: string | null;
  openWorkspace: () => void;
  saveWorkspace: (name: string) => Promise<number | null>;
  openSavedWorkspace: (id: number) => Promise<void>;
  archived: Archived | null;
  closeArchived: () => void;
  showText: (title: string, md: string) => void;
}

async function api(path: string, body?: unknown) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Request failed.");
  return j;
}

function loadLayout(): Layout {
  try {
    const l = JSON.parse(localStorage.getItem("diq-layout") ?? "null");
    if (l?.pages && l?.panels && Array.isArray(l?.kpis)) return l;
  } catch { /* storage unavailable */ }
  return DEFAULT_LAYOUT;
}

export default function CollectorApp({ initial, allDepts, user }: {
  initial: OverviewData; allDepts: { code: string; name: string; head: string | null }[]; user: string;
}) {
  const [dept, setDeptState] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("daily");
  const [zone, setZoneState] = useState<number | null>(null);
  const [cat, setCatState] = useState<string | null>(null);
  const [taluk, setTalukState] = useState<string | null>(null);
  const [page, setPageState] = useState<PageKey>("overview");
  const [ov, setOv] = useState<OverviewData>(initial);
  const [ins, setIns] = useState<Insights | null>(null);
  const [geo, setGeo] = useState<MapGeo | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [anim, setAnim] = useState(true);
  const [layers, setLayers] = useState<Record<string, boolean>>({ severe: true, complaint: true, other: true, added: true, stations: false });
  const [mapMode, setMapMode] = useState<"zones" | "taluks">("zones");
  const [focus, setFocus] = useState<Console["focus"]>(null);
  const [sevTab, setSevTab] = useState<string | null>(null);
  const [envSel, setEnvSelState] = useState<Record<string, string>>({ rain: "auto", aqi: "auto", lake: "auto" });
  const [inc, setInc] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [pop, setPop] = useState<"bell" | "profile" | null>(null);
  const [bellRead, setBellRead] = useState(false);
  const [ask, setAskState] = useState(false);
  // once opened, the assistant stays mounted so the conversation survives closing it
  const [askMounted, setAskMounted] = useState(false);
  // today's insights count, for the launcher badge (loaded after the console, so it never slows it)
  const [insightCount, setInsightCount] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      fetch("/api/collector/assistant/insights").then((r) => (r.ok ? r.json() : null)).then((j) => j && setInsightCount(j.items?.length ?? 0)).catch(() => {});
    }, 2500);
    return () => clearTimeout(t);
  }, []);
  const setAsk = useCallback((v: boolean | ((x: boolean) => boolean)) => {
    setAskState((x) => {
      const next = typeof v === "function" ? v(x) : v;
      if (next) setAskMounted(true);
      return next;
    });
  }, []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [fit, setFit] = useState<{ on: boolean; z: number; w: number; h: number }>({ on: true, z: 1, w: 1366, h: 680 });
  const [layout, setLayoutState] = useState<Layout>(DEFAULT_LAYOUT);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [archived, setArchived] = useState<Archived | null>(null);
  const firstLoad = useRef(true);
  const lastExport = useRef(initial.exportedAt);
  const dirty = useRef(false);

  // Fit to any screen: the console is laid out for a 1366 x 680 canvas and scaled to the
  // window (down on small laptops and tablets, up to 1.3x on large monitors), so nothing
  // ever scrolls. Phones in portrait are too narrow for four columns and stack instead.
  useLayoutEffect(() => {
    const f = () => {
      const w = window.innerWidth, h = window.innerHeight;
      const on = w >= 700 && h >= 380;
      const raw = Math.min(w / FIT_W, h / FIT_H);
      const z = on ? Math.max(0.5, Math.min(1.3, raw > 1 && raw < 1.08 ? 1 : raw)) : 1;
      setFit({ on, z: Math.round(z * 1000) / 1000, w, h });
    };
    f();
    setLayoutState(loadLayout());
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  useEffect(() => {
    fetch("/api/collector/geo").then((r) => (r.ok ? r.json() : null)).then((g) => g && setGeo(g)).catch(() => {});
  }, []);

  const toast = useCallback((msg: string, kind: "ok" | "alert" = "ok", act?: Toast["act"]) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind, act }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "alert" ? 7000 : 3600);
  }, []);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ period });
    if (zone) p.set("zone", String(zone));
    if (dept) p.set("dept", dept);
    if (cat) p.set("cat", cat);
    if (taluk) p.set("taluk", taluk);
    return p.toString();
  }, [period, zone, dept, cat, taluk]);

  // --------------------------------------------------------------- data --
  useEffect(() => {
    if (firstLoad.current && qs === "period=daily" && reloadKey === 0) {
      firstLoad.current = false;
      return;
    }
    let live = true;
    setLoading(true);
    api(`/api/collector/overview?${qs}`)
      .then((j) => live && setOv(j))
      .catch((e) => live && toast(e.message, "alert"))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [qs, reloadKey, toast]);

  // briefing, trends and markets load when a page needs them
  // the news-only list opens from page 1's snapshot too, so it loads insights when that modal is open
  const needIns = page !== "overview" || modal?.kind === "gaps";
  // Trends and Environment & markets are district-wide: they ignore the zone, taluk and department filters
  const insQs = page === "trends" || page === "environment" ? `period=${period}` : qs;
  useEffect(() => {
    if (!needIns) return;
    let live = true;
    setIns(null);
    api(`/api/collector/insights?${insQs}`).then((j) => live && setIns(j)).catch((e) => live && toast(e.message, "alert"));
    return () => { live = false; };
  }, [insQs, reloadKey, needIns, toast]);

  useEffect(() => {
    if (!anim) return;
    const t = setTimeout(() => setAnim(false), 1200);
    return () => clearTimeout(t);
  }, [anim, ov]);

  // New data from the pipeline: check every minute, refresh when nothing is open.
  const busy = () => !!(inc || modal || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)));
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
    setInc(null);
    setModal(null);
    if (dirty.current) { dirty.current = false; setReloadKey((k) => k + 1); }
  }, []);
  const pages = (Object.keys(PAGE_TITLE) as PageKey[]).filter((k) => k === "overview" || layout.pages[k as keyof Layout["pages"]]);
  const setPage = (p: PageKey) => { setPageState(p); setAnim(true); };
  const setDept = (code: string | null) => {
    closeAll();
    setDeptState(code);
    setAnim(true);
    const name = code ? allDepts.find((d) => d.code === code)?.name : null;
    if (name) toast(`Showing ${name} only. All panels filtered.`);
  };
  const setZone = (z: number | null) => {
    setZoneState(z);
    setEnvSelState({ rain: "auto", aqi: "auto", lake: "auto" });
    setAnim(true);
    closeAll();
    const name = z ? ov.zoneTable.find((x) => x.zone === z)?.name : null;
    if (z && name) toast(`Showing ${name}. All panels filtered.`);
  };
  const talukName = (code: string | null) => (code ? geo?.taluks.find((t) => t.code === code)?.name ?? code : null);
  const catLabel = cat ? ins?.trends.weekly.lines.find((l) => l.cat === cat)?.label ?? cat.replace(/_/g, " ").toLowerCase() : null;
  const setCat = (c: string | null) => {
    setCatState(c);
    setAnim(true);
    if (c) toast("Category filter applied to the map, lists, briefing and follow-ups.");
  };
  const setTaluk = (t: string | null) => {
    setTalukState(t);
    setAnim(true);
    closeAll();
    if (t) toast(`Showing ${talukName(t)} taluk. All panels filtered.`);
  };

  const depts: DeptNav[] = useMemo(() => {
    const byCode = new Map(ov.deptNav.map((d) => [d.code, d]));
    return allDepts
      .map((d) => ({ code: d.code, name: d.name, head: d.head, open: 0, n: 0, severe: 0, unverified: 0, ...byCode.get(d.code) }))
      .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  }, [ov.deptNav, allDepts]);

  const zoneName = zone ? ov.zoneTable.find((z) => z.zone === zone)?.name ?? `Zone ${zone}` : null;
  const deptName = dept ? allDepts.find((d) => d.code === dept)?.name ?? dept : null;
  const scopeName = [zoneName, deptName, catLabel, taluk ? `${talukName(taluk)} taluk` : null].filter(Boolean).join(" · ") || "District-wide";

  // ------------------------------------------------------------ actions --
  const decide = async (rows: Row[], decision: string, note?: string) => {
    const ids = rows.map((r) => r.id);
    setBusyIds((s) => new Set([...s, ...ids]));
    try {
      await api("/api/collector/decisions", { incidentIds: ids, decision, note: note || null });
      const one = rows[0];
      const what = rows.length > 1 ? `${rows.length} complaints` : `${one.type}, ${one.zone_name ?? "Chennai"}`;
      toast(decision === "verify" ? `Verified: ${what}. The citizen will see it closed.` : `Sent back to ${one.dept_name ?? "the department"}: ${what}.`);
      setReloadKey((k) => k + 1);
      return true;
    } catch (e: any) {
      toast(e.message, "alert");
      return false;
    } finally {
      setBusyIds((s) => { const n = new Set(s); ids.forEach((x) => n.delete(x)); return n; });
    }
  };

  const setLayout = (l: Layout) => {
    setLayoutState(l);
    try { localStorage.setItem("diq-layout", JSON.stringify(l)); } catch { /* not saved in this browser */ }
    if (page !== "overview" && !l.pages[page as keyof Layout["pages"]]) setPage("overview");
  };

  const saveWorkspace = async (name: string) => {
    try {
      const snap: Insights = ins ?? (await api(`/api/collector/insights?${qs}`));
      const r = await api("/api/collector/workspaces", {
        name,
        filters: { period, zone, dept, cat, taluk, page, zoneName, deptName, catLabel, talukName: talukName(taluk), layers, envSel },
        layout,
        briefing: { md: snap.briefing.md, facts: { headline: snap.briefing.headline, attention: snap.briefing.attention.map((a) => a.id), scope: snap.scope }, period, asOf: snap.now }
      });
      setWorkspaceName(name);
      toast(`Saved "${name}" as version ${r.version}, with a frozen copy of the briefing.`);
      return r.version as number;
    } catch (e: any) {
      toast(e.message, "alert");
      return null;
    }
  };

  const openSavedWorkspace = async (id: number) => {
    try {
      const w = await api(`/api/collector/workspaces/${id}`);
      const f = w.filters ?? {};
      setPeriod(f.period ?? "daily");
      setZoneState(f.zone ?? null);
      setDeptState(f.dept ?? null);
      setCatState(f.cat ?? null);
      setTalukState(f.taluk ?? null);
      if (f.layers) setLayers(f.layers);
      if (f.envSel) setEnvSelState(f.envSel);
      if (w.layout?.pages) setLayout(w.layout);
      setWorkspaceName(w.name);
      setArchived(w.briefing ? { name: w.name, version: w.version, markdown: w.briefing.markdown, as_of: w.briefing.as_of, issued_at: w.briefing.issued_at } : null);
      closeAll();
      setPage(w.briefing ? "briefing" : (f.page ?? "overview"));
      toast(`Opened "${w.name}" v${w.version} from ${fmtShort(w.created_at)}. Panels show live data; the Briefing shows the saved copy.`);
    } catch (e: any) {
      toast(e.message, "alert");
    }
  };

  const c: Console = {
    dept, deptName, period, periodLabel: ov.periodInfo.label, zone, zoneName, cat, setCat, taluk, setTaluk, now: ov.now, depts, geo, page, setPage,
    mapMode, setMapMode, focus,
    locate: (i) => {
      if (i.lat == null) { toast("This incident has no map location.", "alert"); return; }
      closeAll();
      setPage("overview");
      setFocus({ id: i.id, lat: Number(i.lat), lon: Number(i.lon) });
    },
    highlight: (i) => { if (i.lat != null) setFocus({ id: i.id, lat: Number(i.lat), lon: Number(i.lon) }); },
    layers, toggleLayer: (k) => setLayers((l) => ({ ...l, [k]: !l[k] })),
    sevTab, setSevTab,
    envSel, setEnvSel: (card, id) => setEnvSelState((m) => ({ ...m, [card]: id })),
    busyIds, reloadKey, setAsk,
    setPeriod: (p) => { setPeriod(p); setAnim(true); },
    setDept, setZone,
    openInc: (id) => { setModal(null); setInc(id); },
    openList: (preset, title) => { setInc(null); setModal({ kind: "list", title: `${title} · ${scopeName}`, preset: { cat: cat ?? undefined, taluk: taluk ?? undefined, ...preset } }); },
    openNewsAll: () => setModal({ kind: "news", title: `Today's Briefing · news · ${scopeName}` }),
    openZones: () => setModal({ kind: "zones", title: "Zones by open complaints" }),
    openDepts: () => setModal({ kind: "depts", title: "Departments" }),
    openFeeds: () => setModal({ kind: "sources", title: "Data sources" }),
    openContact: (d, contacts) => setModal({ kind: "contact", title: `${d.name} · official contacts`, dept: d, contacts }),
    openItem: (item) => { setInc(null); setModal({ kind: "item", title: `From an added source · ${item.source}`, item }); },
    openAdded: () => setModal({ kind: "added", title: `From added sources · ${scopeName}` }),
    openSources: (tab) => setModal({ kind: "sources", title: "Data sources", tab }),
    openStories: (focus = null) => setModal({ kind: "stories", title: `Developing stories · ${scopeName}`, focus }),
    openMarkets: () => setModal({ kind: "markets", title: "Mandi prices at Chennai markets" }),
    openPattern: (p) => setModal({ kind: "pattern", pattern: p,
      title: p.kind === "spike" ? "Unusual spike: what happened" : p.kind === "hotspot" ? "Recurring hotspot: what keeps happening" : "Is this problem rising?" }),
    openGaps: () => setModal({ kind: "gaps", title: `In the news, not in department records · ${scopeName}` }),
    zoneTip: (z) => {
      const r = ov.zoneTable.find((x) => x.zone === z);
      if (!r) return `<b>Zone ${z}</b>`;
      return `<b>${esc(r.name)}</b>${r.open} open · ${r.severe} severe · ${r.complaints} complaints<br><span style="opacity:.7">Click to ${zone === z ? "keep" : "filter to"} this zone</span><br>`;
    },
    talukName,
    zoneNameOf: (z) => ov.zoneTable.find((x) => x.zone === z)?.name ?? null,
    verify: (rows) => decide(rows, "verify"),
    sendBack: (row) => decide([row], "reopen", "Sent back to the department: the Collector did not accept the reported action."),
    toast, closeAll,
    layout, setLayout, workspaceName,
    openWorkspace: () => setModal({ kind: "workspace", title: "Workspaces" }),
    saveWorkspace, openSavedWorkspace, archived, closeArchived: () => setArchived(null),
    showText: (title, md) => setModal({ kind: "text", title, md })
  };

  // --------------------------------------------------------- keyboard --
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName);
      // Ctrl+K opens the assistant
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAsk(true);
        return;
      }
      if (e.key === "Escape") {
        // the assistant sits above everything else, so it closes first
        if (ask) setAsk(false);
        else if (inc || modal) closeAll();
        setPop(null);
      }
      if (e.key === "/" && !typing) {
        e.preventDefault();
        document.getElementById("dic-q")?.focus();
      }
      if (!typing && !inc && !modal && (e.key === "PageDown" || e.key === "PageUp")) {
        e.preventDefault();
        const k = pages.indexOf(page) + (e.key === "PageDown" ? 1 : -1);
        if (pages[k]) setPage(pages[k]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inc, modal, ask, closeAll, page, pages]); // eslint-disable-line react-hooks/exhaustive-deps

  const bellN = bellRead ? 0 : ov.bell.length;
  // a degraded feed still delivered today's data (some of its endpoints are blocked), so it counts as live
  const feedsOk = ov.feeds.filter((f) => f.status === "ok" || f.status === "degraded").length;
  const feedsPartial = ov.feeds.filter((f) => f.status === "degraded").map((f) => String(f.source).toUpperCase());
  const pi = pages.indexOf(page);

  return (
    <div className={`dic${fit.on ? " fit" : ""}`}
      onClick={(e) => { if (!(e.target as HTMLElement).closest(".pop") && !(e.target as HTMLElement).closest("[data-pop]")) setPop(null); }}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs><linearGradient id="gBar" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#4D8DFF" /><stop offset="1" stopColor="#B9D2FF" /></linearGradient></defs>
      </svg>
      {loading && <div className="loading-bar" />}
      <div className="app" style={fit.on ? { zoom: fit.z, width: fit.w / fit.z, height: fit.h / fit.z } : undefined}>
        <div className="main">
          <header className="top">
            <div className="tbrand"><Logo className="tlogo" /><span><b>District <span>IQ</span></b><small>Collector&apos;s Console · Chennai</small></span></div>
            <button className="feedlight" onClick={c.openFeeds}
              title={`Data sources: status, refresh, add a source, OCR, audit log${feedsPartial.length ? `. Partly available (some endpoints blocked): ${feedsPartial.join(", ")}` : ""}`}>
              <i className={feedsOk === ov.feeds.length && !feedsPartial.length ? "" : "warn"} />{feedsOk}/{ov.feeds.length} feeds live
              {feedsPartial.length > 0 && <small className="feedpart">{feedsPartial.length} partial</small>}
            </button>
            <Search c={c} ov={ov} />
            <Collected ov={ov} onClick={c.openFeeds} />
            <button className="tbtn" onClick={c.openWorkspace} title="Save or reopen a workspace"><I n="layers" /><span className="lb">{workspaceName ? workspaceName.slice(0, 18) : "Workspace"}</span></button>
            <button className="tbtn icon" onClick={() => setModal({ kind: "customize", title: "Customize the dashboard" })} title="Choose what the dashboard shows" aria-label="Customize"><I n="sliders" /></button>
            <button className="tbtn pri" onClick={() => setModal({ kind: "export", title: "Export report" })}><I n="download" /><span className="lb">Export</span></button>
            <div className="rel">
              <button className="tbtn icon" data-pop onClick={() => setPop((p) => (p === "bell" ? null : "bell"))} aria-label="Alerts">
                <I n="bell" />{bellN > 0 && <span className="dot-n">{bellN}</span>}
              </button>
              {pop === "bell" && (
                <div className="pop">
                  <div className="pop-h">Severe and high · last 24 hours<button className="lnk" onClick={() => { setBellRead(true); setPop(null); }}>Mark all read</button></div>
                  {ov.bell.length ? ov.bell.map((i) => (
                    <button key={i.id} className="pop-i" onClick={() => { setPop(null); c.openInc(i.id); }}>
                      <span className={`kpi-ic ${sevTone(i.sev)}`} style={{ width: 34, height: 34 }}><I n={deptIcon(i.dept)} /></span>
                      <span><b>{fullTitle(i)}</b><small>{i.zone_name ?? "Chennai"} · {i.sev} · {rel(i.t, ov.now)}</small></span>
                    </button>
                  )) : <div className="empty">No alerts.</div>}
                </div>
              )}
            </div>
            <div className="rel">
              <button className="me" data-pop onClick={() => setPop((p) => (p === "profile" ? null : "profile"))}>
                <span className="avatar">CO</span>
                <span className="who"><b>Collector&apos;s Office</b></span><I n="chevd" />
              </button>
              {pop === "profile" && (
                <div className="pop" style={{ width: 290 }}>
                  <div className="pop-h">Collector&apos;s Office</div>
                  <div style={{ padding: "0 8px 8px", color: "var(--text-3)", fontSize: 13 }}>
                    Signed in as {user}. Figures come from the district intelligence store, as of {fmtTime(ov.now)}.
                  </div>
                  <button className="pop-i" onClick={() => { setPop(null); setModal({ kind: "sources", title: "Data sources", tab: "audit" }); }}><I n="doc" /><span><b>Audit log</b><small>Every decision and change</small></span></button>
                  <button className="pop-i" onClick={() => { setPop(null); setReloadKey((k) => k + 1); }}><I n="refresh" /><span><b>Reload data</b><small>Fetch the latest from the store</small></span></button>
                  <button className="pop-i" onClick={() => { setPop(null); setDept(null); setZone(null); setCatState(null); setTalukState(null); }}><I n="home" /><span><b>Clear all filters</b><small>Whole district, every department</small></span></button>
                  <button className="pop-i" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}>
                    <I n="user" /><span><b>Sign out</b></span>
                  </button>
                </div>
              )}
            </div>
          </header>

          <div className="body">
            <section className="phead">
              <h1>{PAGE_TITLE[page]}</h1>
              {page === "environment" || page === "trends" ? (
                <span className="fnote"><I n="map" />{page === "trends"
                  ? "Whole district, not filtered. Click any row to see what is behind it."
                  : "Whole district: choose a station on each card. Prices are shown per Chennai market."}</span>
              ) : (
                // every filter in one group, in the order the Collector narrows down: when, where, which department
                <div className="filters" role="group" aria-label="Filters">
                  <div className="seg fseg" role="tablist" aria-label="Period">
                    {PERIOD_KEYS.map((p) => (
                      <button key={p} role="tab" aria-selected={period === p} className={period === p ? "on" : ""} title={PERIOD_HINT[p]}
                        onClick={() => { setPeriod(p); setAnim(true); }}>{PERIOD_WORD[p]}</button>
                    ))}
                  </div>
                  <label className="fsel" title="Zone (Greater Chennai Corporation)"><I n="pin" />
                    <select value={zone ?? ""} onChange={(e) => setZone(e.target.value ? Number(e.target.value) : null)} aria-label="Zone">
                      <option value="">All 15 zones</option>
                      {ov.zoneTable.map((z) => <option key={z.zone} value={z.zone}>{z.name}</option>)}
                    </select>
                  </label>
                  <label className="fsel" title="Revenue taluk"><I n="map" />
                    <select value={taluk ?? ""} onChange={(e) => setTaluk(e.target.value || null)} aria-label="Taluk">
                      <option value="">All taluks</option>
                      {[...(geo?.taluks ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                    </select>
                  </label>
                  <label className="fsel" title="Department"><I n="gov" />
                    <select value={dept ?? ""} onChange={(e) => setDept(e.target.value || null)} aria-label="Department">
                      <option value="">All departments</option>
                      {depts.map((d) => <option key={d.code} value={d.code}>{d.name}{d.open && d.code !== dept ? ` (${d.open} open)` : ""}</option>)}
                    </select>
                  </label>
                  {cat && <span className="fchip alt" title="Category filter">{catLabel}<button onClick={() => setCat(null)} aria-label="Clear category"><I n="x" /></button></span>}
                  {(zone || dept || cat || taluk) && <button className="fclear" onClick={() => { setDept(null); setZone(null); setCatState(null); setTalukState(null); }}><I n="x" />Clear</button>}
                </div>
              )}
              <div className="pager" role="tablist" aria-label="Pages">
                <button className="nx" onClick={() => pages[pi - 1] && setPage(pages[pi - 1])} disabled={pi <= 0} aria-label="Previous page"><I n="chevl" /></button>
                {pages.map((p, k) => (
                  <button key={p} role="tab" aria-selected={page === p} className={`pg${page === p ? " on" : ""}`} onClick={() => setPage(p)} title={PAGE_TITLE[p]}>
                    <i>{k + 1}</i>{page === p && <span>{p === "environment" ? "Environment" : PAGE_TITLE[p]}</span>}
                  </button>
                ))}
                <button className="nx" onClick={() => pages[pi + 1] && setPage(pages[pi + 1])} disabled={pi >= pages.length - 1} aria-label="Next page"><I n="chevr" /></button>
              </div>
            </section>
            <div id="view" className={anim ? "anim" : ""}>
              {page === "overview" ? <Page1 d={ov} c={c} />
                : page === "briefing" ? <BriefingPage ins={ins} d={ov} c={c} />
                  : page === "trends" ? <TrendsPage ins={ins} c={c} />
                    : <EnvPage d={ov} ins={ins} c={c} />}
            </div>
          </div>
        </div>

        {(inc || modal) && <div className="scrim" onClick={closeAll} />}
        {inc && <IncidentView id={inc} c={c} />}
        {modal && (
          <Modal title={modal.title} c={c} narrow={["depts", "zones", "customize", "item"].includes(modal.kind)} wide={["stories", "markets", "pattern"].includes(modal.kind)}>
            {modal.kind === "list" ? <ListBody key={modal.title} preset={modal.preset} c={c} />
              : modal.kind === "zones" ? <ZonesBody d={ov} c={c} />
                : modal.kind === "depts" ? <DeptsBody c={c} />
                  : modal.kind === "sources" ? <SourcesBody c={c} initial={modal.tab} />
                    : modal.kind === "export" ? <ExportBody c={c} />
                      : modal.kind === "news" ? <NewsAllBody d={ov} c={c} />
                        : modal.kind === "workspace" ? <WorkspaceBody c={c} />
                          : modal.kind === "customize" ? <CustomizeBody c={c} />
                            : modal.kind === "contact" ? <ContactBody dept={modal.dept} contacts={modal.contacts} />
                              : modal.kind === "text" ? <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(modal.md) }} />
                                : modal.kind === "item" ? <ItemBody item={modal.item} c={c} />
                                  : modal.kind === "added" ? <AddedAllBody d={ov} c={c} />
                                    : modal.kind === "stories" ? <StoriesBody d={ov} c={c} focus={modal.focus} />
                                      : modal.kind === "markets" ? <MarketsFull ins={ins} c={c} />
                                        : modal.kind === "pattern" ? <PatternBody key={JSON.stringify(modal.pattern)} p={modal.pattern} c={c} />
                                          : modal.kind === "gaps" ? <GapsBody ins={ins} c={c} /> : null}
          </Modal>
        )}
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`toast${t.kind === "alert" ? " alert" : ""}`}>
              <I n={t.kind === "alert" ? "bell" : "checkc"} /><span>{t.msg}</span>
              {t.act && <button onClick={() => { t.act!.run(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.act.label}</button>}
            </div>
          ))}
        </div>
        <button className="ask-fab" onClick={() => setAsk((v) => !v)} aria-label="Ask District IQ (Ctrl+K)" title="Ask District IQ (Ctrl+K)" aria-expanded={ask}>
          <BrandMark size={34} className="ask-mark" /><span>Ask District IQ</span>
          {insightCount > 0 && !ask && <em className="ask-badge" aria-label={`${insightCount} insights for today`}>{insightCount}</em>}
        </button>
        {askMounted && <AssistantDialog c={c} open={ask} onClose={() => setAsk(false)} />}
      </div>
    </div>
  );
}

/** Did today's 6:00 AM collection happen? Green when every feed was fetched since 6:00 AM today. */
function Collected({ ov, onClick }: { ov: OverviewData; onClick: () => void }) {
  const s = ov.collection;
  const all = !!s && s.total > 0 && s.missing.length === 0;
  const head = !s ? "Collected daily, 6:00 AM"
    : all ? `Collected today, ${fmtTime(s.lastRun ?? ov.now)}`
      : s.running ? "Collecting now…"
        : s.done.length ? `Today: ${s.done.length} of ${s.total} feeds` : "Today's 6:00 AM run pending";
  const tip = !s ? "Every source is collected once a day at 6:00 AM."
    : `Every source is collected once a day from 6:00 AM (the laptop checks hourly until each is done).` +
      (s.lastRun ? ` Last collection: ${fmtTime(s.lastRun)}, ${fmtDate(s.lastRun)}.` : "") +
      (s.missing.length ? ` Not yet collected today: ${s.missing.join(", ")}.` : " All feeds collected today.") + " Click for the data sources.";
  return (
    <button className={`daily${s && !all ? " pend" : ""}`} title={tip} onClick={onClick}>
      <I n={all ? "checkc" : "clock"} /><span>{head}<small>Data as of {fmtTime(ov.now)}, {fmtDate(ov.now)}</small></span>
    </button>
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
        r.depts.forEach((d: Row) => out.push({ g: "Departments", ic: deptIcon(d.code), l: d.name, s: d.org, run: () => c.setDept(d.code) }));
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
