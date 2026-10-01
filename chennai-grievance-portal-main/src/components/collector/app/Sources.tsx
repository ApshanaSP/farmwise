"use client";

import { useEffect, useState } from "react";
import { I } from "./icons";
import { Empty, fmtShort, type Row } from "./lib";
import type { Console } from "./CollectorApp";

type Tab = "sources" | "add" | "ocr" | "audit";
const KIND: Record<string, string> = { pipeline: "Pipeline feed", agmarknet: "Public API", rss: "RSS / Atom feed", html: "Web page", json: "JSON API", ocr: "Upload + OCR" };
const STATUS: Record<string, [string, string]> = {
  ok: ["Healthy", "st-resolved"], partial: ["Partial", "st-review"], stale: ["Stale", "st-progress"], failing: ["Failing", "st-progress"], login_failed: ["Login failed", "st-progress"], new: ["Not run yet", "st-review"]
};

export function SourcesBody({ c, initial = "sources" }: { c: Console; initial?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial);
  return (
    <>
      <div className="tabs2">
        {([["sources", "Connected sources"], ["add", "Add a source"], ["ocr", "Newspaper page (OCR)"], ["audit", "Audit log"]] as const).map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "sources" ? <SourceList c={c} /> : tab === "add" ? <AddSource c={c} done={() => setTab("sources")} /> : tab === "ocr" ? <OcrUpload c={c} /> : <AuditLog />}
    </>
  );
}

async function call(path: string, method = "GET", body?: unknown) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Request failed.");
  return j;
}

