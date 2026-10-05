import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "focus-track-workspace-"));
const databasePath = path.join(tmpRoot, "focus.db");
process.env.DATABASE_PATH = databasePath;
process.env.FOCUS_TRACK_ROOT = tmpRoot;
process.env.NODE_ENV = "test";
process.env.FOCUS_TRACK_SESSIONS_ENABLED = "1";

const legacy = new Database(databasePath);
legacy.exec(`
  CREATE TABLE focus_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    datetime TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    category TEXT NOT NULL,
    focus_score REAL NOT NULL,
    summary TEXT NOT NULL
  );
  INSERT INTO focus_log (datetime, timestamp, category, focus_score, summary)
  VALUES ('2026-01-01T00:00:00.000Z', 1, 'code', 7, 'legacy');
`);
legacy.close();

let sqlite: Database.Database;
let service: typeof import("@workspace/db");
let app: typeof import("../app").default;

before(async () => {
  service = await import("@workspace/db");
  app = (await import("../app")).default;
  sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");
});

beforeEach(() => {
  sqlite.exec("DELETE FROM focus_work_sessions; DELETE FROM focus_log WHERE id > 1; DELETE FROM focus_directions;");
  process.env.FOCUS_TRACK_SESSIONS_ENABLED = "1";
});

after(() => {
  sqlite.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

test("additive migration preserves legacy rows and old inserts", () => {
  const columns = sqlite.prepare("SELECT name FROM pragma_table_info('focus_log')").all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === "direction_id"));
  assert.equal((sqlite.prepare("SELECT direction_id FROM focus_log WHERE id = 1").get() as { direction_id: string | null }).direction_id, null);
  sqlite.prepare("INSERT INTO focus_log (datetime, timestamp, category, focus_score, summary) VALUES (?, ?, ?, ?, ?)")
    .run("2026-01-02T00:00:00.000Z", 2, "code", 8, "old writer");
  assert.equal((sqlite.prepare("SELECT direction_id FROM focus_log WHERE summary = 'old writer'").get() as { direction_id: string | null }).direction_id, null);
  assert.doesNotThrow(() => service.initializeFocusWorkspaceSchema(sqlite));
});

test("feature flag hides commands while availability stays readable", async () => {
  process.env.FOCUS_TRACK_SESSIONS_ENABLED = "0";
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const availability = await fetch(`${base}/api/focus-workspace/availability`);
    assert.deepEqual(await availability.json(), { enabled: false });
    assert.equal((await fetch(`${base}/api/focus-workspace/state`)).status, 404);
  } finally {
    server.close();
  }
});

test("direction CRUD normalizes optional fields and blocks archive while running", () => {
  const direction = service.createDirection({ label: "  Node.js  ", description: " docs ", weekly_target_minutes: "" }, 100);
  assert.equal(direction.label, "Node.js");
  assert.equal(direction.description, "docs");
  assert.equal(direction.weekly_target_minutes, null);
  const updated = service.updateDirection(direction.id, { weekly_target_minutes: 120 }, 101);
  assert.equal(updated.weekly_target_minutes, 120);
  service.startFocusWorkSession({
    request_id: "10000000-0000-4000-8000-000000000001",
    direction_id: direction.id,
    planned_minutes: 25,
  }, 200);
  assert.throws(() => service.archiveDirection(direction.id, 201), (error) => {
    assert.ok(error instanceof service.FocusWorkspaceError);
    return error.status === 409;
  });
});

test("start is globally exclusive and request_id is idempotent across completion", () => {
  const direction = service.createDirection({ label: "Work" }, 100);
  const input = {
    request_id: "20000000-0000-4000-8000-000000000001",
    direction_id: direction.id,
    planned_minutes: 25,
    intention: " Ship ",
  };
  const first = service.startFocusWorkSession(input, 1_000);
  assert.deepEqual(service.startFocusWorkSession(input, 1_001), first);
  assert.throws(() => service.startFocusWorkSession({ ...input, planned_minutes: 50 }, 1_001), /different data/);
  assert.throws(() => service.startFocusWorkSession({ ...input, request_id: "20000000-0000-4000-8000-000000000002" }, 1_001), /already running/);
  const completed = service.finishFocusWorkSession(first.id, 1_120);
  assert.equal(completed.ended_at, 1_120);
  assert.equal(completed.completion_reason, "manual");
  assert.equal(service.startFocusWorkSession(input, 2_000).id, first.id);
});

