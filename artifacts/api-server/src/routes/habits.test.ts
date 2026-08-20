import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";

type HabitCell = {
  date: string;
  habit: string;
  done: boolean;
  source: "auto" | "manual";
  updated_at: string;
};

type HabitDefinition = {
  id: string;
  label: string;
  auto_fill: boolean;
  category: string | null;
  current_streak: number;
};

type HabitsResponse = {
  habits: HabitDefinition[];
  entries: HabitCell[];
};

type HabitEvent = {
  id: number;
  date: string;
  habit: string;
  old_done: boolean | null;
  new_done: boolean;
  old_source: "auto" | "manual" | null;
  new_source: "auto" | "manual";
  actor: "auto" | "manual";
  changed_at: string;
};

type HistoryResponse = { events: HabitEvent[] };
type CountRow = { count: number };
type NameRow = { name: string };

const tmpRoot = mkdtempSync(path.join(tmpdir(), "focus-track-habits-"));
const databasePath = path.join(tmpRoot, "focus.db");

let sqlite: Database.Database;
let service: typeof import("./habits");
let workspaceDb: typeof import("@workspace/db");

const execFileAsync = promisify(execFile);

process.env.DATABASE_PATH = databasePath;
process.env.FOCUS_TRACK_ROOT = tmpRoot;
process.env.NODE_ENV = "test";

const legacySqlite = new Database(databasePath);
legacySqlite.exec(`
  CREATE TABLE habit_definitions (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    auto_fill INTEGER NOT NULL DEFAULT 0 CHECK (auto_fill IN (0, 1)),
    category TEXT,
    sort_order INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
  )
`);
legacySqlite.close();

async function postHabit(body: Record<string, unknown>): Promise<HabitCell> {
  return service.upsertHabit(body);
}

function eventCount(date: string, habit: string): number {
  const row = sqlite
    .prepare("SELECT count(*) AS count FROM habit_events WHERE date = ? AND habit = ?")
    .get(date, habit) as CountRow;
  return row.count;
}

function addDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

function kievToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kiev",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

before(async () => {
  await Promise.all([
    execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", 'await import("@workspace/db")'], {
      cwd: process.cwd(),
      env: process.env,
    }),
    execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", 'await import("@workspace/db")'], {
      cwd: process.cwd(),
      env: process.env,
    }),
  ]);
  workspaceDb = await import("@workspace/db");
  service = await import("./habits");
  sqlite = new Database(databasePath);
});

