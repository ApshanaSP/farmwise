"use client";

/*
 * Department Officer console: one template for every department, laid out like the Collector
 * console with that department selected. It fits the window (no page scroll) and has pages:
 *
 *   1 Overview          the Collector's overview for the department (same numbers), with the
 *                       officer's work queue: approve, complete and send
 *   2 Grievances        the full grievance board, what needs the officer now, Collector feedback
 *   3 Department data   the store's data that concerns the department (weather, lakes, police
 *                       records, hospitals ...), what its grievances are about, its work record
 *   4 Trends            grievances over the period, by type, by area
 *
 * The department is decided on the server from the signed-in account; there is no way to open
 * another department or the Collector console from here (the Collector signs in separately).
 * Every figure comes from the unified district intelligence store. Ask District IQ answers for
 * this department only.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Logo from "@/components/Logo";
import { I } from "@/components/collector/app/icons";
import { BrandMark } from "@/components/collector/app/assistant/Brand";
import type { AssistantHost } from "@/components/collector/app/assistant/host";
import { ContactBody } from "@/components/collector/app/Overlays";
import { Empty, deptIcon, fmtDate, fmtTime, fullTitle, rel, sevTone, type Row } from "@/components/collector/app/lib";
import { esc } from "@/components/collector/app/SatMap";
import type { MapGeo } from "@/lib/collector/geo";
import type { DeptProfile, OfficerOverview } from "@/lib/officer/data";
import type { InsightModule } from "@/lib/officer/insights";
import { OFFICER } from "@/lib/officer/departments";
import { STAGE_LABEL, type Stage, type Tab } from "@/lib/officer/stages";
import { OverviewPage } from "./Board";
import { AreaCard, FeedbackCard, GrievancesCard, PrioritiesCard, TrendCard, TypeCard } from "./Cards";
import { GrievanceDrawer } from "./Drawer";
import { ModuleFull, ModuleTile } from "./Insights";
import { ListBody, Modal } from "./Overlays";
import { SendReport } from "./Report";
import { PERIOD_KEYS, type Period } from "./format";
import "@/components/collector/app/collector.css";
import "./officer.css";

// Ask District IQ loads only when it is first opened, so the console stays fast.
const AssistantDialog = dynamic(() => import("@/components/collector/app/assistant/AssistantDialog"), { ssr: false });

/** laid out for this canvas and scaled to the window, like the Collector console */
const FIT_W = 1366;
const FIT_H = 680;

type PageKey = "overview" | "grievances" | "data" | "trends";
const PAGES: PageKey[] = ["overview", "grievances", "data", "trends"];
const PAGE_TITLE: Record<PageKey, string> = { overview: "Overview", grievances: "Grievances", data: "Department data", trends: "Trends" };
const PERIOD_WORD: Record<Period, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" };
const PERIOD_HINT: Record<Period, string> = {
  daily: "Daily: only today, from midnight", weekly: "Weekly: the last 7 days", monthly: "Monthly: the last 30 days", quarterly: "Quarterly: the last 90 days"
};

export interface ListData { rows: Row[]; total: number; page: number; per: number }
interface Toast { id: number; msg: string; kind: "ok" | "alert"; act?: { label: string; run: () => void } }
export type ListFlag = "open" | "serious" | "overdue" | "due";
type ModalState = { kind: "send"; row: Row }
  | { kind: "list"; cat: string | null; flag?: ListFlag; sev?: string | null; tab?: string; label: string }
  | { kind: "module"; key: string } | { kind: "contacts" } | { kind: "news" };

/** What the cards, drawer and overlays need from the shell. */
export interface Ctx {
  ov: OfficerOverview;
  dept: DeptProfile;
  /** "now" for relative times: the later of the pipeline's as-of time and the wall clock (IST) */
  now: string;
  fit: boolean;
  geo: MapGeo | null;
  zone: number | null;
  taluk: string | null;
  zoneName: string | null;
  talukName: string | null;
  /** the zone and / or taluk in view, e.g. "Adyar · Velachery taluk"; null for the whole district */
  areaName: string | null;
  /** period, zone and taluk as a query string, for the APIs */
  scopeQs: string;
  setZone: (z: number | null) => void;
  setTaluk: (t: string | null) => void;
  zoneTip: (z: number) => string;
  tab: Tab;
  setTab: (t: Tab) => void;
  setPage: (p: number) => void;
  setPer: (n: number) => void;
  list: ListData | null;
  listLoading: boolean;
  listError: string | null;
  retryList: () => void;
  fresh: string | null;
  busy: Set<string>;
  reloadKey: number;
  openGrievance: (id: string, mode?: "off" | "news") => void;
  openSend: (r: Row) => void;
  openList: (cat: string | null, label: string, flag?: ListFlag, more?: { sev?: string | null; tab?: string }) => void;
  approve: (r: Row) => Promise<void>;
  toast: (msg: string, kind?: "ok" | "alert", act?: Toast["act"]) => void;
  closeAll: () => void;
}

