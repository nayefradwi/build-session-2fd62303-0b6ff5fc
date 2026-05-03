import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";
import { env } from "@/lib/server/env";

/**
 * Drizzle client wired to a standard Postgres instance via node-postgres.
 * Cache the pool on globalThis in dev so Next.js HMR doesn't leak pools.
 *
 * Import as `import { db } from "@/lib/db"`.
 *
 * Use `db.transaction(async (tx) => { ... }, { isolationLevel: "serializable" })`
 * for atomic multi-statement work — the node-postgres adapter supports
 * interactive transactions natively.
 */
const globalForDb = globalThis as unknown as { pool?: Pool };

const pool =
  globalForDb.pool ?? new Pool({ connectionString: env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });

export { schema };
export * from "./schema";