after(() => {
  sqlite.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

test("startup migration creates habit tables, composite key, triggers, and seed definitions", () => {
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('habits', 'habit_definitions', 'habit_events') ORDER BY name")
    .all() as NameRow[];
  assert.deepEqual(tables.map((row) => row.name), ["habit_definitions", "habit_events", "habits"]);

  const primaryKey = sqlite
    .prepare("SELECT name FROM pragma_table_info('habits') WHERE pk > 0 ORDER BY pk")
    .all() as NameRow[];
  assert.deepEqual(primaryKey.map((row) => row.name), ["date", "habit"]);

  const definitionColumns = sqlite
    .prepare("SELECT name FROM pragma_table_info('habit_definitions') ORDER BY cid")
    .all() as NameRow[];
  assert.ok(definitionColumns.some((row) => row.name === "created_at"));
  assert.ok(definitionColumns.some((row) => row.name === "updated_at"));

  const triggers = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'habits' ORDER BY name")
    .all() as NameRow[];
  assert.deepEqual(triggers.map((row) => row.name), [
    "habits_audit_after_insert",
    "habits_audit_after_update",
    "habits_protect_manual_before_update",
    "habits_validate_date_before_insert",
    "habits_validate_date_before_update",
  ]);

  const eventTriggers = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'habit_events' ORDER BY name")
    .all() as NameRow[];
  assert.deepEqual(eventTriggers.map((row) => row.name), [
    "habit_events_append_only_before_delete",
    "habit_events_append_only_before_update",
  ]);

  const definitions = sqlite
    .prepare("SELECT id, label, auto_fill, category, sort_order, active FROM habit_definitions ORDER BY sort_order")
    .all();
  assert.deepEqual(definitions, [
    { id: "meditation", label: "Meditation 🧘", auto_fill: 0, category: null, sort_order: 1, active: 1 },
    { id: "english_drill", label: "English drill 🇬🇧", auto_fill: 0, category: null, sort_order: 2, active: 1 },
    { id: "walk", label: "Walk 🚶", auto_fill: 1, category: null, sort_order: 3, active: 1 },
    { id: "node_learning", label: "Node learning 🟩", auto_fill: 1, category: null, sort_order: 4, active: 1 },
  ]);

  assert.throws(
    () => workspaceDb.db.insert(workspaceDb.habitsTable).values({
      date: "2026-07-01",
      habit: "missing",
      done: true,
      source: "manual",
    }).run(),
    /FOREIGN KEY constraint failed/,
  );
});

test("GET /habits returns active definitions and sparse entries for an inclusive range", async () => {
  sqlite.prepare("INSERT INTO habits (date, habit, done, source) VALUES (?, ?, ?, ?)").run("2026-07-01", "walk", 1, "auto");
  sqlite.prepare("INSERT INTO habits (date, habit, done, source) VALUES (?, ?, ?, ?)").run("2026-07-03", "meditation", 0, "manual");
  sqlite.prepare("INSERT INTO habits (date, habit, done, source) VALUES (?, ?, ?, ?)").run("2026-07-04", "walk", 1, "auto");

  const body: HabitsResponse = await service.listHabits({ from: "2026-07-01", to: "2026-07-03" });
  assert.deepEqual(body.habits.map((habit) => habit.id), ["meditation", "english_drill", "walk", "node_learning"]);
  assert.deepEqual(
    body.entries.map(({ date, habit, done, source }) => ({ date, habit, done, source })),
    [
      { date: "2026-07-01", habit: "walk", done: true, source: "auto" },
      { date: "2026-07-03", habit: "meditation", done: false, source: "manual" },
    ],
  );
});

test("POST defaults to manual and manual false permanently overrides an automatic cell", async () => {
  const date = "2026-07-05";
  const automatic = await postHabit({ date, habit: "walk", done: true, source: "auto" });
  assert.equal(automatic.source, "auto");

  const cleared = await postHabit({ date, habit: "walk", done: false });
  assert.deepEqual(
    { done: cleared.done, source: cleared.source },
    { done: false, source: "manual" },
  );

  const beforeUpdatedAt = cleared.updated_at;
  const beforeEvents = eventCount(date, "walk");
  const blocked = await postHabit({ date, habit: "walk", done: true, source: "auto" });
  assert.deepEqual(
    {
      done: blocked.done,
      source: blocked.source,
      updated_at: blocked.updated_at,
    },
    { done: false, source: "manual", updated_at: beforeUpdatedAt },
  );
  assert.equal(eventCount(date, "walk"), beforeEvents);
});

test("manual can claim an auto cell without changing done, while auto can update auto", async () => {
  const date = "2026-07-06";
  await postHabit({ date, habit: "node_learning", done: true, source: "auto" });
  const autoUpdate = await postHabit({ date, habit: "node_learning", done: false, source: "auto" });
  assert.deepEqual(
    { done: autoUpdate.done, source: autoUpdate.source },
    { done: false, source: "auto" },
  );

  const manualClaim = await postHabit({ date, habit: "node_learning", done: false, source: "manual" });
  assert.deepEqual(
    { done: manualClaim.done, source: manualClaim.source },
    { done: false, source: "manual" },
  );
  assert.equal(eventCount(date, "node_learning"), 3);

  const beforeUpdatedAt = manualClaim.updated_at;
  const beforeEvents = eventCount(date, "node_learning");
  const noOp = await postHabit({ date, habit: "node_learning", done: false, source: "manual" });
  assert.equal(noOp.updated_at, beforeUpdatedAt);
  assert.equal(eventCount(date, "node_learning"), beforeEvents);
});

test("database triggers audit direct SQL and protect manual rows from direct auto upserts", () => {
  const date = "2026-07-07";
  sqlite.prepare("INSERT INTO habits (date, habit, done, source) VALUES (?, ?, 1, 'manual')").run(date, "meditation");
  assert.equal(eventCount(date, "meditation"), 1);

  sqlite.prepare(`
    INSERT INTO habits (date, habit, done, source) VALUES (?, ?, 0, 'auto')
    ON CONFLICT(date, habit) DO UPDATE SET
      done = excluded.done,
      source = excluded.source,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).run(date, "meditation");

  const row = sqlite.prepare("SELECT done, source FROM habits WHERE date = ? AND habit = ?").get(date, "meditation");
  assert.deepEqual(row, { done: 1, source: "manual" });
  assert.equal(eventCount(date, "meditation"), 1);
});

test("database rejects malformed civil dates from direct SQL", () => {
  for (const date of ["2026-07-0x", "2026-02-30"]) {
    assert.throws(
      () => sqlite.prepare("INSERT INTO habits (date, habit, done, source) VALUES (?, 'walk', 1, 'auto')").run(date),
      /invalid habit date/,
    );
  }

  assert.doesNotThrow(() => {
    sqlite.prepare("INSERT INTO habits (date, habit, done, source) VALUES ('2028-02-29', 'walk', 1, 'auto')").run();
  });
});

test("GET /habits/history returns successful changes only and supports habit filtering", async () => {
  const date = "2026-07-08";
  await postHabit({ date, habit: "english_drill", done: true });
  await postHabit({ date, habit: "english_drill", done: false });
  await postHabit({ date, habit: "walk", done: true, source: "auto" });

  const body: HistoryResponse = await service.listHabitHistory({ from: date, to: date, habit: "english_drill" });
  assert.equal(body.events.length, 2);
  assert.ok(body.events.every((event) => event.habit === "english_drill" && event.actor === "manual"));
  assert.deepEqual(
    body.events.map((event) => [event.old_done, event.new_done]),
    [[true, false], [null, true]],
  );

  sqlite.prepare("UPDATE habit_definitions SET active = 0 WHERE id = 'english_drill'").run();
  try {
    const archived = await service.listHabitHistory({ from: date, to: date, habit: "english_drill" });
    assert.equal(archived.events.length, 2);
  } finally {
    sqlite.prepare("UPDATE habit_definitions SET active = 1 WHERE id = 'english_drill'").run();
  }
});

test("habit_events is append-only for direct SQL updates and deletes", () => {
  const event = sqlite.prepare("SELECT id FROM habit_events ORDER BY id LIMIT 1").get() as { id: number };
  assert.throws(
    () => sqlite.prepare("UPDATE habit_events SET new_done = 0 WHERE id = ?").run(event.id),
    /habit_events is append-only/,
  );
  assert.throws(
    () => sqlite.prepare("DELETE FROM habit_events WHERE id = ?").run(event.id),
    /habit_events is append-only/,
  );
  assert.equal((sqlite.prepare("SELECT count(*) AS count FROM habit_events WHERE id = ?").get(event.id) as CountRow).count, 1);
});

test("GET /habits/history sorts by changed_at descending with id as a tie breaker", async () => {
  const date = "2026-07-10";
  const insertEvent = sqlite.prepare(`
    INSERT INTO habit_events (
      date, habit, old_done, new_done, old_source, new_source, actor, changed_at
    ) VALUES (?, 'meditation', NULL, 1, NULL, 'manual', 'manual', ?)
  `);
  insertEvent.run(date, "2030-01-01T00:00:00.000Z");
  insertEvent.run(date, "2020-01-01T00:00:00.000Z");

  const body = await service.listHabitHistory({ from: date, to: date, habit: "meditation" });
  assert.deepEqual(
    body.events.map((event) => event.changed_at),
    ["2030-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z"],
  );
});

test("habit definitions can be created, edited, and archived without losing history", async () => {
  const created = await service.createHabitDefinition({
    id: "reading",
    label: "Reading 📚",
    auto_fill: false,
    category: "learning",
  });
  assert.deepEqual(
    { id: created.id, label: created.label, auto_fill: created.auto_fill, category: created.category, active: created.active },
    { id: "reading", label: "Reading 📚", auto_fill: false, category: "learning", active: true },
  );

  const updated = await service.updateHabitDefinition("reading", {
    label: "Books 📖",
    auto_fill: true,
    category: null,
  });
  assert.deepEqual(
    { label: updated.label, auto_fill: updated.auto_fill, category: updated.category },
    { label: "Books 📖", auto_fill: true, category: null },
  );

  await postHabit({ date: "2026-07-11", habit: "reading", done: true });
  const archived = await service.archiveHabitDefinition("reading");
  assert.equal(archived.active, false);
  assert.equal((await service.listHabits({ from: "2026-07-11", to: "2026-07-11" })).habits.some((habit) => habit.id === "reading"), false);
  assert.equal((await service.listHabitHistory({ from: "2026-07-11", to: "2026-07-11", habit: "reading" })).events.length, 1);
  await assert.rejects(() => postHabit({ date: "2026-07-12", habit: "reading", done: true }), service.HabitInputError);
});

test("habit definition ids are generated from labels and collisions get a numeric suffix", async () => {
  const first = await service.createHabitDefinition({
    label: "Deep Work 🔥",
    auto_fill: false,
    category: null,
  });
  const second = await service.createHabitDefinition({
    label: "Deep Work",
    auto_fill: false,
    category: null,
  });

  assert.equal(first.id, "deep_work");
  assert.equal(second.id, "deep_work_2");
});

test("habit definitions can be reprioritized as one validated active list", async () => {
  const before = await service.listHabits({ from: "2026-07-01", to: "2026-07-01" });
  const reversedIds = before.habits.map((habit) => habit.id).reverse();

  const reordered = await service.reorderHabitDefinitions({ ids: reversedIds });
  assert.deepEqual(reordered.map((habit) => habit.id), reversedIds);
  assert.deepEqual(reordered.map((habit) => habit.sort_order), reversedIds.map((_, index) => index + 1));
  assert.deepEqual(
    (await service.listHabits({ from: "2026-07-01", to: "2026-07-01" })).habits.map((habit) => habit.id),
    reversedIds,
  );

  for (const ids of [
    reversedIds.slice(1),
    [...reversedIds, reversedIds[0]],
    [...reversedIds.slice(0, -1), "missing"],
  ]) {
    await assert.rejects(() => service.reorderHabitDefinitions({ ids }), service.HabitInputError);
  }

  assert.deepEqual(
    (await service.listHabits({ from: "2026-07-01", to: "2026-07-01" })).habits.map((habit) => habit.id),
    reversedIds,
  );
});

test("habit definition CRUD validates ids, labels, booleans, duplicates, and unknown ids", async () => {
  for (const body of [
    { id: "Bad id", label: "Valid" },
    { id: "valid_id", label: "   " },
    { id: "valid_id", label: "Valid", auto_fill: "yes" },
  ]) {
    await assert.rejects(() => service.createHabitDefinition(body), service.HabitInputError);
  }

  await assert.rejects(
    () => service.createHabitDefinition({ id: "walk", label: "Duplicate" }),
    service.HabitInputError,
  );
  await assert.rejects(() => service.updateHabitDefinition("missing", { label: "Nope" }), service.HabitInputError);
  await assert.rejects(() => service.archiveHabitDefinition("missing"), service.HabitInputError);
});

test("current streak uses all history and does not let an unfinished today break yesterday's run", async () => {
  const today = kievToday();
  const yesterday = addDate(today, -1);
  const twoDaysAgo = addDate(today, -2);
  await postHabit({ date: twoDaysAgo, habit: "english_drill", done: true });
  await postHabit({ date: yesterday, habit: "english_drill", done: true });

  const beforeToday = await service.listHabits({ from: twoDaysAgo, to: today });
  assert.equal(beforeToday.habits.find((habit) => habit.id === "english_drill")?.current_streak, 2);

  await postHabit({ date: today, habit: "english_drill", done: true });
  const withToday = await service.listHabits({ from: twoDaysAgo, to: today });
  assert.equal(withToday.habits.find((habit) => habit.id === "english_drill")?.current_streak, 3);

  await postHabit({ date: today, habit: "english_drill", done: false });
  const clearedToday = await service.listHabits({ from: twoDaysAgo, to: today });
  assert.equal(clearedToday.habits.find((habit) => habit.id === "english_drill")?.current_streak, 2);
});

test("validates dates, ranges, done/source values, and active habit ids", async () => {
  assert.equal((await postHabit({ date: "2026-07-09", habit: "walk", done: 1 })).done, true);
  assert.equal((await postHabit({ date: "2026-07-09", habit: "walk", done: 0 })).done, false);

  for (const body of [
    { date: "2026-02-30", habit: "walk", done: true },
    { date: "2026-07-09", habit: "missing", done: true },
    { date: "2026-07-09", habit: "walk", done: "yes" },
    { date: "2026-07-09", habit: "walk", done: true, source: "agent" },
  ]) {
    await assert.rejects(() => postHabit(body), service.HabitInputError);
  }

  await assert.rejects(
    () => service.listHabits({ from: "2026-07-10", to: "2026-07-01" }),
    service.HabitInputError,
  );
  await assert.rejects(
    () => service.upsertHabit(null as unknown as Record<string, unknown>),
    service.HabitInputError,
  );
});