async function api(path: string, body?: unknown) {
  const r = await fetch(path, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" }
    : { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { window.location.href = "/login?redirect=/officer"; throw new Error("Your session has ended. Sign in again."); }
  if (!r.ok) throw new Error(j.error || "Request failed.");
  return j;
}

/** Current IST wall-clock time as "YYYY-MM-DD HH:MM:SS", the format the store uses. */
const istNow = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
/** "officer.gcc-swm@chennai.gov.in" -> "officer.gcc-swm": the name the officer signs in with, shown on the console */
const loginName = (email: string) => email.split("@")[0];

export default function OfficerApp({ initial, user }: { initial: OfficerOverview; user: string }) {
  const dept = initial.dept;
  const [ov, setOv] = useState<OfficerOverview>(initial);
  const [period, setPeriodState] = useState<Period>(initial.period);
  const [zone, setZoneState] = useState<number | null>(null);
  const [taluk, setTalukState] = useState<string | null>(null);
  const [view, setView] = useState<PageKey>("overview");
  const [tab, setTabState] = useState<Tab>("new");
  const [page, setPageState] = useState(0);
  const [per, setPerState] = useState(8);
  const [list, setList] = useState<ListData | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listRetry, setListRetry] = useState(0);
  const [insights, setInsights] = useState<InsightModule[] | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsRetry, setInsightsRetry] = useState(0);
  const [geo, setGeo] = useState<MapGeo | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [anim, setAnim] = useState(true);
  const [drawer, setDrawer] = useState<{ id: string; mode: "off" | "news" } | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [pop, setPop] = useState<"bell" | "profile" | "feeds" | null>(null);
  const [ask, setAskState] = useState(false);
  // once opened, the assistant stays mounted so the conversation survives closing it
  const [askMounted, setAskMounted] = useState(false);
  const setAsk = useCallback((v: boolean | ((x: boolean) => boolean)) => {
    setAskState((x) => {
      const next = typeof v === "function" ? v(x) : v;
      if (next) setAskMounted(true);
      return next;
    });
  }, []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState<string | null>(null);
  // starts at the store's as-of time so the server and browser render the same text; the wall clock takes over after mount
  const [clock, setClock] = useState(initial.now);
  const [seen, setSeen] = useState<string>("");
  const [fit, setFit] = useState<{ on: boolean; z: number; w: number; h: number }>({ on: true, z: 1, w: FIT_W, h: FIT_H });
  const firstOv = useRef(true);
  const dirty = useRef(false);
  const pulse = useRef({ newCount: -1, exportedAt: initial.exportedAt, lastDecision: null as string | null, updatedAt: initial.updated.at });
  const seenKey = `diq-officer-seen:${user}:${dept.code}`;

  // Fit to the window like the Collector console: laid out for 1366 x 680 and scaled; phones stack instead.
  useLayoutEffect(() => {
    const f = () => {
      const w = window.innerWidth, h = window.innerHeight;
      const on = w >= 700 && h >= 380;
      const raw = Math.min(w / FIT_W, h / FIT_H);
      const z = on ? Math.max(0.5, Math.min(1.3, raw > 1 && raw < 1.08 ? 1 : raw)) : 1;
      setFit({ on, z: Math.round(z * 1000) / 1000, w, h });
    };
    f();
    try { setSeen(localStorage.getItem(seenKey) ?? ""); } catch { /* storage unavailable */ }
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, [seenKey]);

  useEffect(() => {
    fetch("/api/officer/geo").then((r) => (r.ok ? r.json() : null)).then((g) => g && setGeo(g)).catch(() => {});
    setClock(istNow());
    const t = setInterval(() => setClock(istNow()), 30_000);
    return () => clearInterval(t);
  }, []);

  const toast = useCallback((msg: string, kind: "ok" | "alert" = "ok", act?: Toast["act"]) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind, act }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "alert" ? 7000 : 3600);
  }, []);

  const scopeQs = useMemo(() => {
    const p = new URLSearchParams({ period });
    if (zone) p.set("zone", String(zone));
    if (taluk) p.set("taluk", taluk);
    return p.toString();
  }, [period, zone, taluk]);

  // --------------------------------------------------------------- data --
  useEffect(() => {
    if (firstOv.current) { firstOv.current = false; return; }
    let live = true;
    setLoading(true);
    api(`/api/officer/overview?${scopeQs}`)
      .then((j) => live && setOv(j))
      .catch((e) => live && toast(e.message, "alert"))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [scopeQs, reloadKey, toast]);

  const listKey = useRef("");
  useEffect(() => {
    if (view !== "grievances") return;
    let live = true;
    // another tab or area: show loading rows, not the previous tab's rows under this tab's name
    if (listKey.current !== `${tab}|${scopeQs}`) { listKey.current = `${tab}|${scopeQs}`; setList(null); }
    setListLoading(true);
    setListError(null);
    const p = new URLSearchParams(scopeQs);
    p.set("tab", tab); p.set("page", String(page)); p.set("per", String(per));
    api(`/api/officer/grievances?${p}`)
      .then((j: ListData) => {
        if (!live) return;
        // the list shrank under the current page (after an action): step back to the last page
        if (!j.rows.length && j.page > 0 && j.total > 0) setPageState(Math.max(0, Math.ceil(j.total / j.per) - 1));
        else setList(j);
      })
      .catch((e) => live && setListError(e.message))
      .finally(() => live && setListLoading(false));
    return () => { live = false; };
  }, [view, tab, page, per, scopeQs, reloadKey, listRetry]);

  // the department's data from the store: page 3, and the priorities on page 2 that come from it
  useEffect(() => {
    let live = true;
    setInsightsError(null);
    api(`/api/officer/insights?${scopeQs}`)
      .then((j) => live && setInsights(j.modules))
      .catch((e) => live && setInsightsError(e.message));
    return () => { live = false; };
  }, [scopeQs, reloadKey, insightsRetry]);

  useEffect(() => {
    if (!anim) return;
    const t = setTimeout(() => setAnim(false), 1200);
    return () => clearTimeout(t);
  }, [anim]);

  // New grievances, Collector decisions and new pipeline builds: checked every minute.
  const isBusy = () => !!(drawer || modal || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)));
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const m = await api("/api/officer/overview?meta=1");
        const was = pulse.current;
        let changed = m.exportedAt !== was.exportedAt;
        if (was.newCount >= 0 && m.newCount > was.newCount) {
          const k = m.newCount - was.newCount;
          toast(`${k} new grievance${k === 1 ? "" : "s"} for ${dept.short} waiting for your approval.`, "alert", { label: "View", run: () => goGrievances("new") });
          changed = true;
        }
        if (was.lastDecision && m.lastDecision && m.lastDecision !== was.lastDecision) {
          toast("The Collector has reviewed one of your reports. See Notifications.", "alert");
          changed = true;
        }
        if (m.updatedAt && m.updatedAt !== was.updatedAt) {
          toast(`New data collected (${fmtTime(m.updatedAt)}).`);
          changed = true;
        }
        pulse.current = { newCount: m.newCount, exportedAt: m.exportedAt, lastDecision: m.lastDecision, updatedAt: m.updatedAt };
        if (changed) {
          if (isBusy()) dirty.current = true;
          else setReloadKey((k) => k + 1);
        }
      } catch { /* offline: try again next minute */ }
    }, OFFICER.pollMs);
    return () => clearInterval(t);
  });

  // ---------------------------------------------------------- navigation --
  const closeAll = useCallback(() => {
    setDrawer(null);
    setModal(null);
    if (dirty.current) { dirty.current = false; setReloadKey((k) => k + 1); }
  }, []);
  const goPage = (p: PageKey) => { setView(p); setAnim(true); };
  const setTab = useCallback((t: Tab) => { setTabState(t); setPageState(0); }, []);
  /** the grievance board on page 2, at one tab */
  const goGrievances = (t: Tab) => { setTab(t); goPage("grievances"); };
  const setPer = useCallback((n: number) => setPerState((p) => (p === n ? p : n)), []);
  const zoneName = zone ? ov.zones.find((z) => z.zone === zone)?.name ?? `Zone ${zone}` : null;
  const talukName = taluk ? ov.taluks.find((t) => t.code === taluk)?.name ?? taluk : null;
  const areaName = [zoneName, talukName ? `${talukName} taluk` : null].filter(Boolean).join(" · ") || null;
  const talukOptions = zone ? ov.taluks.filter((t) => ov.zones.find((z) => z.zone === zone)?.taluks.includes(t.code)) : ov.taluks;
  const setPeriod = (p: Period) => { setPeriodState(p); setPageState(0); setAnim(true); };
  const setZone = (z: number | null) => {
    setZoneState(z);
    // keep the taluk only if it lies in the new zone
    if (z && taluk && !ov.zones.find((x) => x.zone === z)?.taluks.includes(taluk)) setTalukState(null);
    setPageState(0);
    setAnim(true);
    closeAll();
    const name = z ? ov.zones.find((x) => x.zone === z)?.name : null;
    if (z && name) toast(`Showing ${name} zone. All panels filtered.`);
  };
  const setTaluk = (t: string | null) => {
    setTalukState(t);
    setPageState(0);
    setAnim(true);
    closeAll();
    const name = t ? ov.taluks.find((x) => x.code === t)?.name : null;
    if (t && name) toast(`Showing ${name} taluk. All panels filtered.`);
  };

  // ------------------------------------------------------------- actions --
  const markBusy = (id: string, on: boolean) => setBusyIds((b) => { const n = new Set(b); if (on) n.add(id); else n.delete(id); return n; });
  const approve = async (r: Row) => {
    markBusy(r.id, true);
    try {
      await api(`/api/officer/grievances/${encodeURIComponent(r.id)}`, { step: "approve" });
      setFresh(r.id);
      toast(`Approved: ${r.type}${r.zone_name ? `, ${r.zone_name}` : ""}. It is now In action; complete and send it when the work is done.`);
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      toast(e.message, "alert");
      setReloadKey((k) => k + 1);
    } finally {
      markBusy(r.id, false);
    }
  };

  /** The PDF report of what is on screen: this period, this area, with the department's insights. */
  const exportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    toast("Preparing the PDF report…");
    try {
      const qs = (t: Tab) => { const p = new URLSearchParams(scopeQs); p.set("tab", t); p.set("per", "15"); return p.toString(); };
      // read everything afresh so the report matches the store at the moment of export
      const [latest, a, b, ins, { buildOfficerReport }] = await Promise.all([
        api(`/api/officer/overview?${scopeQs}`), api(`/api/officer/grievances?${qs("new")}`), api(`/api/officer/grievances?${qs("action")}`),
        api(`/api/officer/insights?${scopeQs}`), import("./reportPdf")
      ]);
      setOv(latest);
      const stamp = String(latest.now).slice(0, 10);
      buildOfficerReport({
        ov: latest, area: areaName, waiting: [...a.rows, ...b.rows].slice(0, 25), modules: ins.modules,
        file: `${dept.code.toLowerCase()}-officer-report-${period}-${stamp}.pdf`
      });
      toast("PDF report downloaded.");
    } catch (e: any) {
      toast(e.message || "Could not build the PDF.", "alert");
    } finally {
      setExporting(false);
    }
  };

  const c: Ctx = {
    ov, dept, now: clock > ov.now ? clock : ov.now, fit: fit.on, geo, zone, taluk, zoneName, talukName, areaName, scopeQs, setZone, setTaluk,
    zoneTip: (z) => {
      const name = ov.zones.find((x) => x.zone === z)?.name ?? `Zone ${z}`;
      const n = ov.board.map.zoneCounts[z] ?? 0;
      return `<b>${esc(name)}</b>${n} incident${n === 1 ? "" : "s"}<br><span style="opacity:.7">Click to ${zone === z ? "keep" : "filter to"} this zone</span><br>`;
    },
    tab, setTab, setPage: (p) => setPageState(Math.max(0, p)), setPer,
    list, listLoading, listError, retryList: () => setListRetry((n) => n + 1),
    fresh, busy: busyIds, reloadKey,
    openGrievance: (id, mode = "off") => { setModal(null); setDrawer({ id, mode }); },
    openSend: (r) => { setDrawer(null); setModal({ kind: "send", row: r }); },
    openList: (cat, label, flag, more) => { setDrawer(null); setModal({ kind: "list", cat, label, flag, sev: more?.sev ?? null, tab: more?.tab }); },
    approve, toast, closeAll
  };

  // ----------------------------------------------------------- keyboard --
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName);
      // Ctrl+K opens the assistant, as on the Collector console
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAsk(true);
        return;
      }
      if (e.key === "Escape") {
        // the assistant sits above everything else, so it closes first
        if (ask) setAsk(false);
        else if (drawer || modal) closeAll();
        setPop(null);
      }
      if (e.key === "/" && !typing) {
        e.preventDefault();
        document.getElementById("ofc-q")?.focus();
      }
      if (!typing && !drawer && !modal && !ask && (e.key === "PageDown" || e.key === "PageUp")) {
        e.preventDefault();
        const k = PAGES.indexOf(view) + (e.key === "PageDown" ? 1 : -1);
        if (PAGES[k]) goPage(PAGES[k]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, modal, ask, closeAll, setAsk, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const unread = ov.feedback.filter((f) => !seen || String(f.at) > seen);
  const markRead = () => {
    const latest = String(ov.feedback[0]?.at ?? istNow());
    setSeen(latest);
    try { localStorage.setItem(seenKey, latest); } catch { /* not saved in this browser */ }
  };
  const feedsOk = ov.feeds.filter((f) => f.status === "ok" || f.status === "degraded").length;
  const me = loginName(user);
  const pi = PAGES.indexOf(view);
  const openModule = (key: string) => { setDrawer(null); setModal({ kind: "module", key }); };
  const moduleOpen = modal?.kind === "module" ? insights?.find((m) => m.key === modal.key) ?? null : null;
  const snap = ov.board.snapshot as Row;

  // Ask District IQ over this console: the department is fixed (the server locks an officer's answers to it)
  const host: AssistantHost = {
    period, periodLabel: ov.periodInfo.label, zone, zoneName, dept: dept.code, deptName: dept.name, cat: null, taluk,
    talukName: (code) => (code ? ov.taluks.find((t) => t.code === code)?.name ?? code : null),
    geo, setZone, setTaluk, setPeriod,
    setDept: () => undefined, setCat: () => undefined, openStories: () => undefined, setPage: () => undefined,
    openInc: (id) => c.openGrievance(id),
    officer: {
      who: { en: `${dept.short} officer`, ta: `${dept.short} அலுவலர் அவர்களே`, tanglish: `${dept.short} officer` },
      examples: {
        en: ["Summarize this week", "Show open complaints this week", "Which areas have the most complaints?", "Severe incidents this week"],
        ta: ["இந்த வாரம் எத்தனை புகார்கள்?", "இந்த வாரம் கடுமையான சம்பவங்கள்", "எந்த மண்டலத்தில் அதிக சம்பவங்கள்?", "இந்த மாதம் எத்தனை சம்பவங்கள்?"],
        tanglish: ["Indha week summary", "Show open complaints this week", "Endha area la neraya complaints?", "Indha week severe incidents evlo?"]
      },
      labels: {
        en: ["This week", "Open grievances", "Where to send teams", "Severe incidents"],
        ta: ["இந்த வாரம்", "கடுமையான சம்பவங்கள்", "மண்டலங்கள்", "இந்த மாதம்"],
        tanglish: ["Indha week", "Open grievances", "Enga team anuppanum", "Severe incidents"]
      }
    }
  };

  const modalTitle = !modal ? "" : modal.kind === "send" ? "Completion report to the Collector"
    : modal.kind === "module" ? `${moduleOpen?.title ?? "Department data"} · ${areaName ?? dept.name}`
      : modal.kind === "contacts" ? `${dept.name} · contacts`
        : modal.kind === "news" ? `${dept.short} in the news · ${ov.periodInfo.label}`
          : `${modal.label} · ${areaName ?? dept.name}`;
  // modules on page 3: up to three across, the rows sharing the height
  const nMod = insights?.length ?? 0;
  const modCols = nMod <= 3 ? Math.max(1, nMod) : nMod === 4 ? 2 : 3;

  return (
    <div className={`dic ofc${fit.on ? " fit" : ""}`}
      onClick={(e) => { if (!(e.target as HTMLElement).closest(".pop") && !(e.target as HTMLElement).closest("[data-pop]")) setPop(null); }}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs><linearGradient id="gBar" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#4D8DFF" /><stop offset="1" stopColor="#B9D2FF" /></linearGradient></defs>
      </svg>
      {(loading || exporting) && <div className="loading-bar" />}
      <div className="app" style={fit.on ? { zoom: fit.z, width: fit.w / fit.z, height: fit.h / fit.z } : undefined}>
        <div className="main">
          <header className="top">
            <div className="tbrand"><Logo className="tlogo" /><span><b>District <span>IQ</span></b><small>Officer Console · {dept.short}</small></span></div>
            <div className="rel">
              <button className="feedlight" data-pop onClick={() => setPop((p) => (p === "feeds" ? null : "feeds"))} title="Data feeds behind this dashboard">
                <i className={feedsOk === ov.feeds.length ? "" : "warn"} />{feedsOk}/{ov.feeds.length} feeds live
              </button>
              {pop === "feeds" && (
                <div className="pop" style={{ left: 0, right: "auto", width: 320 }}>
                  <div className="pop-h">Data feeds</div>
                  {ov.updated.sources.map((s) => (
                    <div key={s.source} className="pop-i ofeed">
                      <span className={`kpi-ic ${s.failed ? "t-high" : "t-low"}`} style={{ width: 30, height: 30 }}><I n={s.failed ? "alert" : "checkc"} /></span>
                      <span><b>{s.label}</b><small>{s.newest ? `Data up to ${fmtTime(s.newest)}, ${fmtDate(s.newest)}` : "No data"}{s.failed ? ` · ${s.failed}` : ""}</small></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Search c={c} />
            <Collected ov={ov} />
            <button className="tbtn pri" onClick={exportPdf} disabled={exporting} title="Download a PDF report of this period and area">
              <I n={exporting ? "refresh" : "download"} className={exporting ? "spin" : ""} /><span className="lb">Export</span>
            </button>
            <div className="rel">
              <button className="tbtn icon" data-pop onClick={() => setPop((p) => (p === "bell" ? null : "bell"))} aria-label="Notifications">
                <I n="bell" />{unread.length > 0 && <span className="dot-n">{unread.length}</span>}
              </button>
              {pop === "bell" && (
                <div className="pop">
                  <div className="pop-h">The Collector&apos;s decisions<button className="lnk" onClick={() => { markRead(); setPop(null); }}>Mark all read</button></div>
                  {ov.feedback.length ? ov.feedback.slice(0, 6).map((f) => (
                    <button key={f.did} className="pop-i" onClick={() => { setPop(null); c.openGrievance(f.id); }}>
                      <span className={`kpi-ic ${f.ok ? "t-low" : "t-high"}`} style={{ width: 32, height: 32 }}><I n={f.ok ? "checkc" : "refresh"} /></span>
                      <span><b>{f.ok ? "Collector verified" : "Collector returned for rework"}: {f.title ?? f.type}</b>
                        <small>{rel(f.at, c.now)}{!seen || String(f.at) > seen ? " · new" : ""}</small></span>
                    </button>
                  )) : <div className="empty">No notifications in this period.</div>}
                </div>
              )}
            </div>
            <div className="rel">
              <button className="me ome" data-pop onClick={() => setPop((p) => (p === "profile" ? null : "profile"))} aria-label={`Account: signed in as ${user}`}
                title={`Signed in as ${user}`}>
                <span className="avatar">{dept.short.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase()}</span>
                <span className="who"><small>Logged in as</small><b>{me}</b></span><I n="chevd" />
              </button>
              {pop === "profile" && (
                <div className="pop" style={{ width: 320 }}>
                  <div className="pop-h">{me}</div>
                  <div style={{ padding: "0 8px 8px", color: "var(--text-3)", fontSize: 13, lineHeight: 1.45 }}>
                    Signed in as <b style={{ color: "var(--text)" }}>{user}</b><br />{dept.name}{dept.org ? `, ${dept.org}` : ""} · Department officer
                    {dept.route ? <><br />Escalation: {dept.route}</> : null}
                  </div>
                  <button className="pop-i" onClick={() => { setPop(null); setReloadKey((k) => k + 1); }}><I n="refresh" /><span><b>Reload data</b><small>Fetch the latest from the store</small></span></button>
                  {(zone || taluk) && <button className="pop-i" onClick={() => { setPop(null); setZone(null); setTaluk(null); }}><I n="home" /><span><b>Clear the area filter</b><small>Every zone and taluk</small></span></button>}
                  <button className="pop-i" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}>
                    <I n="user" /><span><b>Sign out</b></span>
                  </button>
                </div>
              )}
            </div>
          </header>

          <div className="body">
            <section className="phead">
              <h1>{PAGE_TITLE[view]}</h1>
              {view === "trends" ? null : (
                <div className="filters" role="group" aria-label="Filters">
                  <div className="seg fseg" role="tablist" aria-label="Period">
                    {PERIOD_KEYS.map((p) => (
                      <button key={p} role="tab" aria-selected={period === p} className={period === p ? "on" : ""} title={PERIOD_HINT[p]} onClick={() => setPeriod(p)}>{PERIOD_WORD[p]}</button>
                    ))}
                  </div>
                  <label className="fsel" title="Zone (Greater Chennai Corporation)"><I n="pin" />
                    <select value={zone ?? ""} onChange={(e) => setZone(e.target.value ? Number(e.target.value) : null)} aria-label="Zone">
                      <option value="">All 15 zones</option>
                      {ov.zones.map((z) => <option key={z.zone} value={z.zone}>{z.name}</option>)}
                    </select>
                  </label>
                  <label className="fsel" title={zone ? `Revenue taluks in ${zoneName} zone` : "Revenue taluk"}><I n="map" />
                    <select value={taluk ?? ""} onChange={(e) => setTaluk(e.target.value || null)} aria-label="Taluk">
                      <option value="">{zone ? `All taluks in ${zoneName}` : "All taluks"}</option>
                      {talukOptions.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                    </select>
                  </label>
                  {/* the department is fixed: it is the signed-in officer's */}
                  <span className="fchip alt odept-chip" title={`${dept.name}: your department (fixed for this account)`}><I n={deptIcon(dept.code)} />{dept.name}</span>
                  {(zone || taluk) && <button className="fclear" onClick={() => { setZone(null); setTaluk(null); }}><I n="x" />Clear</button>}
                </div>
              )}
              {view === "trends" && <span className="fnote"><I n="map" />{ov.periodInfo.label}{areaName ? ` · ${areaName}` : " · all zones"} · {dept.name}</span>}
              <div className="pager" role="tablist" aria-label="Pages">
                <button className="nx" onClick={() => PAGES[pi - 1] && goPage(PAGES[pi - 1])} disabled={pi <= 0} aria-label="Previous page"><I n="chevl" /></button>
                {PAGES.map((p, k) => (
                  <button key={p} role="tab" aria-selected={view === p} className={`pg${view === p ? " on" : ""}`} onClick={() => goPage(p)} title={PAGE_TITLE[p]}>
                    <i>{k + 1}</i>{view === p && <span>{PAGE_TITLE[p]}</span>}
                  </button>
                ))}
                <button className="nx" onClick={() => PAGES[pi + 1] && goPage(PAGES[pi + 1])} disabled={pi >= PAGES.length - 1} aria-label="Next page"><I n="chevr" /></button>
              </div>
            </section>

            <div id="view" className={anim ? "anim" : ""}>
              {view === "overview" ? (
                <OverviewPage c={c} goGrievances={goGrievances} openContacts={() => setModal({ kind: "contacts" })} openNews={() => setModal({ kind: "news" })} />
              ) : view === "grievances" ? (
                <section className="op2">
                  <GrievancesCard c={c} style={{ "--i": 0 } as React.CSSProperties} />
                  <PrioritiesCard c={c} modules={insights} openModule={openModule} style={{ "--i": 1 } as React.CSSProperties} />
                  <FeedbackCard c={c} style={{ "--i": 2 } as React.CSSProperties} />
                </section>
              ) : view === "data" ? (
                insightsError ? <div className="o-state err"><I n="alert" />{insightsError}<button className="btn sm plain" onClick={() => setInsightsRetry((n) => n + 1)}>Try again</button></div>
                  : !insights ? <div className="o-state">Reading the department&apos;s data…</div>
                    : (
                      <section className={`op3${modCols === 3 ? " cols3" : ""}`} style={{ gridTemplateColumns: `repeat(${modCols},minmax(0,1fr))`, gridTemplateRows: `repeat(${Math.ceil(nMod / modCols)},minmax(0,1fr))` }}>
                        {insights.map((m, k) => <ModuleTile key={m.key} m={m} c={c} onOpen={() => openModule(m.key)} style={{ "--i": k } as React.CSSProperties} />)}
                      </section>
                    )
              ) : (
                <section className="op4">
                  <TrendCard c={c} style={{ "--i": 0 } as React.CSSProperties} />
                  <TypeCard c={c} style={{ "--i": 1 } as React.CSSProperties} />
                  <AreaCard c={c} style={{ "--i": 2 } as React.CSSProperties} />
                </section>
              )}
            </div>
          </div>
        </div>

        {(drawer || modal) && <div className="scrim" onClick={closeAll} />}
        {drawer && <GrievanceDrawer id={drawer.id} mode={drawer.mode} c={c} onMode={(m) => setDrawer({ id: drawer.id, mode: m })} />}
        {modal && (
          <Modal narrow={modal.kind !== "module" && modal.kind !== "news"} title={modalTitle} onClose={closeAll}>
            {modal.kind === "send" ? (
              <SendReport row={modal.row} c={c} onSent={() => {
                const r = modal.row;
                toast(`Sent to the Collector for verification: ${r.type}.`);
                setFresh(r.id);
                setModal(null);
                setTab("sent");
                setDrawer({ id: r.id, mode: "off" });
                setReloadKey((k) => k + 1);
              }} />
            ) : modal.kind === "module" ? (moduleOpen ? <ModuleFull m={moduleOpen} c={c} /> : <div className="o-state">This data is no longer in view.</div>)
              : modal.kind === "contacts" ? <ContactBody dept={{ ...(snap.dept as Row ?? {}), code: dept.code, name: dept.name }} contacts={(snap.contacts as Row[] | undefined) ?? []} />
                : modal.kind === "news" ? <NewsAll c={c} />
                  : <ListBody c={c} cat={modal.cat} flag={modal.flag} sev={modal.sev} tab={modal.tab} />}
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
        </button>
        {askMounted && <AssistantDialog c={host} open={ask} onClose={() => setAsk(false)} />}
      </div>
    </div>
  );
}

/** Did today's 6:00 AM collection happen? The same chip as the Collector console's. */
function Collected({ ov }: { ov: OfficerOverview }) {
  const s = ov.board.collection;
  const all = !!s && s.total > 0 && s.missing.length === 0;
  const head = !s ? "Collected daily, 6:00 AM"
    : all ? `Collected today, ${fmtTime(s.lastRun ?? ov.now)}`
      : s.running ? "Collecting now…"
        : s.done.length ? `Today: ${s.done.length} of ${s.total} feeds` : "Today's 6:00 AM run pending";
  const tip = "Every source is collected once a day from 6:00 AM by the district intelligence pipeline." +
    (s?.missing.length ? ` Not yet collected today: ${s.missing.join(", ")}.` : "");
  return (
    <span className={`daily${s && !all ? " pend" : ""}`} title={tip}>
      <I n={all ? "checkc" : "clock"} /><span>{head}<small>Data as of {fmtTime(ov.now)}, {fmtDate(ov.now)}</small></span>
    </span>
  );
}

/** Every news report about the department in the period. */
function NewsAll({ c }: { c: Ctx }) {
  const items = c.ov.news;
  if (!items.length) return <Empty>No news reports about {c.dept.short} in this period.</Empty>;
  return (
    <div className="ngrid">
      {items.map((i) => (
        <button key={i.id} className="ncard" onClick={() => c.openGrievance(i.id, "news")}>
          <div className="nout">{(i.outletNames?.length ? i.outletNames : ["News"]).map((n: string) => <span key={n}>{n}</span>)}</div>
          <h4>{fullTitle(i)}</h4>
          <div className="nmeta"><span>{i.zone_name ?? "Chennai"}</span><span>{i.type}</span><span>{rel(i.t, c.now)}</span></div>
          {i.summary && <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>{i.summary}</p>}
        </button>
      ))}
    </div>
  );
}

/** Search the department's grievances of the last 90 days; picking one opens it. */
function Search({ c }: { c: Ctx }) {
  const [text, setText] = useState("");
  const [hits, setHits] = useState<Row[] | null>(null);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) { setHits(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api(`/api/officer/search?q=${encodeURIComponent(q)}`);
        if (live) { setHits(r.rows); setIdx(0); }
      } catch { /* ignore */ }
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [text]);
  const pick = (r: Row) => { setText(""); setHits(null); c.openGrievance(r.id); };
  return (
    <div className="search">
      <input id="ofc-q" type="search" placeholder={`Search ${c.dept.short} grievances, streets, IDs…`} autoComplete="off" aria-label="Search"
        value={text} onChange={(e) => setText(e.target.value)} onBlur={() => setTimeout(() => setHits(null), 150)}
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
          {hits.length ? <>
            <div className="sh">Grievances</div>
            {hits.map((h, k) => (
              <button key={h.id} className={k === idx ? "hl" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)}>
                <span className={`si-ic ${sevTone(h.sev)}`} style={{ width: 26, height: 26 }}><I n={deptIcon(c.dept.code)} /></span>
                <span>{fullTitle(h)}</span><small>{STAGE_LABEL[h.stage as Stage]} · {rel(h.t, c.now)}</small>
              </button>
            ))}
          </> : <div className="empty">No matches. Try a street, area, type or grievance ID.</div>}
        </div>
      )}
    </div>
  );
}
