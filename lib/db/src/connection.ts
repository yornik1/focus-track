import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "./schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.env.FOCUS_TRACK_ROOT || path.resolve(__dirname, "../../..");
const dbPath = process.env.DATABASE_PATH || path.join(projectRoot, "focus.db");
const sqlite = new Database(dbPath);

sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("foreign_keys = ON");

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

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS habit_definitions (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    auto_fill INTEGER NOT NULL DEFAULT 0 CHECK (auto_fill IN (0, 1)),
    category TEXT,
    sort_order INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS habits (
    date TEXT NOT NULL CHECK (
      date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(date, '+0 days') = date
    ),
    habit TEXT NOT NULL REFERENCES habit_definitions(id),
    done INTEGER NOT NULL CHECK (done IN (0, 1)),
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('auto', 'manual')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (date, habit)
  );

  CREATE TABLE IF NOT EXISTS habit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    habit TEXT NOT NULL,
    old_done INTEGER CHECK (old_done IN (0, 1) OR old_done IS NULL),
    new_done INTEGER NOT NULL CHECK (new_done IN (0, 1)),
    old_source TEXT CHECK (old_source IN ('auto', 'manual') OR old_source IS NULL),
    new_source TEXT NOT NULL CHECK (new_source IN ('auto', 'manual')),
    actor TEXT NOT NULL CHECK (actor IN ('auto', 'manual')),
    changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TRIGGER IF NOT EXISTS habit_events_append_only_before_update
  BEFORE UPDATE ON habit_events
  BEGIN
    SELECT RAISE(ABORT, 'habit_events is append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS habit_events_append_only_before_delete
  BEFORE DELETE ON habit_events
  BEGIN
    SELECT RAISE(ABORT, 'habit_events is append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS habits_protect_manual_before_update
  BEFORE UPDATE ON habits
  WHEN OLD.source = 'manual' AND NEW.source = 'auto'
  BEGIN
    SELECT RAISE(IGNORE);
  END;

  CREATE TRIGGER IF NOT EXISTS habits_validate_date_before_insert
  BEFORE INSERT ON habits
  WHEN
    NEW.date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    OR date(NEW.date, '+0 days') IS NULL
    OR date(NEW.date, '+0 days') <> NEW.date
  BEGIN
    SELECT RAISE(ABORT, 'invalid habit date');
  END;

  CREATE TRIGGER IF NOT EXISTS habits_validate_date_before_update
  BEFORE UPDATE ON habits
  WHEN
    NEW.date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    OR date(NEW.date, '+0 days') IS NULL
    OR date(NEW.date, '+0 days') <> NEW.date
  BEGIN
    SELECT RAISE(ABORT, 'invalid habit date');
  END;

  CREATE TRIGGER IF NOT EXISTS habits_audit_after_insert
  AFTER INSERT ON habits
  BEGIN
    INSERT INTO habit_events (date, habit, old_done, new_done, old_source, new_source, actor)
    VALUES (NEW.date, NEW.habit, NULL, NEW.done, NULL, NEW.source, NEW.source);
  END;

  CREATE TRIGGER IF NOT EXISTS habits_audit_after_update
  AFTER UPDATE ON habits
  WHEN OLD.done IS NOT NEW.done OR OLD.source IS NOT NEW.source
  BEGIN
    INSERT INTO habit_events (date, habit, old_done, new_done, old_source, new_source, actor)
    VALUES (NEW.date, NEW.habit, OLD.done, NEW.done, OLD.source, NEW.source, NEW.source);
  END;
`);

type TableColumn = { name: string };

function habitDefinitionColumns(): Set<string> {
  return new Set(
    (sqlite.prepare("SELECT name FROM pragma_table_info('habit_definitions')").all() as TableColumn[]).map(
      (column) => column.name,
    ),
  );
}

const definitionColumns = habitDefinitionColumns();
if (!definitionColumns.has("created_at") || !definitionColumns.has("updated_at")) {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    const lockedColumns = habitDefinitionColumns();
    if (!lockedColumns.has("created_at")) {
      sqlite.exec("ALTER TABLE habit_definitions ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
    }
    if (!lockedColumns.has("updated_at")) {
      sqlite.exec("ALTER TABLE habit_definitions ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
    }
    sqlite.exec(`
      UPDATE habit_definitions
      SET
        created_at = CASE WHEN created_at = '' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE created_at END,
        updated_at = CASE WHEN updated_at = '' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE updated_at END
    `);
    sqlite.exec("COMMIT");
  } catch (error) {
    if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
    throw error;
  }
}

const insertHabitDefinition = sqlite.prepare(`
  INSERT INTO habit_definitions (
    id, label, auto_fill, category, sort_order, active, created_at, updated_at
  )
  VALUES (
    ?, ?, ?, ?, ?, 1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(id) DO NOTHING
`);

insertHabitDefinition.run("meditation", "Meditation 🧘", 0, null, 1);
insertHabitDefinition.run("english_drill", "English drill 🇬🇧", 0, null, 2);
insertHabitDefinition.run("walk", "Walk 🚶", 1, null, 3);
insertHabitDefinition.run("node_learning", "Node learning 🟩", 1, null, 4);

export const db = drizzle(sqlite, { schema });
