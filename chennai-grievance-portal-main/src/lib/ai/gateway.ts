/**
 * The one door to the language models for Ask District IQ. Amazon Bedrock is the default
 * provider (Amazon Nova Lite, bedrock.ts); Groq and OpenAI remain optional fallbacks
 * (AI_PROVIDER / AI_FALLBACK_PROVIDER). Every call asks for JSON that must match a zod
 * schema (a tool call on Bedrock; generateText with Output.object elsewhere);
 * a busy provider (429, 5xx) is retried with backoff and jitter; a model rate-limited for
 * longer (a daily cap) hands over to the provider's other model; then the next provider is
 * tried, then the caller gets AiBusyError with the seconds to wait.
 *
 * Keys are read here, on the server, and nowhere else. Calls are logged with provider,
 * model, tokens and latency, never with the prompt (it can carry untrusted text), and each
 * user has a daily token budget.
 */
import { APICallError, Output, generateText, type LanguageModel } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { z } from "zod";
import { BedrockBusyError, bedrockConfigured, bedrockJson, bedrockModel, bedrockProblem } from "@/lib/ai/bedrock";

export type Role = "fast" | "reasoning";
type ProviderName = "bedrock" | "groq" | "openai";

export class AiUnavailableError extends Error {
  constructor() {
    super("No AI provider is configured: add the AWS keys for Amazon Bedrock (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_REGION) to the portal's .env.");
  }
}
export class AiBusyError extends Error {
  constructor(public retryAfter: number) {
    super(`The AI service is busy. Try again in ${retryAfter} s.`);
  }
}
export class AiBudgetError extends Error {
  constructor() {
    super("Today's AI budget for this account is used up. It resets at midnight.");
  }
}

interface Provider {
  name: ProviderName;
  model: (role: Role) => { id: string; lm: LanguageModel | null };
  options: (role: Role) => Record<string, Record<string, string | boolean>>;
  /** providers called through their own SDK rather than the AI SDK (Bedrock's Converse API) */
  json?: <T>(c: JsonCall<T>) => Promise<JsonResult<T>>;
}

const env = (k: string) => (process.env[k] ?? "").trim();

/** Amazon Bedrock (Converse API), the default provider. */
function bedrock(): Provider | null {
  if (!bedrockConfigured()) return null;
  return {
    name: "bedrock",
    model: (role) => ({ id: bedrockModel(role), lm: null }),
    options: () => ({}),
    json: async <T>(c: JsonCall<T>): Promise<JsonResult<T>> => {
      const r = await bedrockJson({ name: c.name, role: c.role, schema: c.schema, lenient: c.lenient, system: c.system, prompt: c.prompt,
        maxOutputTokens: c.maxOutputTokens, abortSignal: c.abortSignal });
      const info: CallInfo = { step: c.name, provider: "bedrock", model: r.model, ms: r.ms, inputTokens: r.inputTokens, outputTokens: r.outputTokens, attempts: 1 };
      charge(c.user, info.inputTokens - r.cacheReadTokens + info.outputTokens);
      console.info(`[assistant] ${c.name} bedrock/${r.model} ${r.ms} ms, ${r.inputTokens}+${r.outputTokens} tokens (${r.cacheReadTokens} from cache)`);
      return { object: r.object, info };
    }
  };
}

function groq(): Provider | null {
  const apiKey = env("GROQ_API_KEY");
  if (!apiKey) return null;
  const p = createGroq({ apiKey });
  const ids = { fast: env("AI_MODEL_FAST") || "openai/gpt-oss-20b", reasoning: env("AI_MODEL_REASONING") || "openai/gpt-oss-120b" };
  return {
    name: "groq",
    model: (role) => ({ id: ids[role], lm: p(ids[role]) }),
    // gpt-oss thinks before it answers: keep that short (speed, and the free tier's tokens per minute)
    options: () => ({ groq: { structuredOutputs: true, strictJsonSchema: true, reasoningEffort: env("AI_REASONING_EFFORT") || "low", reasoningFormat: "hidden" } })
  };
}

function openai(): Provider | null {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return null;
  const p = createOpenAI({ apiKey });
  const ids = { fast: env("AI_FALLBACK_MODEL_FAST") || "gpt-4.1-mini", reasoning: env("AI_FALLBACK_MODEL_REASONING") || "gpt-4.1-mini" };
  return {
    name: "openai",
    model: (role) => ({ id: ids[role], lm: p(ids[role]) }),
    // store: false, so prompts are not kept on OpenAI's side
    options: () => ({ openai: { strictJsonSchema: true, store: false } })
  };
}

