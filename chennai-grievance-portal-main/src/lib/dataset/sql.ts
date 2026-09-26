/**
 * Typed re-export of scripts/lib/dataset-sql.js, the single definition of the
 * dataset columns shared with `npm run export:excel` and `npm run dataset:export`.
 * Nothing is duplicated here, so the live appender cannot drift from the
 * exporters.
 */
import * as sql from "../../../scripts/lib/dataset-sql";

interface QueryParts {
  where?: string;
  orderBy?: string;
  extra?: string[];
}

export const COMPLAINT_COLUMNS: readonly string[] = sql.COMPLAINT_COLUMNS;
export const HISTORY_COLUMNS: readonly string[] = sql.HISTORY_COLUMNS;
export const complaintsSql = sql.complaintsSql as (parts?: QueryParts) => string;
export const historySql = sql.historySql as (parts?: QueryParts) => string;
