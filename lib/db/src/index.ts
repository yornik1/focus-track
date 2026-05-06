import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import * as schema from "./schema";

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "focus.db");
const sqlite = new Database(dbPath);

export const db = drizzle(sqlite, { schema });

export * from "./schema";
export * from "./app-settings";
