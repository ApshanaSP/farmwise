/**
 * Builds (or brings up to date) the incident vector index behind Ask District IQ's meaning search, in its own
 * process so the web server never stalls. Runs after the daily data refresh (district_intel/scripts/run_intel_daily.bat)
 * and by hand with:  npm run embed:build
 * Only new or changed incidents are embedded; the model runs locally (multilingual-e5-base, no API key).
 */
const path = require("path");
const os = require("os");

const root = path.join(__dirname, "..");
process.chdir(root);
require("dotenv").config({ path: path.join(root, ".env") });
// the app's own TypeScript module, so the job and the server build each incident's text the same way
const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const { buildIndex, useThreads } = jiti(path.join(root, "src", "lib", "assistant", "embed.ts"));

const threads = Math.max(2, os.cpus().length - 2);
useThreads(threads);
const t0 = Date.now();
console.log(`[embed:build] ${new Date().toISOString()} starting on ${threads} threads`);
// the model library is an ES module: loaded here, by Node itself, and handed to the app's module
import(require("url").pathToFileURL(path.join(root, "node_modules", "@huggingface", "transformers", "dist", "transformers.node.mjs")).href)
  .then((tf) => { globalThis.__transformers = tf; })
  .then(() => buildIndex(null, { batch: 32, log: (m) => console.log(`[embed:build] ${m}`) }))
  .then((r) => {
    console.log(`[embed:build] done in ${Math.round((Date.now() - t0) / 1000)} s: ${r.embedded} embedded, ${r.total} incidents indexed`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(`[embed:build] failed: ${e && e.stack ? e.stack : e}`);
    process.exit(1);
  });