/** Providers in the order they are tried: AI_PROVIDER (default bedrock), then AI_FALLBACK_PROVIDER (default none); only those configured. */
function providers(): Provider[] {
  const make: Record<string, () => Provider | null> = { bedrock, groq, openai };
  const order = [env("AI_PROVIDER") || "bedrock", env("AI_FALLBACK_PROVIDER") || "none"];
  const out: Provider[] = [];
  for (const name of order) {
    const p = make[name]?.();
    if (p && !out.some((x) => x.name === p.name)) out.push(p);
  }
  return out;
}

/** What the assistant can use right now (for the dialog's status line and the sources panel). */
export function aiStatus() {
  const list = providers();
  return {
    available: list.length > 0,
    /** why the model is not being used ("AWS keys expired"), when that is known */
    problem: bedrockProblem(),
    providers: list.map((p) => ({ name: p.name, fast: p.model("fast").id, reasoning: p.model("reasoning").id })),
    stt: env("AI_MODEL_STT") || "whisper-large-v3-turbo"
  };
}

// ------------------------------------------------------------ token budget --

const DAILY_TOKENS = Number(env("ASSISTANT_DAILY_TOKENS")) || 600_000;
const spent = new Map<string, { day: string; tokens: number }>();
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

function budgetLeft(user: string): boolean {
  const s = spent.get(user);
  return !s || s.day !== today() || s.tokens < DAILY_TOKENS;
}
function charge(user: string, tokens: number) {
  const d = today();
  const s = spent.get(user);
  spent.set(user, { day: d, tokens: (s && s.day === d ? s.tokens : 0) + tokens });
}

// ------------------------------------------------------------------- calls --

export interface JsonCall<T> {
  role: Role;
  /** short name of the step, for logs ("router", "planner", "composer") */
  name: string;
  /** sent to the provider as a strict JSON schema */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** checks a draft the provider rejected (optional fields tolerant); never sent */
  lenient?: z.ZodType<T, z.ZodTypeDef, unknown>;
  system: string;
  prompt: string;
  temperature: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  /** who is asking, for the daily budget */
  user: string;
}

export interface CallInfo { step: string; provider: ProviderName; model: string; ms: number; inputTokens: number; outputTokens: number; attempts: number }
export interface JsonResult<T> { object: T; info: CallInfo }

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason ?? new Error("aborted")); }, { once: true });
  });

/**
 * Groq checks structured output against the schema after generation; a miss comes back as HTTP
 * 400 "json_validate_failed" with the draft in failed_generation. The draft often matches our
 * own (more tolerant) zod schema, so it is worth checking before asking again.
 */
