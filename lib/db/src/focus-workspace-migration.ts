import type Database from "better-sqlite3";

type TableColumn = { name: string };

function focusLogColumns(sqlite: Database.Database): Set<string> {
  return new Set(
    (sqlite.prepare("SELECT name FROM pragma_table_info('focus_log')").all() as TableColumn[]).map(
      (column) => column.name,
    ),
  );
}

/** Совместимое расширение схемы выполняется всегда, независимо от feature flag. */
export function initializeFocusWorkspaceSchema(sqlite: Database.Database): void {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS focus_directions (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
        description TEXT CHECK (description IS NULL OR length(description) <= 500),
        weekly_target_minutes INTEGER CHECK (
          weekly_target_minutes IS NULL OR weekly_target_minutes BETWEEN 1 AND 10080
        ),
        archived_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    if (!focusLogColumns(sqlite).has("direction_id")) {
      sqlite.exec(
        "ALTER TABLE focus_log ADD COLUMN direction_id TEXT DEFAULT NULL REFERENCES focus_directions(id)",
      );
    }

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS focus_work_sessions (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        direction_id TEXT NOT NULL REFERENCES focus_directions(id),
        intention TEXT CHECK (intention IS NULL OR length(intention) <= 200),
        planned_minutes INTEGER NOT NULL CHECK (planned_minutes BETWEEN 1 AND 180),
        started_at INTEGER NOT NULL,
        planned_end_at INTEGER NOT NULL,
        ended_at INTEGER,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'cancelled')),
        completion_reason TEXT CHECK (
          completion_reason IS NULL OR completion_reason IN ('deadline', 'manual')
        ),
        result_note TEXT CHECK (result_note IS NULL OR length(result_note) <= 1000),
        self_rating INTEGER CHECK (self_rating IS NULL OR self_rating BETWEEN 1 AND 10),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (planned_end_at = started_at + planned_minutes * 60),
        CHECK (
          (status = 'running' AND ended_at IS NULL AND completion_reason IS NULL)
          OR (status = 'cancelled' AND ended_at IS NOT NULL AND completion_reason IS NULL)
          OR (status = 'completed' AND ended_at IS NOT NULL AND completion_reason IS NOT NULL)
        ),
        CHECK (ended_at IS NULL OR (ended_at >= started_at AND ended_at <= planned_end_at))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS focus_work_sessions_one_running_uq
      ON focus_work_sessions ((1)) WHERE status = 'running';

      CREATE INDEX IF NOT EXISTS focus_work_sessions_direction_idx
      ON focus_work_sessions (direction_id, started_at);

      CREATE INDEX IF NOT EXISTS focus_log_direction_idx
      ON focus_log (direction_id, timestamp);
    `);
    sqlite.exec("COMMIT");
  } catch (error) {
    if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
    throw error;
  }
}

