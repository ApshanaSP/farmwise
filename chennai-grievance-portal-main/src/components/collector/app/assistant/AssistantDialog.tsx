"use client";

/**
 * Ask District IQ: the assistant's pop-up over the Collector console, or over a department
 * officer's console (answers locked to that department on the server). The console stays
 * visible behind it, blurred; the dialog traps focus and closes on Esc or a click outside.
 * Each question goes out with the console's filters; the answer streams back in stages
 * (understanding, fetching data, drawing) and is drawn as a card. The conversation stays
 * when the dialog is closed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantHost } from "./host";
import { I } from "../icons";
import AnswerCard from "./AnswerCard";
import { BrandMark } from "./Brand";
import { canListen, listen, speak, stopSpeaking } from "./speech";
import { T, X } from "./text";
import { EXAMPLES, detectLanguage, type Lang, type LangChoice } from "@/lib/assistant/lang";
import type { AnswerCard as Card, ConsoleAction } from "@/lib/assistant/answer";
import "./assistant.css";

type Stage = "understanding" | "fetching" | "drawing";
type Item = { id: string; role: "user"; text: string } | { id: string; role: "assistant"; card: Card } | { id: string; role: "pending"; stage: Stage }
  | { id: string; role: "error"; text: string };
interface Status { asOf: string; feedsOk: number; feedsTotal: number; ai: { available: boolean; problem?: string | null } }
interface Insight { key: string; kind: string; title: string; finding: string; question: string }
interface Pin { id: number; title: string; question: string }
type Extra = { pinId?: number; insightKey?: string };
interface Past { id: string; title: string; updated_at: string; questions: number }

const LANG_OPTS: { v: LangChoice; l: string }[] = [{ v: "auto", l: "Auto" }, { v: "en", l: "English" }, { v: "ta", l: "தமிழ்" }, { v: "tanglish", l: "Tanglish" }];
const uid = () => Math.random().toString(36).slice(2);
const SESSION_KEY = "diq-assistant-session";

export default function AssistantDialog({ c, open, onClose }: { c: AssistantHost; open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<LangChoice>("auto");
  const [busy, setBusy] = useState(false);
  const [wide, setWide] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  const [showIns, setShowIns] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [micOk, setMicOk] = useState(false);
  const [past, setPast] = useState<Past[] | null>(null);
  const [showPast, setShowPast] = useState(false);
  const stopListening = useRef<(() => void) | null>(null);
  const story = useRef(0);
  const session = useRef<string | null>(null);
  const lastAnswer = useRef<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const restored = useRef(false);

  // the interface follows the chosen language, else the language of the last question
  const lastUser = [...items].reverse().find((x) => x.role === "user") as { text: string } | undefined;
  const lang: Lang = choice !== "auto" ? choice : lastUser ? detectLanguage(lastUser.text).lang : "en";
  const t = T[lang];
  const x = X[lang];
  const loadPins = useCallback(() => { fetch("/api/collector/assistant/pins").then((r) => (r.ok ? r.json() : null)).then((j) => j && setPins(j.pins)).catch(() => {}); }, []);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    setTimeout(() => input.current?.focus(), 30);
    fetch("/api/collector/assistant/status").then((r) => (r.ok ? r.json() : null)).then((s) => s && setStatus(s)).catch(() => {});
    fetch("/api/collector/assistant/insights").then((r) => (r.ok ? r.json() : null)).then((j) => j && setInsights(j.items)).catch(() => {});
    loadPins();
    // the conversation survives a page refresh: reload the last one (answers and follow-up context are kept on the server)
    if (!session.current && !restored.current) {
      restored.current = true;
      let saved: string | null = null;
      try { saved = localStorage.getItem(SESSION_KEY); } catch { /* storage blocked */ }
      if (saved && /^[0-9a-f-]{36}$/.test(saved)) loadSession(saved, false);
    }
    return () => { (opener.current as HTMLElement | null)?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadPins]);

  /** Open a saved conversation: its questions and answers, and its context for follow-ups (kept on the server). */
  const loadSession = useCallback((id: string, replace = true) => {
    fetch(`/api/collector/assistant/sessions/${id}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j?.messages?.length || (!replace && session.current)) return;
      ctl.current?.abort();
      session.current = id;
      try { localStorage.setItem(SESSION_KEY, id); } catch { /* storage blocked */ }
      const back: Item[] = (j.messages as { id: string; role: string; text: string; card: Card | null }[]).slice(-40).map((m) =>
        m.role === "user" || !m.card ? { id: uid(), role: "user", text: m.text } as Item : { id: m.id, role: "assistant", card: { ...m.card, id: m.id } } as Item);
      const lastData = [...back].reverse().find((i) => i.role === "assistant" && i.card.datasets?.length) as { id: string } | undefined;
      lastAnswer.current = lastData?.id ?? null;
      setItems((cur) => (replace || !cur.length ? back : cur));
      setShowPast(false);
    }).catch(() => {});
  }, []);
  const togglePast = () => {
    setShowPast((v) => !v);
    fetch("/api/collector/assistant/sessions").then((r) => (r.ok ? r.json() : null)).then((j) => j && setPast(j.sessions)).catch(() => {});
  };

  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: "smooth" }); }, [items]);
  // the mic button only where the browser can listen; nothing keeps talking once the dialog closes
  useEffect(() => { setMicOk(canListen()); }, []);
  useEffect(() => { if (!open) { stopListening.current?.(); stopSpeaking(); } }, [open]);

  // keep Tab inside the dialog
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !box.current) return;
    const f = [...box.current.querySelectorAll<HTMLElement>("button:not([disabled]), textarea, select, a[href], summary, [tabindex]:not([tabindex='-1'])")]
      .filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const runAction = useCallback((a: ConsoleAction, keepOpen = false) => {
    switch (a.action) {
      case "filter_zone": if (a.zone) c.setZone(a.zone); break;
      case "filter_dept": if (a.dept) c.setDept(a.dept); break;
      case "filter_taluk": if (a.taluk) c.setTaluk(a.taluk); break;
      case "filter_cat": if (a.cat) c.setCat(a.cat); break;
      case "set_period": if (a.period) c.setPeriod(a.period); break;
      case "open_incident": if (a.id) c.openInc(a.id); break;
      case "open_story": c.openStories(); break;
      case "open_briefing": c.setPage("briefing"); break;
      case "save_briefing":
        // the console's own briefing, frozen into a workspace (keepOpen: the Collector stays in the chat)
        fetch("/api/collector/assistant/briefing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: a.period ?? "daily" }) })
          .then((r) => r.json()).then((j) => setItems((x) => [...x, { id: uid(), role: "error", text: j.ok ? `Saved as workspace "${j.name}".` : j.error ?? "Could not save." }]))
          .catch(() => {});
        return;
      case "show_on_map": if (a.zone) c.setZone(a.zone); c.setPage("overview"); break;
    }
    if (!keepOpen) onClose();
  }, [c, onClose]);

  const ask = useCallback(async (q: string, inputMode: "text" | "voice" = "text", extra: Extra = {}) => {
    const message = q.trim();
    if (!message) return;
    ctl.current?.abort();
    const ac = new AbortController();
    ctl.current = ac;
    const pid = uid();
    setItems((x) => [...x.filter((i) => i.role !== "pending"), { id: uid(), role: "user", text: message }, { id: pid, role: "pending", stage: "understanding" }]);
    setText("");
    setShowIns(false);
    setBusy(true);
    const replace = (item: Item | null) => setItems((x) => x.flatMap((i) => (i.id === pid ? (item ? [item] : []) : [i])));
    try {
      const res = await fetch("/api/collector/assistant/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ sessionId: session.current, message, inputMode, language: choice, replyTo: lastAnswer.current, pinId: extra.pinId ?? null,
          insightKey: extra.insightKey ?? null,
          consoleScope: { period: c.period, zone: c.zone, dept: c.dept, cat: c.cat, taluk: c.taluk } })
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        replace({ id: pid, role: "error", text: j.error ?? T[lang].failed });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let k;
        while ((k = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, k);
          buf = buf.slice(k + 2);
          const ev = chunk.match(/^event: (.+)$/m)?.[1];
          const raw = chunk.match(/^data: (.+)$/m)?.[1];
          if (!ev || !raw) continue;
          const data = JSON.parse(raw);
          if (ev === "status" && data.stage) setItems((x) => x.map((i) => (i.id === pid ? { ...i, stage: data.stage } as Item : i)));
          else if (ev === "answer") {
            session.current = data.sessionId ?? session.current;
            try { if (session.current) localStorage.setItem(SESSION_KEY, session.current); } catch { /* storage blocked */ }
            const card = data as Card;
            // follow-ups ("make it a pie") refer to the last answer that has data, not to a confirmation or a refusal
            if (card.datasets?.length) lastAnswer.current = card.id;
            replace({ id: card.id, role: "assistant", card });
            // asked by voice, answered by voice: the spoken summary, in the answer's language
            if (inputMode === "voice") speak(card.voiceSummary || card.headline, card.voiceLang);
            for (const a of card.autoActions ?? []) runAction(a, true);
          } else if (ev === "error") replace(data.cancelled ? null : { id: pid, role: "error", text: data.error ?? T[lang].failed });
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") replace({ id: pid, role: "error", text: T[lang].failed });
      else replace(null);
    } finally {
      if (ctl.current === ac) { ctl.current = null; setBusy(false); }
    }
  }, [c, choice, lang, runAction]);

  const pin = useCallback(async (messageId: string) => {
    const r = await fetch("/api/collector/assistant/pins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId }) }).catch(() => null);
    if (r?.ok) loadPins();
    return !!r?.ok;
  }, [loadPins]);
  const unpin = async (id: number) => {
    setPins((p) => p.filter((x) => x.id !== id));
    await fetch(`/api/collector/assistant/pins?id=${id}`, { method: "DELETE" }).catch(() => {});
  };
  // story mode: today's insights one after another, each drawn as a chart-first card
  const play = async () => {
    const run = ++story.current;
    setShowIns(false);
    for (let k = 0; k < insights.length; k++) {
      if (story.current !== run) return;
      setPlaying(k);
      await ask(insights[k].question, "text", { insightKey: insights[k].key });
      await new Promise((r) => setTimeout(r, 7000));
    }
    if (story.current === run) setPlaying(null);
  };
  const stopPlay = () => { story.current++; setPlaying(null); };
  // voice: the words appear in the box as they are heard, and the question is sent when the speaker stops
  const mic = () => {
    if (listening) { stopListening.current?.(); return; }
    stopSpeaking();
    setListening(true);
    stopListening.current = listen(choice === "ta" ? "ta-IN" : "en-IN", (w) => setText(w), (final) => {
      setListening(false);
      stopListening.current = null;
      if (final) ask(final, "voice");
    }, (err) => {
      setListening(false);
      if (err === "not-allowed" || err === "service-not-allowed") setItems((x) => [...x, { id: uid(), role: "error", text: T[lang].micOff }]);
    });
  };
  // stable handlers, so answers already on screen are not redrawn when a new one arrives
  const onAsk = useCallback((q: string) => { ask(q); }, [ask]);
  const onAct = useCallback((a: ConsoleAction) => runAction(a), [runAction]);
  const onExpand = useCallback(() => setWide((w) => !w), []);
  const stop = () => { ctl.current?.abort(); ctl.current = null; setBusy(false); setItems((x) => x.filter((i) => i.role !== "pending")); };
  const reset = () => {
    stop(); setItems([]); session.current = null; lastAnswer.current = null; input.current?.focus();
    try { localStorage.removeItem(SESSION_KEY); } catch { /* storage blocked */ }
  };
  const scopeChips = [c.periodLabel, c.zoneName ?? "All zones", c.deptName ?? "All departments", c.taluk ? `${c.talukName(c.taluk)} taluk` : null].filter(Boolean) as string[];
  const fresh = status ? t.fresh(status.asOf.slice(0, 16), status.feedsOk, status.feedsTotal) : "";
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  // an officer is greeted by department, with questions about their own work
  const hello = c.officer ? `${{ en: `Good ${part}`, ta: "வணக்கம்", tanglish: "Vanakkam" }[lang]}, ${c.officer.who[lang]}` : t.hello(part);
  const examples = c.officer ? c.officer.examples[lang] : EXAMPLES[lang];
  const labels = c.officer ? c.officer.labels[lang] : t.suggest;

  if (!open) return null;
  return (
    <div className="aq-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside ref={box} className={`aq${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="aq-title" onKeyDown={trap}>
        <header className="aq-h">
          <BrandMark size={34} />
          <div className="aq-ht">
            <b id="aq-title">District IQ</b>
            <span className={`aq-live${status && status.feedsOk < status.feedsTotal ? " warn" : ""}${status && !status.ai.available ? " off" : ""}`}
              title={[fresh, status && !status.ai.available ? t.aiOff : ""].filter(Boolean).join("\n")}>
              <i />{status && !status.ai.available ? status.ai.problem ?? t.aiOff : `${t.live}${status ? ` · ${status.asOf.slice(11, 16)}` : ""}`}
            </span>
          </div>
          <div className="aq-hacts">
            <label className="aq-lang" title={t.language}>
              <select value={choice} onChange={(e) => setChoice(e.target.value as LangChoice)} aria-label={t.language}>
                {LANG_OPTS.map((o) => <option key={o.v} value={o.v}>{o.v === "auto" ? t.auto : o.l}</option>)}
              </select>
            </label>
            {insights.length > 0 && items.length > 0 && (
              <button className={`aq-hb${showIns ? " on" : ""}`} onClick={() => setShowIns((v) => !v)} title={x.insights} aria-label={x.insights} aria-expanded={showIns}>
                <I n="bulb" /><em className="aq-count">{insights.length}</em></button>
            )}
            <button className={`aq-hb${showPast ? " on" : ""}`} onClick={togglePast} title={t.history} aria-label={t.history} aria-expanded={showPast}><I n="clock" /></button>
            <button className="aq-hb" onClick={reset} title={t.newChat} aria-label={t.newChat}><I n="plus" /></button>
            <button className="aq-hb" onClick={() => setWide((w) => !w)} title={wide ? t.restore : t.maximize} aria-label={wide ? t.restore : t.maximize}><I n="expand" /></button>
            <button className="aq-hb" onClick={onClose} title={t.close} aria-label={t.close}><I n="x" /></button>
          </div>
        </header>
        {showPast && (
          <div className="aq-past" role="dialog" aria-label={t.history}>
            <div className="aq-past-h"><b>{t.history}</b><button className="aq-hb" onClick={() => setShowPast(false)} aria-label={t.close}><I n="x" /></button></div>
            {past == null ? <p className="aq-past-empty">…</p> : !past.length ? <p className="aq-past-empty">{t.noHistory}</p> : (
              <ul>
                {past.map((sx) => (
                  <li key={sx.id}>
                    <button className={sx.id === session.current ? "on" : ""} onClick={() => loadSession(sx.id)}>
                      <b>{sx.title || t.newChat}</b>
                      <small>{sx.updated_at.slice(0, 16).replace("T", " ")} · {sx.questions} {sx.questions === 1 ? t.question1 : t.questionN}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="aq-scopebar" title={scopeChips.join(" · ")}>
          <small>{t.scopeNow}</small>
          {scopeChips.map((s) => <span key={s}>{s}</span>)}
        </div>

        <div className="aq-thread" ref={thread}>
          {!items.length && (
            <div className="aq-empty">
              <BrandMark size={52} className="aq-hero" />
              <h2 className="aq-hello">{hello}</h2>
              <p className="aq-sub">{t.helpLine}</p>
              <div className="aq-ex">
                {examples.slice(0, 4).map((q, k) => (
                  <button key={q} onClick={() => ask(q)}>
                    <span className="aq-exi"><I n={SUGGEST_ICON[k] ?? "spark"} /></span>
                    <b>{labels[k] ?? ""}</b><small>{q}</small>
                  </button>
                ))}
              </div>
              {insights.length > 0 && <Insights items={insights} title={t.insightsNow} play={x.play} onOpen={(it) => ask(it.question, "text", { insightKey: it.key })} onPlay={play} />}
              {pins.length > 0 && (
                <div className="aq-pins">
                  <small><I n="bookmark" />{x.pinned}</small>
                  {pins.map((p) => (
                    <span key={p.id} className="aq-pinrow">
                      <button onClick={() => ask(p.question, "text", { pinId: p.id })} title={p.question}>{p.title}</button>
                      <button className="x" onClick={() => unpin(p.id)} aria-label={x.unpin} title={x.unpin}><I n="x" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {items.map((it) =>
            it.role === "user" ? <div key={it.id} className="aq-row me"><div className="aq-bubble">{it.text}</div></div>
              : it.role === "assistant" ? (
                <div key={it.id} className="aq-row bot">
                  <BrandMark size={28} className="aq-av" />
                  <AnswerCard card={it.card} geo={c.geo} onAsk={onAsk} onAction={onAct} expanded={wide} onExpand={onExpand} onPin={pin} />
                </div>
              )
                : it.role === "pending" ? <div key={it.id} className="aq-row bot"><BrandMark size={28} className="aq-av" /><Progress stage={it.stage} lang={lang} /></div>
                  : <div key={it.id} className="aq-err" role="alert"><I n="alert" />{it.text}</div>
          )}
        </div>

        {playing != null && (
          <div className="aq-story" role="status"><I n="play" />{x.playing(playing + 1, insights.length)}: {insights[playing]?.title}
            <button onClick={stopPlay}><I n="stop" />{x.stopPlay}</button></div>
        )}
        {showIns && items.length > 0 && (
          <div className="aq-insbar"><Insights items={insights} title={t.insightsNow} play={x.play} onOpen={(it) => { setShowIns(false); ask(it.question, "text", { insightKey: it.key }); }} onPlay={play} /></div>
        )}
        <form className="aq-f" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
          <div className={`aq-box${listening ? " listening" : ""}`}>
            <textarea ref={input} value={text} rows={1} maxLength={1500} placeholder={listening ? t.listening : t.placeholder} aria-label={t.placeholder}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); }
                // ↑ in an empty box brings back the last question, to edit and ask again
                else if (e.key === "ArrowUp" && !text && lastUser) { e.preventDefault(); setText(lastUser.text); }
              }} />
            {micOk && !busy && (
              <button type="button" className={`aq-mic${listening ? " on" : ""}`} onClick={mic} title={listening ? t.listening : t.speak} aria-label={listening ? t.listening : t.speak}
                aria-pressed={listening}><I n="mic" /></button>
            )}
            {busy ? <button type="button" className="aq-send stop" onClick={stop} aria-label={t.stop} title={t.stop}><I n="stop" /></button>
              : <button type="submit" className="aq-send" disabled={!text.trim()} aria-label={t.send} title={t.send}><I n="send" /></button>}
          </div>
          <small className="aq-hint">{t.hint}</small>
        </form>
      </aside>
    </div>
  );
}

const SUGGEST_ICON = ["target", "alert", "drop", "doc"] as const;

/** The assistant is working: one line that says which step it is on. */
function Progress({ stage, lang }: { stage: Stage; lang: Lang }) {
  const order: Stage[] = ["understanding", "fetching", "drawing"];
  const at = order.indexOf(stage);
  return (
    <div className="aq-typing" role="status" aria-live="polite">
      <span className="aq-dots"><i /><i /><i /></span>
      <span className="aq-stage">{T[lang].stages[stage]}…</span>
      <span className="aq-steps" aria-hidden="true">{order.map((s, i) => <b key={s} className={i < at ? "done" : i === at ? "on" : ""} />)}</span>
    </div>
  );
}

function Insights({ items, title, play, onOpen, onPlay }: { items: Insight[]; title: string; play: string; onOpen: (it: Insight) => void; onPlay: () => void }) {
  return (
    <div className="aq-ins">
      <div className="aq-ins-h"><small><I n="bulb" />{title}</small><button className="aq-play" onClick={onPlay}><I n="play" />{play}</button></div>
      {items.map((it) => (
        <button key={it.key} className={`aq-insc ${it.kind}`} onClick={() => onOpen(it)} title={it.finding}>
          <b>{it.title}</b><span>{it.finding}</span>
        </button>
      ))}
    </div>
  );
}
