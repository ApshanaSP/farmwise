import fs from "fs";
import path from "path";
import { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { complaintsSql, historySql } from "@/lib/dataset/sql";
import {
  DatasetRow,
  GRIEVANCE_COLUMNS,
  HISTORY_DATASET_COLUMNS,
  enrich,
  nowIst,
  parseTs
} from "@/lib/dataset/intel";
import * as csv from "../../../scripts/lib/csv";
import * as files from "../../../scripts/lib/dataset-files";

/**
 * Live append to the grievance dataset (DATASET_DIR, default data/datasets).
 *
 * grievances.csv records each complaint as it was when filed; later status
 * changes add lines to grievance_status_history.csv only. `npm run
 * dataset:export` rebuilds both files from MySQL and repairs any drift.
 *
 * Writes go through one in-process promise queue so concurrent filings never
 * interleave lines. Every call is idempotent: a complaint or history row that
 * is already in the file is skipped.
 */

const IS_SYNTHETIC = "c.is_synthetic AS 'Is Synthetic'";
const HOUR = 3600 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __datasetQueue: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __datasetKeys: Map<string, { stamp: string; keys: Set<string> }> | undefined;
}

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = (global.__datasetQueue || Promise.resolve()).then(task);
  global.__datasetQueue = run.catch(() => undefined);
  return run;
}

function stampOf(file: string): string {
  try {
    const s = fs.statSync(file);
    return s.size + ":" + s.mtimeMs;
  } catch {
    return "missing";
  }
}

/**
 * The keys already in a file, loaded lazily and reloaded whenever the file
 * changed behind our back (for example after `npm run dataset:export`).
 */
function keysOf(file: string, keyOf: (record: string[]) => string): Set<string> {
  const cache = (global.__datasetKeys ||= new Map());
  const stamp = stampOf(file);
  const hit = cache.get(file);
  if (hit && hit.stamp === stamp) return hit.keys;
  const keys = new Set<string>();
  if (stamp !== "missing") {
    const records = csv.parse(fs.readFileSync(file, "utf8")) as string[][];
    for (const r of records.slice(1)) keys.add(keyOf(r));
  }
  cache.set(file, { stamp, keys });
  return keys;
}

function appendLines(file: string, columns: readonly string[], rows: DatasetRow[]) {
  if (!rows.length) return;
  const stamp = stampOf(file);
  const fresh = stamp === "missing" || stamp.startsWith("0:");
  // A new file gets the BOM and header first, so Excel reads Tamil correctly.
  let text = fresh ? csv.BOM + csv.line(columns) : "";
  for (const r of rows) text += csv.lineFromRow(r, columns);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, text, "utf8");
  // Our own write must not look like an outside change to keysOf().
  const entry = global.__datasetKeys?.get(file);
  if (entry) entry.stamp = stampOf(file);
}

const historyKey = (r: string[]) => [r[0], r[1], r[2], r[4]].join("|");
const historyKeyOf = (h: DatasetRow) =>
  [h["Complaint No"], h["Status"], h["Changed By Role"], h["Changed On"]].join("|");

const minus = (filedOn: string, hours: number) =>
  new Date(parseTs(filedOn) - hours * HOUR).toISOString().slice(0, 19).replace("T", " ");

async function appendHistory(paths: ReturnType<typeof files.datasetPaths>, code: string, newestOnly: boolean) {
  const [history] = await pool.query<RowDataPacket[]>(
    historySql({
      where: "c.complaint_code = ?",
      orderBy: newestOnly ? "h.created_at DESC, h.id DESC LIMIT 1" : "h.created_at, h.id",
      extra: [IS_SYNTHETIC]
    }),
    [code]
  );
  const present = keysOf(paths.history, historyKey);
  const fresh = (history as DatasetRow[]).filter((h) => !present.has(historyKeyOf(h)));
  appendLines(paths.history, HISTORY_DATASET_COLUMNS, fresh);
  for (const h of fresh) present.add(historyKeyOf(h));
}

async function appendComplaint(code: string) {
  const paths = files.datasetPaths(process.cwd());
  const codes = keysOf(paths.grievances, (r) => r[0]);
  if (codes.has(code)) return;

  const [rows] = await pool.query<RowDataPacket[]>(
    complaintsSql({ where: "c.complaint_code = ?", orderBy: "c.id", extra: [IS_SYNTHETIC] }),
    [code]
  );
  if (!rows.length) return;
  const row = rows[0] as DatasetRow;
  const filedOn = String(row["Filed On"]);

  // Duplicate and cluster context: complaints filed in the window before this
  // one. 144 h rather than 72 h so the earlier rows' own groups resolve too.
  const [recent] = await pool.query<RowDataPacket[]>(
    complaintsSql({
      where: "c.created_at >= ? AND c.created_at <= ? AND c.complaint_code <> ?",
      orderBy: "c.created_at, c.id",
      extra: [IS_SYNTHETIC]
    }),
    [minus(filedOn, 144), filedOn + ":59", code]
  );
  const context = [...(recent as DatasetRow[]), row];
  enrich(context, { now: nowIst(), rainDays: files.rainDays(process.cwd()) as Set<string> });

  appendLines(paths.grievances, GRIEVANCE_COLUMNS, [row]);
  codes.add(code);
  await appendHistory(paths, code, false);
}

/**
 * Appends a newly filed complaint (one line in grievances.csv) and its status
 * history. Safe to call more than once for the same code.
 */
export function appendComplaintToDataset(complaintCode: string): Promise<void> {
  return enqueue(() => appendComplaint(complaintCode));
}

/**
 * Appends the newest status-history row of a complaint. Call after every
 * status update (Officer / Collector APIs). If the complaint itself is not in
 * grievances.csv yet, it is appended with its full history instead.
 */
export function appendStatusChangeToDataset(complaintCode: string): Promise<void> {
  return enqueue(async () => {
    const paths = files.datasetPaths(process.cwd());
    if (!keysOf(paths.grievances, (r) => r[0]).has(complaintCode)) {
      await appendComplaint(complaintCode);
      return;
    }
    await appendHistory(paths, complaintCode, true);
  });
}