test("deadline reconciliation wins over late cancel and terminal commands are stable", () => {
  const direction = service.createDirection({ label: "English" }, 100);
  const session = service.startFocusWorkSession({
    request_id: "30000000-0000-4000-8000-000000000001",
    direction_id: direction.id,
    planned_minutes: 1,
  }, 10_000);
  const lateCancel = service.cancelFocusWorkSession(session.id, 20_000);
  assert.equal(lateCancel.status, "completed");
  assert.equal(lateCancel.ended_at, 10_060);
  assert.equal(lateCancel.completion_reason, "deadline");
  assert.deepEqual(service.finishFocusWorkSession(session.id, 30_000), lateCancel);
});

test("summary uses half-open log bounds, nullable score, and independent direction distribution", () => {
  const sessionDirection = service.createDirection({ label: "Session A" }, 100);
  const observedDirection = service.createDirection({ label: "Observed B" }, 101);
  const session = service.startFocusWorkSession({
    request_id: "40000000-0000-4000-8000-000000000001",
    direction_id: sessionDirection.id,
    planned_minutes: 25,
  }, 20_000);
  service.finishFocusWorkSession(session.id, 20_120);
  sqlite.prepare("INSERT INTO focus_log (datetime, timestamp, category, focus_score, summary, direction_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run("start", 20_000, "code", 6, "B", observedDirection.id);
  sqlite.prepare("INSERT INTO focus_log (datetime, timestamp, category, focus_score, summary, direction_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run("unknown", 20_060, "social", 4, "none", null);
  sqlite.prepare("INSERT INTO focus_log (datetime, timestamp, category, focus_score, summary, direction_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run("end", 20_120, "code", 10, "excluded", sessionDirection.id);
  const details = service.getFocusSessionDetails(session.id, 30_000);
  assert.equal(details.direction_id, sessionDirection.id);
  assert.equal(details.observations.sample_count, 2);
  assert.equal(details.observations.observed_score, 5);
  assert.deepEqual(details.observations.by_direction.map((row) => row.direction_id).sort(), [null, observedDirection.id].sort());

  const empty = service.startFocusWorkSession({
    request_id: "40000000-0000-4000-8000-000000000002",
    direction_id: sessionDirection.id,
    planned_minutes: 1,
  }, 40_000);
  service.finishFocusWorkSession(empty.id, 40_030);
  assert.deepEqual(service.getFocusSessionDetails(empty.id, 40_030).observations, {
    sample_count: 0,
    observed_score: null,
    by_direction: [],
  });
});

test("reflection is completed-only and null clears saved values without touching logs", () => {
  const direction = service.createDirection({ label: "Writing" }, 100);
  const session = service.startFocusWorkSession({
    request_id: "50000000-0000-4000-8000-000000000001",
    direction_id: direction.id,
    planned_minutes: 1,
  }, 50_000);
  assert.throws(() => service.saveFocusReflection(session.id, { result_note: "x" }, 50_001), /completed/);
  service.finishFocusWorkSession(session.id, 50_030);
  assert.equal(service.saveFocusReflection(session.id, { result_note: " Done ", self_rating: 8 }, 50_031).result_note, "Done");
  const logCount = (sqlite.prepare("SELECT count(*) AS count FROM focus_log").get() as { count: number }).count;
  const cleared = service.saveFocusReflection(session.id, { result_note: null, self_rating: null }, 50_032);
  assert.equal(cleared.result_note, null);
  assert.equal(cleared.self_rating, null);
  assert.equal((sqlite.prepare("SELECT count(*) AS count FROM focus_log").get() as { count: number }).count, logCount);
});

test("weekly summary splits completed sessions at a Kiev week boundary including DST", () => {
  const direction = service.createDirection({ label: "Boundary", weekly_target_minutes: 10 }, 100);
  const now = Math.floor(new Date("2026-10-27T12:00:00Z").getTime() / 1000);
  const bounds = service.currentKievWeekBounds(now);
  assert.equal(new Date(bounds.start * 1000).toISOString(), "2026-10-25T22:00:00.000Z");
  const start = bounds.start - 120;
  sqlite.prepare(`
    INSERT INTO focus_work_sessions (
      id, request_id, direction_id, intention, planned_minutes, started_at, planned_end_at,
      ended_at, status, completion_reason, result_note, self_rating, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, 4, ?, ?, ?, 'completed', 'deadline', NULL, NULL, ?, ?)
  `).run("boundary-session", "60000000-0000-4000-8000-000000000001", direction.id, start, start + 240, start + 240, start, start);
  const row = service.getFocusWorkspaceState(now).weekly.find((item) => item.id === direction.id)!;
  assert.equal(row.session_seconds, 120);
  assert.equal(row.remaining_seconds, 480);
});
