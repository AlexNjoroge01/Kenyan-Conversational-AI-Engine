import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env";
import { normalizeDatabaseUrl } from "./connection-string";
import * as schema from "./schema";

export const pool = new Pool({ connectionString: normalizeDatabaseUrl(env.DATABASE_URL), max: 10 });

export const db = drizzle(pool, { schema });
export type Database = typeof db;

export async function checkDatabase(): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}
