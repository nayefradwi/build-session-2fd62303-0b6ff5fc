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

export { schema };
export * from "./schema";
