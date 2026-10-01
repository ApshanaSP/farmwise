/**
 * Puts a fresh AI key into .env for Ask District IQ and checks that it works. Temporary AWS keys
 * expire every few hours, so this is meant to be run whenever new ones are issued (e.g. before a demo).
 *
 *   npm run ai:key                 paste the keys, then press Enter on an empty line (or Ctrl+Z, Enter)
 *   npm run ai:key -- keys.txt     read them from a file
 *   npm run ai:check               only test the keys already in .env
 *
 * Accepts what the AWS access portal shows under "Access keys" in any of its forms:
 *   export AWS_ACCESS_KEY_ID="..."          (macOS / Linux)
 *   $Env:AWS_ACCESS_KEY_ID="..."            (PowerShell)
 *   set AWS_ACCESS_KEY_ID=...               (Windows cmd)
 *   aws_access_key_id = ...                 (credentials file)
 * plus AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN (and AWS_REGION if given; default ap-south-1).
 * A Groq key (gsk_...) or AWS_BEARER_TOKEN_BEDROCK also works.
 *
 * The running app re-reads .env on its own (the Bedrock client is rebuilt when the keys change),
 * so there is no restart. Keys are never printed: only their last 4 characters.
 */
const fs = require("fs");
const path = require("path");
const ENV = path.join(__dirname, "..", ".env");
const mask = (v) => (v ? `…${v.slice(-4)} (${v.length} chars)` : "(none)");

function parse(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(?:export\s+|set\s+|\$env:)?([A-Za-z_]+)\s*=\s*"?([^"]*)"?\s*$/i);
    if (!m) {
      const g = line.match(/\bgsk_[A-Za-z0-9]{20,}\b/);
      if (g) out.GROQ_API_KEY = g[0];
      continue;
    }
    const k = m[1].toUpperCase(), v = m[2].trim();
    if (!v) continue;
    if (["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION", "AWS_BEARER_TOKEN_BEDROCK", "GROQ_API_KEY", "AI_BEDROCK_MODEL"].includes(k)) out[k] = v;
  }
  return out;
}

/** Sets each key in .env (replacing the line if it is there, else adding it at the end). */
function writeEnv(vals) {
  let text = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  for (const [k, v] of Object.entries(vals)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, `${k}=${v}`);
    else text = text.replace(/\s*$/, "") + `${nl}${k}=${v}${nl}`;
  }
  fs.writeFileSync(ENV, text);
}

async function check() {
  require("dotenv").config({ path: ENV, override: true });
  const provider = (process.env.AI_PROVIDER || "bedrock").trim();
  if (provider === "groq") {
    const key = (process.env.GROQ_API_KEY || "").trim();
    if (!key) return console.log("No GROQ_API_KEY in .env.");
    const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` } });
    return console.log(r.ok ? "Groq key works. Ask District IQ will use it." : `Groq refused the key (HTTP ${r.status}).`);
  }
  const { BedrockRuntimeClient, ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");
  const region = (process.env.AWS_REGION || "ap-south-1").trim();
  const model = (process.env.AI_BEDROCK_MODEL || "apac.amazon.nova-lite-v1:0").trim();
  const id = (process.env.AWS_ACCESS_KEY_ID || "").trim(), secret = (process.env.AWS_SECRET_ACCESS_KEY || "").trim(), token = (process.env.AWS_SESSION_TOKEN || "").trim();
  if (!id && !process.env.AWS_BEARER_TOKEN_BEDROCK) return console.log("No AWS keys in .env yet. Run: npm run ai:key");
  console.log(`Testing Amazon Bedrock (${model}, ${region}) with key ${mask(id)}…`);
  const client = new BedrockRuntimeClient({ region, ...(id && secret ? { credentials: { accessKeyId: id, secretAccessKey: secret, ...(token ? { sessionToken: token } : {}) } } : {}) });
  try {
    const t0 = Date.now();
    const r = await client.send(new ConverseCommand({ modelId: model, messages: [{ role: "user", content: [{ text: "Reply with the word OK." }] }], inferenceConfig: { maxTokens: 5 } }));
    const said = r.output?.message?.content?.[0]?.text ?? "";
    console.log(`Bedrock answered in ${Date.now() - t0} ms ("${said.trim()}"). Ask District IQ will use the language model from the next question.`);
  } catch (e) {
    console.log(`Bedrock refused: ${e.name}: ${String(e.message).slice(0, 200)}`);
    console.log(/expired|ExpiredToken/i.test(String(e.message) + e.name) ? "These keys have expired: copy fresh ones from the AWS access portal and run npm run ai:key again."
      : "Check that all three values (access key, secret, session token) were pasted, and the region.");
    process.exitCode = 1;
  }
}

async function main() {
  if (process.argv.includes("--check")) return check();
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  let text;
  if (file) text = fs.readFileSync(file, "utf8");
  else {
    console.log("Paste the keys from the AWS access portal (or a Groq key), then press Enter on an empty line:");
    text = await new Promise((resolve) => {
      let buf = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (d) => { buf += d; if (/\n\s*\n\s*$/.test(buf)) { process.stdin.pause(); resolve(buf); } });
      process.stdin.on("end", () => resolve(buf));
    });
  }
  const v = parse(text);
  const vals = {};
  if (v.AWS_ACCESS_KEY_ID || v.AWS_BEARER_TOKEN_BEDROCK) {
    Object.assign(vals, { AI_PROVIDER: "bedrock" });
    for (const k of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_BEARER_TOKEN_BEDROCK", "AI_BEDROCK_MODEL"]) if (v[k]) vals[k] = v[k];
    vals.AWS_REGION = v.AWS_REGION || process.env.AWS_REGION || "ap-south-1";
    if (v.AWS_ACCESS_KEY_ID && !v.AWS_SECRET_ACCESS_KEY) return console.log("The secret access key is missing: paste the whole block.");
  } else if (v.GROQ_API_KEY) {
    Object.assign(vals, { AI_PROVIDER: "groq", GROQ_API_KEY: v.GROQ_API_KEY });
  } else {
    return console.log("No key found in what was pasted.");
  }
  writeEnv(vals);
  console.log(`Saved to .env: ${Object.entries(vals).map(([k, x]) => `${k}=${/KEY|TOKEN|SECRET/.test(k) ? mask(x) : x}`).join(", ")}`);
  await check();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
