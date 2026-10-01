/**
 * The assistant's own records in district_intel_ops: conversations, messages (with the
 * router result and tool calls, so a follow-up can edit them) and feedback. These are the
 * only tables the assistant writes. If they are missing (scripts/setup-intel-ops.js not run)
 * the assistant still answers; it just keeps no history.
 */
import crypto from "crypto";
import { RowDataPacket } from "mysql2";
import intelPool, { ops } from "@/lib/collector/db";

type Row = Record<string, any>;
/** mysql2 already parses JSON columns; a string is either a JSON text (older drivers) or a plain value. */
const parse = (v: unknown) => {
  if (typeof v !== "string") return v ?? null;
  try { return JSON.parse(v); } catch { return v; }
};

const warned = new Set<string>();
async function safe<T>(what: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (e: any) {
    if (!warned.has(what)) {
      const missing = e?.code === "ER_NO_SUCH_TABLE" || e?.code === "ER_BAD_DB_ERROR";
      console.warn(`assistant store: ${what} skipped (${e?.code ?? e?.message})${missing ? "; run npm run setup:ops" : ""}`);
    }
    warned.add(what);
    return fallback;
  }
}

/** The session to add to: the one given if it belongs to this user, else a new one titled by the question. */
export async function ensureSession(owner: string, sessionId: string | null, title: string): Promise<string> {
  return safe("session", async () => {
    if (sessionId && /^[0-9a-f-]{36}$/.test(sessionId)) {
      const [[s]] = await intelPool.query<RowDataPacket[]>(`SELECT session_id FROM ${ops("assistant_sessions")} WHERE session_id = ? AND owner = ?`, [sessionId, owner]);
      if (s) return sessionId;
    }
    const id = crypto.randomUUID();
    await intelPool.query(`INSERT INTO ${ops("assistant_sessions")} (session_id, owner, title) VALUES (?, ?, ?)`, [id, owner, title.slice(0, 200)]);
    return id;
  }, sessionId && /^[0-9a-f-]{36}$/.test(sessionId) ? sessionId : crypto.randomUUID());
}

export interface MessageIn {
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  language: string;
  inputMode?: "text" | "voice";
  payload?: unknown;
  plan?: unknown;
  scope?: unknown;
}

