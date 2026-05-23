import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "./schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.env.FOCUS_TRACK_ROOT || path.resolve(__dirname, "../../..");
const dbPath = process.env.DATABASE_PATH || path.join(projectRoot, "focus.db");
const sqlite = new Database(dbPath);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS focus_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    datetime TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    category TEXT NOT NULL,
    focus_score REAL NOT NULL,
    summary TEXT NOT NULL
  )
`);

export const db = drizzle(sqlite, { schema });