function SourceList({ c }: { c: Console }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [items, setItems] = useState<{ id: number; name: string; rows: Row[] } | null>(null);
  const load = () => call("/api/collector/sources").then((j) => setRows(j.sources)).catch((e) => c.toast(e.message, "alert"));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (s: Row) => {
    setBusy(s.id);
    try {
      const r = await call(`/api/collector/sources/${s.id}`, "POST");
      c.toast(s.kind === "pipeline" ? "Pipeline refresh started. The dashboard updates when it finishes (a few minutes)."
        : r.ok ? `${s.name}: ${r.items_new} new of ${r.seen} read${r.login !== "none" ? ` (login ${r.login})` : ""}.` : `${s.name}: ${r.error}`, r.ok ? "ok" : "alert");
      await load();
    } catch (e: any) { c.toast(e.message, "alert"); } finally { setBusy(null); }
  };
  const toggle = async (s: Row) => { await call(`/api/collector/sources/${s.id}`, "PATCH", { enabled: !s.enabled }).catch((e) => c.toast(e.message, "alert")); load(); };
  const remove = async (s: Row) => {
    if (!window.confirm(`Remove ${s.name}? Items already collected stay in the store.`)) return;
    await call(`/api/collector/sources/${s.id}`, "DELETE").catch((e) => c.toast(e.message, "alert"));
    load();
  };
  const show = async (s: Row) => setItems({ id: s.id, name: s.name, rows: (await call(`/api/collector/sources?items=${s.id}`)).items });

  if (!rows) return <div className="empty">Loading sources…</div>;
  if (items) return (
    <>
      <button className="lnk" onClick={() => setItems(null)}>‹ All sources</button>
      <h4 style={{ margin: "8px 0" }}>{items.name}: latest items</h4>
      <ItemTable rows={items.rows} />
    </>
  );
  const ok = rows.filter((r) => r.status === "ok").length;
  return (
    <>
      <p className="sub">{ok} of {rows.length} sources healthy. Added sources refresh on their own interval (daily by default); all feeds are collected once a day at 6:00 AM.
        Every run is logged, and failures show the reason.</p>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Source</th><th>Type</th><th>Status</th><th>Newest data</th><th>Records</th><th>Last runs</th><th /></tr></thead>
          <tbody>
            {rows.map((s) => {
              const [st, cls] = STATUS[s.status] ?? [s.status, "st-review"];
              return (
                <tr key={s.id} style={{ cursor: "default", opacity: s.enabled ? 1 : 0.55 }}>
                  <td className="ev" style={{ whiteSpace: "normal", maxWidth: 300 }}>
                    {s.name}
                    <small className="dim" style={{ display: "block", fontWeight: 400 }}>{/^https?:/.test(s.url) ? <a href={s.url} target="_blank" rel="noreferrer" className="lnk" style={{ fontWeight: 500 }}>{s.url.replace(/^https?:\/\//, "").slice(0, 48)}</a> : s.url}</small>
                    {s.auth !== "none" && <small className="dim" style={{ display: "block" }}><I n="shield" /> Signs in as {s.username} ({s.auth}){s.session_expires_at ? ` · session until ${fmtShort(s.session_expires_at)}` : ""}</small>}
                  </td>
                  <td className="dim">{KIND[s.kind] ?? s.kind}</td>
                  <td><span className={`st ${cls}`}>{st}</span>{s.last_error && s.status !== "ok" && <small className="dim" title={s.error_detail ?? undefined} style={{ display: "block", whiteSpace: "normal", maxWidth: 220 }}>{s.last_error}</small>}</td>
                  <td className="dim">{s.newest ? fmtShort(s.newest) : "—"}</td>
                  <td className="num">{Number(s.rows ?? 0).toLocaleString("en-IN")}</td>
                  <td>
                    <span className="runs">{(s.runs as Row[]).map((r, k) => <i key={k} className={r.ok ? "ok" : "bad"} title={`${fmtShort(r.t)} · ${r.ok ? `${r.items_new} new` : r.error}${r.login && r.login !== "none" ? ` · login ${r.login}` : ""}`} />)}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      {s.kind !== "ocr" && <button className="btn sm plain" disabled={busy === s.id || !s.enabled} onClick={() => run(s)}>
                        <I n="refresh" className={busy === s.id ? "spin" : ""} />{s.kind === "pipeline" ? "Refresh" : "Run now"}</button>}
                      {["rss", "html", "json", "ocr"].includes(s.kind) && <button className="btn sm plain" onClick={() => show(s)}>Items</button>}
                      {s.kind !== "pipeline" && <button className="btn sm plain" onClick={() => toggle(s)} title={s.enabled ? "Pause" : "Resume"}>{s.enabled ? "Pause" : "Resume"}</button>}
                      {["rss", "html", "json"].includes(s.kind) && <button className="btn sm plain" onClick={() => remove(s)} title="Remove"><I n="x" /></button>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ItemTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Empty>No items yet.</Empty>;
  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr><th>Item</th><th>Category found</th><th>Place found</th><th>Date</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item_id} style={{ cursor: "default" }}>
              <td style={{ whiteSpace: "normal", maxWidth: 420 }}>{r.url && /^https?:/.test(r.url) ? <a className="lnk" href={r.url} target="_blank" rel="noreferrer">{r.title}</a> : r.title}</td>
              <td style={{ whiteSpace: "normal" }}>{r.category_label ? <>{r.category_label}<small className="dim" style={{ display: "block" }}>matched: {r.matched_terms} · {Math.round(Number(r.category_conf) * 100)}%</small></> : <span className="dim">not an incident</span>}</td>
              <td>{r.place ? <>{r.place}<small className="dim" style={{ display: "block" }}>{[r.zone_name, r.ward_no ? `ward ${r.ward_no}` : null].filter(Boolean).join(", ") || r.taluk_code}</small></> : <span className="dim">not found</span>}</td>
              <td className="dim">{fmtShort(r.t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddSource({ c, done }: { c: Console; done: () => void }) {
  const [f, setF] = useState({ name: "", url: "", kind: "auto", auth: "none", loginUrl: "", userField: "username", passField: "password", username: "", secret: "", refreshMinutes: 1440, authorized: false });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await call("/api/collector/sources", "POST", { ...f, refreshMinutes: Number(f.refreshMinutes), authorized: f.authorized || undefined });
      c.toast(r.run?.ok ? `Connected as ${KIND[r.kind]}: ${r.run.items_new} items read and classified.` : `Saved, but the first run failed: ${r.run?.error}`, r.run?.ok ? "ok" : "alert");
      done();
    } catch (err: any) { c.toast(err.message, "alert"); } finally { setBusy(false); }
  };
  return (
    <form className="addf" onSubmit={submit}>
      <p className="sub">Paste the link of a feed, web page or API. District IQ reads it on a schedule, finds incidents (category and place) and adds them to the store. Credentials are stored encrypted and used only for this site&apos;s own login.</p>
      <label>Name<input required value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. GCC press releases" /></label>
      <label>Link<input required type="url" value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…" /></label>
      <div className="row3">
        <label>Type<select value={f.kind} onChange={(e) => set("kind", e.target.value)}><option value="auto">Detect automatically</option><option value="rss">RSS / Atom feed</option><option value="html">Web page (headlines)</option><option value="json">JSON API</option></select></label>
        <label>Sign-in<select value={f.auth} onChange={(e) => set("auth", e.target.value)}><option value="none">Public, no login</option><option value="form">Login form (username + password)</option><option value="basic">HTTP basic</option><option value="token">API token</option></select></label>
        <label>Refresh every<select value={f.refreshMinutes} onChange={(e) => set("refreshMinutes", e.target.value)}>{[15, 30, 60, 180, 360, 1440].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : m === 60 ? "hour" : m === 1440 ? "day" : `${m / 60} hours`}</option>)}</select></label>
      </div>
      {f.auth === "form" && (
        <div className="row3">
          <label>Login page URL<input type="url" value={f.loginUrl} onChange={(e) => set("loginUrl", e.target.value)} placeholder="https://…/login" /></label>
          <label>Username field<input value={f.userField} onChange={(e) => set("userField", e.target.value)} /></label>
          <label>Password field<input value={f.passField} onChange={(e) => set("passField", e.target.value)} /></label>
        </div>
      )}
      {f.auth !== "none" && (
        <div className="row3">
          {f.auth !== "token" && <label>Username<input value={f.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" /></label>}
          <label>{f.auth === "token" ? "API token" : "Password"}<input type="password" value={f.secret} onChange={(e) => set("secret", e.target.value)} autoComplete="new-password" /></label>
        </div>
      )}
      <label className="chk"><input type="checkbox" checked={f.authorized} onChange={(e) => set("authorized", e.target.checked)} />
        I am authorized to use this source, and it permits automated reading (no CAPTCHA, paywall or robots restriction is bypassed).</label>
      <button className="btn" disabled={busy || !f.authorized}>{busy ? <><I n="refresh" className="spin" />Connecting…</> : <><I n="plus" />Connect and read now</>}</button>
    </form>
  );
}

function OcrUpload({ c }: { c: Console }) {
  const [file, setFile] = useState<File | null>(null);
  const [publisher, setPublisher] = useState("");
  const [date, setDate] = useState("");
  const [lang, setLang] = useState("eng+tam");
  const [stage, setStage] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; read: number; items: Row[] } | null>(null);
  const go = async () => {
    if (!file) return;
    setResult(null);
    try {
      setStage("Loading the OCR engine…");
      const Tesseract = (await import("tesseract.js")).default;
      const worker = await Tesseract.createWorker(lang.split("+"), 1, {
        logger: (m: { status: string; progress: number }) => m.status === "recognizing text" && setStage(`Reading the page… ${Math.round(m.progress * 100)}%`)
      });
      await worker.setParameters({ tessedit_pageseg_mode: "1" as any }); // automatic layout: keeps newspaper columns apart
      const { data } = await worker.recognize(file, {}, { blocks: true, text: true });
      await worker.terminate();
      // Paragraphs in reading order (column by column); a short one is a headline, joined to the paragraph below it.
      const paras: string[] = ((data as any).blocks ?? []).flatMap((b: any) => (b.paragraphs ?? []).map((p: any) => String(p.text).replace(/\s*\n\s*/g, " ").trim()))
        .filter((t: string) => t.length > 3);
      const blocks: string[] = [];
      for (let k = 0; k < paras.length; k++) {
        if (paras[k].length < 110 && paras[k + 1] && paras[k + 1].length >= 110) { blocks.push(`${paras[k]}\n${paras[k + 1]}`); k++; }
        else blocks.push(paras[k]);
      }
      if (!blocks.length) blocks.push(...String(data.text).split(/\n\s*\n/));
      for (let k = blocks.length - 1; k >= 0; k--) if (blocks[k].trim().length <= 40) blocks.splice(k, 1);
      if (!blocks.length) throw new Error("No readable text found on the page.");
      setStage(`Classifying ${blocks.length} articles…`);
      const r = await call("/api/collector/sources/ocr", "POST", { file: file.name, publisher: publisher || null, date: date || null, blocks: blocks.slice(0, 80) });
      setResult(r);
      c.toast(`${r.read} articles read from the page, ${r.added} new.`);
    } catch (e: any) {
      c.toast(e.message || "OCR failed.", "alert");
    } finally {
      setStage(null);
    }
  };
  return (
    <div className="addf">
      <p className="sub">Upload a photo or scan of a newspaper page (JPG or PNG). The page is read in your browser with OCR (English and Tamil), split into articles, and each article is classified and placed like any other news report.</p>
      <div className="row3">
        <label>Page image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <label>Newspaper (optional)<input value={publisher} onChange={(e) => setPublisher(e.target.value)} placeholder="e.g. Dina Thanthi" /></label>
        <label>Edition date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <label style={{ maxWidth: 260 }}>Language<select value={lang} onChange={(e) => setLang(e.target.value)}><option value="eng+tam">English and Tamil</option><option value="eng">English</option><option value="tam">Tamil</option></select></label>
      <button className="btn" disabled={!file || !!stage} onClick={go}>{stage ? <><I n="refresh" className="spin" />{stage}</> : <><I n="doc" />Read the page</>}</button>
      {result && <div style={{ marginTop: 10 }}><ItemTable rows={result.items} /></div>}
    </div>
  );
}

function AuditLog() {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { call("/api/collector/audit").then((j) => setRows(j.log)).catch(() => setRows([])); }, []);
  if (!rows) return <div className="empty">Loading…</div>;
  return (
    <>
      <p className="sub">Every decision, source change, OCR upload and saved workspace, newest first.</p>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th><th>Details</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ cursor: "default" }}>
                <td className="dim">{fmtShort(r.at)}</td><td>{r.actor}</td><td className="ev">{r.action.replace(":", " · ")}</td>
                <td className="dim">{r.table_name} {r.record_id}</td>
                <td className="dim" style={{ whiteSpace: "normal", maxWidth: 420, fontSize: 12.5 }}>{r.after_value}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5}><div className="empty">Nothing recorded yet.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