function failedDraft(e: APICallError): unknown | null {
  if (e.statusCode !== 400 || !/json_validate_failed|does not match the expected schema/i.test(`${e.responseBody ?? ""} ${e.message}`)) return null;
  try {
    const raw = JSON.parse(e.responseBody ?? "{}")?.error?.failed_generation;
    if (typeof raw !== "string") return null;
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

function retryAfterSeconds(e: APICallError): number | null {
  const h = e.responseHeaders ?? {};
  const v = h["retry-after"] ?? h["Retry-After"];
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? Math.max(1, Math.ceil(n)) : null;
}

/** Ask a model for an object matching `schema`. Tries each configured provider; throws AiBusyError, AiUnavailableError or AiBudgetError. */
export async function generateJson<T>(c: JsonCall<T>): Promise<JsonResult<T>> {
  const list = providers();
  if (!list.length) throw new AiUnavailableError();
  if (!budgetLeft(c.user)) throw new AiBudgetError();
  const state = { busyFor: null as number | null, lastError: null as unknown, attempts: 0 };
  for (const p of list) {
    if (p.json) {
      state.attempts++;
      try {
        return await p.json(c);
      } catch (e) {
        if (c.abortSignal?.aborted) throw e;
        state.lastError = e;
        if (e instanceof BedrockBusyError) state.busyFor = Math.max(state.busyFor ?? 0, e.retryAfter);
        console.warn(`[assistant] ${c.name} ${p.name} failed: ${(e as Error).message.slice(0, 200)}`);
        continue;
      }
    }
    // each model has its own rate limits: when one is out for a long while (a daily cap), the provider's other model answers
    const first = p.model(c.role), other = p.model(c.role === "fast" ? "reasoning" : "fast");
    if (!first.lm) continue;
    const r = await tryModel(c, p, first.id, first.lm, state);
    if (r.result) return r.result;
    if (r.longBusy && other.id !== first.id && other.lm) {
      console.warn(`[assistant] ${c.name}: ${p.name}/${first.id} is rate-limited for a while; trying ${p.name}/${other.id}`);
      const r2 = await tryModel(c, p, other.id, other.lm, state);
      if (r2.result) return r2.result;
    }
  }
  if (state.busyFor != null) throw new AiBusyError(state.busyFor);
  throw state.lastError instanceof Error ? state.lastError : new Error("The AI call failed.");
}

/** Up to three tries on one model. `longBusy`: it is rate-limited for longer than is worth waiting. */
async function tryModel<T>(c: JsonCall<T>, p: Provider, id: string, lm: LanguageModel,
  state: { busyFor: number | null; lastError: unknown; attempts: number }): Promise<{ result?: JsonResult<T>; longBusy: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    state.attempts++;
    const t0 = Date.now();
    try {
      const r = await generateText({
        model: lm, system: c.system, prompt: c.prompt, temperature: c.temperature, maxOutputTokens: c.maxOutputTokens ?? 1200,
        maxRetries: 0, abortSignal: c.abortSignal, output: Output.object({ schema: c.schema, name: c.name }), providerOptions: p.options(c.role)
      });
      const info: CallInfo = { step: c.name, provider: p.name, model: id, ms: Date.now() - t0, attempts: state.attempts,
        inputTokens: r.usage?.inputTokens ?? 0, outputTokens: r.usage?.outputTokens ?? 0 };
      charge(c.user, info.inputTokens + info.outputTokens);
      console.info(`[assistant] ${c.name} ${p.name}/${id} ${info.ms} ms, ${info.inputTokens}+${info.outputTokens} tokens`);
      return { result: { object: r.output as T, info }, longBusy: false };
    } catch (e) {
      if (c.abortSignal?.aborted) throw e;
      state.lastError = e;
      if (APICallError.isInstance(e)) {
        const draft = failedDraft(e);
        if (draft !== null) {
          const parsed = (c.lenient ?? c.schema).safeParse(draft);
          if (parsed.success) {
            const info: CallInfo = { step: c.name, provider: p.name, model: id, ms: Date.now() - t0, attempts: state.attempts, inputTokens: 0, outputTokens: 0 };
            console.info(`[assistant] ${c.name} ${p.name}/${id}: provider rejected the draft; it passed our schema, used it`);
            return { result: { object: parsed.data, info }, longBusy: false };
          }
          const issue = parsed.error.issues[0];
          console.warn(`[assistant] ${c.name} draft off-schema at ${issue?.path.join(".")}: ${issue?.message}`);
          state.lastError = new Error(`off-schema output at ${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
          if (attempt === 0) continue;
          return { longBusy: false };
        }
      }
      const status = APICallError.isInstance(e) ? e.statusCode : undefined;
      const busy = status === 429 || (status != null && status >= 500) || (APICallError.isInstance(e) && e.isRetryable);
      console.warn(`[assistant] ${c.name} ${p.name}/${id} failed (${status ?? (e as Error).name}): ${(e as Error).message.slice(0, 160)}`);
      if (busy) {
        const wait = APICallError.isInstance(e) ? retryAfterSeconds(e) : null;
        state.busyFor = Math.max(state.busyFor ?? 0, wait ?? 10);
        // a short wait is worth it (tokens-per-minute limits refill in seconds); a long one is not: try another model or provider
        if (attempt < 2 && (wait == null || wait <= 8)) {
          await sleep(wait != null ? wait * 1000 + Math.random() * 400 : Math.min(4000, 400 * 2 ** attempt + Math.random() * 400), c.abortSignal);
          continue;
        }
        return { longBusy: status === 429 && wait != null && wait > 8 };
      }
      // bad JSON or a schema mismatch: one more try on the same model, then the next provider
      if (!status && attempt === 0) continue;
      return { longBusy: false };
    }
  }
  return { longBusy: false };
}
