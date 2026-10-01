/**
 * Amazon Bedrock for Ask District IQ, through the Converse API, so one code path serves any model the
 * account may call: Amazon Nova Lite today (apac.amazon.nova-lite-v1:0 in ap-south-1, the only one this
 * account's role allows), Claude or another Converse model later by changing AI_BEDROCK_MODEL.
 *
 * Credentials and region come from the environment (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
 * AWS_SESSION_TOKEN, AWS_REGION, or an AWS profile); nothing is hard-coded. Temporary keys are
 * re-read when .env changes: the client is rebuilt when the keys differ.
 *
 * Each step gets one tool, `submit`, whose input schema is the step's zod schema; the model is told to
 * answer only by calling it (forced where the model allows it) and the input is checked with zod.
 *
 * Token economy: the long, fixed instructions go in the system block, followed by a cache point, so
 * repeat questions read them from the prompt cache; if the model or region does not offer caching the
 * cache point is dropped for the rest of the process. No text is asked for besides the tool call.
 */
import { BedrockRuntimeClient, ConverseCommand, type ContentBlock, type ConverseCommandOutput, type SystemContentBlock, type Tool } from "@aws-sdk/client-bedrock-runtime";
import { zodSchema } from "ai";
import type { z } from "zod";

export type BedrockRole = "fast" | "reasoning";

const env = (k: string) => (process.env[k] ?? "").trim();

/** Which keys are in .env now (a new paste changes it). */
const keyId = () => `${env("AWS_REGION")}|${env("AWS_ACCESS_KEY_ID")}|${env("AWS_SESSION_TOKEN").slice(-24)}`;

/**
 * Keys AWS has refused (temporary keys expire after a few hours): not tried again until .env holds different keys, so
 * questions are answered at once from the data instead of waiting on a refusal each time.
 */
export function bedrockProblem(): string | null {
  const f = global.__bedrockRefused;
  return f && f.key === keyId() ? f.reason : null;
}

export function bedrockConfigured(): boolean {
  const set = Boolean((env("AWS_ACCESS_KEY_ID") && env("AWS_SECRET_ACCESS_KEY")) || env("AWS_PROFILE") || env("AWS_BEARER_TOKEN_BEDROCK"));
  return set && !bedrockProblem();
}

export function bedrockModel(role: BedrockRole): string {
  const main = env("AI_BEDROCK_MODEL") || "apac.amazon.nova-lite-v1:0";
  return role === "fast" ? env("AI_BEDROCK_MODEL_FAST") || main : main;
}

declare global {
  // eslint-disable-next-line no-var
  var __bedrock: { key: string; client: BedrockRuntimeClient } | undefined;
  // eslint-disable-next-line no-var
  var __bedrockNoCache: Set<string> | undefined;
  // eslint-disable-next-line no-var
  var __bedrockRefused: { key: string; reason: string } | undefined;
}

function client(): BedrockRuntimeClient {
  const region = env("AWS_REGION") || env("AWS_DEFAULT_REGION") || "ap-south-1";
  const id = env("AWS_ACCESS_KEY_ID"), secret = env("AWS_SECRET_ACCESS_KEY"), token = env("AWS_SESSION_TOKEN");
  // rebuilt when the region or the keys change (temporary keys are replaced every few hours)
  const key = `${region}|${id}|${token.slice(-24)}`;
  if (global.__bedrock?.key !== key) {
    global.__bedrock = {
      key,
      client: new BedrockRuntimeClient({
        region, maxAttempts: 3,
        ...(id && secret ? { credentials: { accessKeyId: id, secretAccessKey: secret, ...(token ? { sessionToken: token } : {}) } } : {})
      })
    };
  }
  return global.__bedrock.client;
}

/** The schema the tool advertises, cached per zod schema (conversion is not free). */
const schemaCache = new WeakMap<object, Record<string, unknown>>();
function inputSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  let s = schemaCache.get(schema);
  if (!s) {
    s = { ...(zodSchema(schema).jsonSchema as Record<string, unknown>) };
    delete s.$schema;
    schemaCache.set(schema, s);
  }
  return s;
}