export async function addMessage(m: MessageIn): Promise<string> {
  const id = crypto.randomUUID();
  await safe("message", async () => {
    await intelPool.query(
      `INSERT INTO ${ops("assistant_messages")} (message_id, session_id, role, content_text, language, input_mode, payload_json, plan_json, scope_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, m.sessionId, m.role, m.text.slice(0, 4000), m.language, m.inputMode ?? null, m.payload ? JSON.stringify(m.payload) : null,
        m.plan ? JSON.stringify(m.plan) : null, m.scope ? JSON.stringify(m.scope) : null]
    );
    await intelPool.query(`UPDATE ${ops("assistant_sessions")} SET updated_at = NOW() WHERE session_id = ?`, [m.sessionId]);
  }, undefined);
  return id;
}

/** The latest turns of a conversation, oldest first: the context a follow-up is read in. */
export async function recentTurns(owner: string, sessionId: string, limit = 6): Promise<Row[]> {
  return safe("history", async () => {
    const [rows] = await intelPool.query<RowDataPacket[]>(
      `SELECT m.message_id, m.role, m.content_text, m.language, m.plan_json, m.scope_json, JSON_UNQUOTE(JSON_EXTRACT(m.payload_json, '$.headline')) AS headline,
              JSON_EXTRACT(m.payload_json, '$.chart') AS chart, JSON_UNQUOTE(JSON_EXTRACT(m.payload_json, '$.display')) AS display
       FROM ${ops("assistant_messages")} m JOIN ${ops("assistant_sessions")} s ON s.session_id = m.session_id
       WHERE m.session_id = ? AND s.owner = ? ORDER BY m.created_at DESC LIMIT ?`,
      [sessionId, owner, limit]
    );
    return rows.reverse().map((r) => ({ ...r, plan: parse(r.plan_json), scope: parse(r.scope_json), headline: r.headline ?? null, chart: parse(r.chart),
      display: r.display ?? null }));
  }, []);
}

/** One assistant message's full card, for a chart edit ("make it a pie") on it. */
export async function messagePayload(owner: string, messageId: string): Promise<Row | null> {
  return safe("payload", async () => {
    const [[r]] = await intelPool.query<RowDataPacket[]>(
      `SELECT m.payload_json, m.plan_json FROM ${ops("assistant_messages")} m JOIN ${ops("assistant_sessions")} s ON s.session_id = m.session_id
       WHERE m.message_id = ? AND s.owner = ? AND m.role = 'assistant'`,
      [messageId, owner]
    );
    return r ? { payload: parse(r.payload_json), plan: parse(r.plan_json) } : null;
  }, null);
}

/** The latest answer in a conversation that has data to redraw (chart edits apply to it, not to confirmations or refusals). */
export async function lastCardWithData(owner: string, sessionId: string): Promise<Row | null> {
  return safe("last card", async () => {
    const [[r]] = await intelPool.query<RowDataPacket[]>(
      `SELECT m.payload_json, m.plan_json FROM ${ops("assistant_messages")} m JOIN ${ops("assistant_sessions")} s ON s.session_id = m.session_id
       WHERE m.session_id = ? AND s.owner = ? AND m.role = 'assistant' AND JSON_LENGTH(JSON_EXTRACT(m.payload_json, '$.datasets')) > 0
       ORDER BY m.created_at DESC LIMIT 1`,
      [sessionId, owner]
    );
    return r ? { payload: parse(r.payload_json), plan: parse(r.plan_json) } : null;
  }, null);
}

export async function listSessions(owner: string, limit = 30): Promise<Row[]> {
  return safe("sessions", async () => {
    const [rows] = await intelPool.query<RowDataPacket[]>(
      `SELECT s.session_id AS id, s.title, DATE_FORMAT(s.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
              DATE_FORMAT(s.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
              (SELECT COUNT(*) FROM ${ops("assistant_messages")} m WHERE m.session_id = s.session_id AND m.role = 'user') AS questions
       FROM ${ops("assistant_sessions")} s WHERE s.owner = ? ORDER BY s.updated_at DESC LIMIT ?`,
      [owner, limit]
    );
    return rows;
  }, []);
}

export async function sessionMessages(owner: string, sessionId: string): Promise<Row[] | null> {
  return safe("session messages", async () => {
    const [[s]] = await intelPool.query<RowDataPacket[]>(`SELECT session_id FROM ${ops("assistant_sessions")} WHERE session_id = ? AND owner = ?`, [sessionId, owner]);
    if (!s) return null;
    const [rows] = await intelPool.query<RowDataPacket[]>(
      `SELECT message_id AS id, role, content_text AS text, language, input_mode, payload_json, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS t
       FROM ${ops("assistant_messages")} WHERE session_id = ? ORDER BY created_at LIMIT 200`,
      [sessionId]
    );
    return rows.map((r) => ({ id: r.id, role: r.role, text: r.text, language: r.language, inputMode: r.input_mode, t: r.t, card: parse(r.payload_json) }));
  }, null);
}

export async function saveFeedback(owner: string, f: { messageId?: string | null; insightKey?: string | null; rating: 1 | -1; comment?: string | null }) {
  return safe("feedback", async () => {
    await intelPool.query(
      `INSERT INTO ${ops("assistant_feedback")} (message_id, insight_key, owner, rating, comment) VALUES (?, ?, ?, ?, ?)`,
      [f.messageId ?? null, f.insightKey ?? null, owner, f.rating, f.comment?.slice(0, 500) ?? null]
    );
    return true;
  }, false);
}

// -------------------------------------------------------------------- pins --
// A pin keeps the question, the tools (or plan), the chart design and the scope, never the numbers:
// opening it runs the same tools again on the latest data.

/** Pin an answer: its question (the user message before it), plan, chart and scope. */
export async function addPin(owner: string, messageId: string): Promise<number | null> {
  return safe("pin", async () => {
    const [[m]] = await intelPool.query<RowDataPacket[]>(
      `SELECT m.session_id, m.created_at, m.payload_json, m.plan_json, m.scope_json FROM ${ops("assistant_messages")} m
       JOIN ${ops("assistant_sessions")} s ON s.session_id = m.session_id WHERE m.message_id = ? AND s.owner = ? AND m.role = 'assistant'`,
      [messageId, owner]
    );
    if (!m) return null;
    const [[u]] = await intelPool.query<RowDataPacket[]>(
      `SELECT content_text FROM ${ops("assistant_messages")} WHERE session_id = ? AND role = 'user' AND created_at <= ? ORDER BY created_at DESC LIMIT 1`,
      [m.session_id, m.created_at]
    );
    const card = parse(m.payload_json) as Row | null;
    const [[pos]] = await intelPool.query<RowDataPacket[]>(`SELECT COALESCE(MAX(position), 0) + 1 AS p FROM ${ops("assistant_pins")} WHERE owner = ?`, [owner]);
    const [r] = await intelPool.query<any>(
      `INSERT INTO ${ops("assistant_pins")} (owner, title, question, plan_json, chart_json, scope_json, position) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [owner, String(card?.headline ?? "Pinned answer").slice(0, 200), String(u?.content_text ?? card?.headline ?? "").slice(0, 1500),
        m.plan_json ? JSON.stringify(parse(m.plan_json)) : null, card?.chart ? JSON.stringify(card.chart) : null,
        m.scope_json ? JSON.stringify(parse(m.scope_json)) : null, Number(pos?.p ?? 1)]
    );
    return Number(r.insertId);
  }, null);
}

export async function listPins(owner: string): Promise<Row[]> {
  return safe("pins", async () => {
    const [rows] = await intelPool.query<RowDataPacket[]>(
      `SELECT pin_id AS id, title, question, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created_at FROM ${ops("assistant_pins")}
       WHERE owner = ? ORDER BY position, pin_id LIMIT 50`, [owner]);
    return rows;
  }, []);
}

export async function getPin(owner: string, id: number): Promise<Row | null> {
  return safe("pin", async () => {
    const [[r]] = await intelPool.query<RowDataPacket[]>(`SELECT * FROM ${ops("assistant_pins")} WHERE pin_id = ? AND owner = ?`, [id, owner]);
    return r ? { id: r.pin_id, title: r.title, question: r.question, plan: parse(r.plan_json), chart: parse(r.chart_json), scope: parse(r.scope_json) } : null;
  }, null);
}

export async function deletePin(owner: string, id: number): Promise<boolean> {
  return safe("unpin", async () => {
    const [r] = await intelPool.query<any>(`DELETE FROM ${ops("assistant_pins")} WHERE pin_id = ? AND owner = ?`, [id, owner]);
    return Number(r.affectedRows) > 0;
  }, false);
}
