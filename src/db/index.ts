import { getDb } from "./client";

export const db = getDb(process.env.DATABASE_URL!);