export class BedrockBusyError extends Error {
  constructor(public retryAfter: number, detail: string) {
    super(`Amazon Bedrock is busy (${detail}).`);
  }
}

export interface BedrockJsonArgs<T> {
  name: string;
  role: BedrockRole;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  lenient?: z.ZodType<T, z.ZodTypeDef, unknown>;
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
}

export interface BedrockJsonResult<T> {
  object: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  ms: number;
}

const TOOL = "submit";
const isClaude = (model: string) => /anthropic\./.test(model);

function firstJson(text: string): unknown | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/** Small models sometimes send a nested object as a JSON string, or wrap the answer in one extra key. */
function unwrap(raw: unknown): unknown {
  if (typeof raw === "string") return firstJson(raw) ?? raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && o[keys[0]] && typeof o[keys[0]] === "object" && ["input", "result", "output", "arguments", "parameters", TOOL].includes(keys[0])) return o[keys[0]];
    for (const k of keys) if (typeof o[k] === "string" && /^\s*[[{]/.test(o[k] as string)) {
      try { o[k] = JSON.parse(o[k] as string); } catch { /* keep the string */ }
    }
  }
  return raw;
}

/**
 * "tool": the answer comes as the `submit` tool's input. "text": the same schema, asked for as one JSON object in plain
 * text, for when a small model fails to form the tool call itself ("invalid sequence as part of ToolUse").
 */
type Mode = "tool" | "text";

async function send(model: string, a: BedrockJsonArgs<unknown>, prompt: string, cache: boolean, mode: Mode): Promise<ConverseCommandOutput> {
  const claude = isClaude(model);
  const how = mode === "tool"
    ? `Deliver your result only by calling the \`${TOOL}\` tool once, with every field of its schema filled (null where unused). Do not write any other text.`
    : `Reply with only one JSON object, no prose and no code fences, with every field of this JSON schema filled (null where unused):\n${JSON.stringify(inputSchema(a.schema))}`;
  const system: SystemContentBlock[] = [{ text: `${a.system}\n\n${how}` }];
  if (cache) system.push({ cachePoint: { type: "default" } });
  const tool: Tool = { toolSpec: { name: TOOL, description: `Returns the ${a.name} result. Call it exactly once.`, inputSchema: { json: inputSchema(a.schema) as never } } };
  return client().send(new ConverseCommand({
    modelId: model,
    system,
    messages: [{ role: "user", content: [{ text: prompt }] }],
    // Claude Sonnet 5.5 rejects a forced tool and a non-default temperature; Nova takes both, and Amazon recommends greedy
    // decoding (temperature 0) for Nova's tool calls: a warmer composer drifted off the schema
    ...(mode === "tool" ? { toolConfig: { tools: [tool], toolChoice: claude ? { auto: {} } : { tool: { name: TOOL } } } } : {}),
    inferenceConfig: { maxTokens: a.maxOutputTokens ?? 1500, ...(claude ? {} : { temperature: 0 }) }
  }), { abortSignal: a.abortSignal });
}

