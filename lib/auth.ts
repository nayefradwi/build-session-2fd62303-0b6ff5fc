/**
 * Public re-export of the server auth utilities at the path the task
 * spec calls out (`lib/auth.ts`). Real implementation lives in
 * `lib/server/auth.ts` so that it stays inside the server-only territory.
 */
export * from "@/lib/server/auth";
