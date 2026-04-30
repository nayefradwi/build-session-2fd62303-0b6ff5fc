import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";
import { env } from "@/lib/server/env";

/**
 * Drizzle client wired to Neon over HTTP. The HTTP driver is the right
 * choice for serverless route handlers — it does not require connection
 * pooling and works on the Edge runtime if we ever opt in.
 *
 * Import as `import { db } from "@/lib/db"`.
 */
const sql = neon(env.DATABASE_URL);

export const db = drizzle(sql, { schema });

/**
 * Raw Neon HTTP SQL tag. The drizzle wrapper does NOT expose a working
 * `db.transaction()` for the HTTP driver (it throws); for code paths that
 * genuinely need a batched/atomic transaction with a custom isolation
 * level, use `neonSql.transaction([...queries], { isolationLevel: ... })`
 * directly. Order creation (POST /api/orders) is the canonical example.
 */
export const neonSql = sql;

export { schema };
export * from "./schema";