/** One structured step on Bedrock. Throws BedrockBusyError (throttling / outage) or a plain Error. */
export async function bedrockJson<T>(a: BedrockJsonArgs<T>): Promise<BedrockJsonResult<T>> {
  const model = bedrockModel(a.role);
  const t0 = Date.now();
  global.__bedrockNoCache ??= new Set();
  let lastIssue = "";
  let mode: Mode = "tool";
  const usage = { input: 0, output: 0, cacheRead: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const again = mode === "tool" ? `Call ${TOOL} again with a complete, valid object.` : "Reply again with one complete, valid JSON object.";
    const prompt = attempt === 0 ? a.prompt : `${a.prompt}\n\nYour previous reply did not match the schema (${lastIssue}). ${again}`;
    let res: ConverseCommandOutput;
    try {
      try {
        res = await send(model, a as BedrockJsonArgs<unknown>, prompt, !global.__bedrockNoCache.has(model), mode);
      } catch (e) {
        // prompt caching is not offered for every model and region: drop the cache point once and for all
        if ((e as Error).name === "ValidationException" && /cach/i.test((e as Error).message) && !global.__bedrockNoCache.has(model)) {
          global.__bedrockNoCache.add(model);
          console.info(`[assistant] bedrock/${model}: prompt caching not available here; continuing without it`);
          res = await send(model, a as BedrockJsonArgs<unknown>, prompt, false, mode);
        } else throw e;
      }
    } catch (e) {
      if (a.abortSignal?.aborted) throw e;
      const name = (e as Error).name, msg = (e as Error).message ?? "";
      // the model could not form the tool call: ask once more for the same object as plain JSON
      if (attempt === 0 && mode === "tool" && /tool ?use|invalid sequence/i.test(msg)) {
        console.warn(`[assistant] ${a.name} bedrock/${model}: tool call failed (${msg.slice(0, 120)}); asking for plain JSON`);
        lastIssue = "the tool call was malformed";
        mode = "text";
        continue;
      }
      if (name === "ThrottlingException" || name === "ServiceQuotaExceededException") throw new BedrockBusyError(20, "throttled");
      if (["ServiceUnavailableException", "InternalServerException", "ModelNotReadyException", "ModelTimeoutException"].includes(name)) throw new BedrockBusyError(15, name);
      if (name === "AccessDeniedException" || name === "UnrecognizedClientException" || name === "ExpiredTokenException" || /security token|expired/i.test(msg)) {
        // remembered for these keys: no more waiting on AWS until new keys are pasted
        global.__bedrockRefused = { key: keyId(), reason: name === "ExpiredTokenException" || /expired/i.test(msg) ? "AWS keys expired" : "AWS keys refused" };
        throw new Error(`Amazon Bedrock refused the AWS keys (${name}). Temporary keys expire after a few hours: paste fresh ones into .env. The model is ${model} in ${env("AWS_REGION") || "ap-south-1"}.`);
      }
      throw e;
    }
    usage.input += (res.usage?.inputTokens ?? 0) + (res.usage?.cacheReadInputTokens ?? 0) + (res.usage?.cacheWriteInputTokens ?? 0);
    usage.output += res.usage?.outputTokens ?? 0;
    usage.cacheRead += res.usage?.cacheReadInputTokens ?? 0;
    if (res.stopReason === "guardrail_intervened" || res.stopReason === "content_filtered") throw new Error("Amazon Bedrock's content filter stopped this reply.");
    const blocks: ContentBlock[] = res.output?.message?.content ?? [];
    const use = blocks.find((b) => b.toolUse?.name === TOOL)?.toolUse ?? blocks.find((b) => b.toolUse)?.toolUse;
    const text = blocks.map((b) => b.text ?? "").join("\n");
    const raw = use ? unwrap(use.input) : firstJson(text);
    const done = (object: T): BedrockJsonResult<T> => ({ object, model, ms: Date.now() - t0, inputTokens: usage.input, outputTokens: usage.output, cacheReadTokens: usage.cacheRead });
    if (raw != null) {
      const ok = a.schema.safeParse(raw);
      if (ok.success) return done(ok.data);
      if (a.lenient) {
        const loose = a.lenient.safeParse(raw);
        if (loose.success) return done(loose.data);
      }
      const issue = ok.error.issues[0];
      lastIssue = `${issue?.path.join(".") || "(root)"}: ${issue?.message}`;
    } else {
      lastIssue = res.stopReason === "max_tokens" ? "the reply was cut off" : mode === "tool" ? "no tool call" : "no JSON object";
    }
    console.warn(`[assistant] ${a.name} bedrock/${model}: off-schema reply (${lastIssue})${attempt === 0 ? "; asking again" : ""}`);
  }
  throw new Error(`off-schema output: ${lastIssue}`);
}
