import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function getDb(connectionString: string): NodePgDatabase<typeof schema> {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}
