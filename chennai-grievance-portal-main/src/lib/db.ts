import mysql, { Pool, PoolConnection } from "mysql2/promise";

declare global {
  // eslint-disable-next-line no-var
  var __mysqlPool: Pool | undefined;
}

/**
 * Connection settings from either discrete DB_* vars or a connection URL.
 * Managed hosts (Railway, Aiven, PlanetScale, ...) provide a URL, so accepting
 * both lets the same build run locally and in production.
 */
function connectionSettings() {
  const url = process.env.DATABASE_URL || process.env.MYSQL_URL;
  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
      // Managed MySQL generally requires TLS.
      ssl:
        u.searchParams.get("ssl") === "false"
          ? undefined
          : { rejectUnauthorized: false }
    };
  }
  return {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "district_collector_dashboard",
    ssl: undefined
  };
}

function createPool(): Pool {
  return mysql.createPool({
    ...connectionSettings(),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true
  });
}

// Reuse the pool across hot-reloads in dev and across route invocations.
const pool: Pool = global.__mysqlPool || createPool();
if (process.env.NODE_ENV !== "production") {
  global.__mysqlPool = pool;
}

export default pool;

/** Run a set of queries inside a transaction. */
export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
