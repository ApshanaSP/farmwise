/**
 * Typed re-export of scripts/lib/intel.js: rule-based language detection,
 * severity / priority, duplicate grouping and ward clustering. The logic lives
 * once, in the CommonJS module the generator and exporter also use.
 */
import * as intel from "../../../scripts/lib/intel";

/** A dataset row keyed by column name, as returned by the shared SELECT. */
export type DatasetRow = Record<string, string | number | null | undefined>;

export type Language = "en" | "ta" | "tanglish";
export type Priority = "Critical" | "High" | "Medium" | "Low";

export interface Severity {
  score: number;
  priority: Priority;
  reasons: string[];
}

export interface SeverityContext {
  /** Same sub type, same ward, previous 72 h, including this complaint. */
  clusterCount?: number;
  /** "YYYY-MM-DD" rain-event days. */
  rainDays?: Set<string>;
  /** IST wall clock on the parseTs() scale; see nowIst(). */
  now?: number;
}

export const EXTENSION_COLUMNS: readonly string[] = intel.EXTENSION_COLUMNS;
export const GRIEVANCE_COLUMNS: readonly string[] = intel.GRIEVANCE_COLUMNS;
export const HISTORY_DATASET_COLUMNS: readonly string[] = intel.HISTORY_DATASET_COLUMNS;

export const languageOf = intel.languageOf as (text: string | null | undefined) => Language;
export const severity = intel.severity as (row: DatasetRow, context?: SeverityContext) => Severity;
export const duplicateGroup = intel.duplicateGroup as (row: DatasetRow, recentRows: DatasetRow[]) => string;
/** Fills the extension columns in place; rows must be sorted by Filed On. */
export const enrich = intel.enrich as (
  rows: DatasetRow[],
  options?: { now?: number; rainDays?: Set<string> }
) => DatasetRow[];
export const parseTs = intel.parseTs as (s: string) => number;
export const nowIst = intel.nowIst as () => number;
