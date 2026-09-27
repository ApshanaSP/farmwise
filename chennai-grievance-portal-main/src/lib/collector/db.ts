import mysql, { Pool } from "mysql2/promise";
import { connectionSettings } from "@/lib/db";

declare global {
  // eslint-disable-next-line no-var
  var __intelPool: Pool | undefined;
}

/**
 * The district intelligence store lives next to the portal database on the same
 * server: `district_intel` is rebuilt by the pipeline (read-only here) and
 * `district_intel_ops` holds what the Collector does (written here, never by the
 * pipeline's export). Names are configurable for hosted deployments.
 */
function dbName(value: string | undefined, fallback: string): string {
  const name = value || fallback;
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Invalid database name: ${name}`);
  return name;
}

export const INTEL_DB = dbName(process.env.INTEL_DB_NAME, "district_intel");
export const OPS_DB = dbName(process.env.INTEL_OPS_DB_NAME, "district_intel_ops");

function createPool(): Pool {
  return mysql.createPool({
    ...connectionSettings(),
    database: INTEL_DB,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    // DATETIME values are IST wall-clock; keep them as strings so no timezone shifts them.
    dateStrings: true,
    decimalNumbers: true
  });
}

const intelPool: Pool = global.__intelPool || createPool();
if (process.env.NODE_ENV !== "production") {
  global.__intelPool = intelPool;
}

export default intelPool;

/** Fully qualified ops table, e.g. ops("collector_decisions") -> `district_intel_ops`.`collector_decisions` */
export function ops(table: string): string {
  return `\`${OPS_DB}\`.\`${table}\``;
}
