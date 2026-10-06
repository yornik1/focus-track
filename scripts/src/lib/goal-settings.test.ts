import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Импорт @workspace/db открывает SQLite при загрузке — подставляем временную базу ДО динамического импорта.
const tmpRoot = mkdtempSync(path.join(tmpdir(), "focus-track-goal-"));
process.env.DATABASE_PATH = path.join(tmpRoot, "focus.db");
process.env.FOCUS_TRACK_ROOT = tmpRoot;
process.env.NODE_ENV = "test";

let service: typeof import("@workspace/db");

const FULL = {
  goal: "Не терять дни",
  first_action: "английский вслух с ИИ",
  step_habit_ids: ["walk", "talk_to_llm_eng", "node_learning"],
  question_habit_id: "talk_to_llm_eng",
  nudge_hour: 13,
  min_screenshots: 7,
  streak: { start_date: "2026-10-06", earn_every: 5, cap: 2, start_freezes: 1 },
  review_date: "2026-11-05",
};

function writeGoalFile(content: string): void {
  writeFileSync(service.goalSettingsPath(), content, "utf8");
}

function invalidReason(result: import("@workspace/db").GoalSettingsResult): string {
  assert.equal(result.status, "invalid");
  return result.status === "invalid" ? result.reason : "";
}

before(async () => {
  service = await import("@workspace/db");
});

beforeEach(() => {
  rmSync(service.goalSettingsPath(), { force: true });
});

after(() => {
  service.sqliteConnection.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

test("goalSettingsPath/speakingTopicsPath: файлы лежат рядом с focus-app-settings.json", () => {
  const dir = path.dirname(service.resolveAppSettingsPath());
  assert.equal(dir, tmpRoot);
  assert.equal(service.goalSettingsPath(), path.join(tmpRoot, "focus-goal.json"));
  assert.equal(service.speakingTopicsPath(), path.join(tmpRoot, "speaking-topics.txt"));
});

test("readGoalSettings: файла нет → missing", () => {
  assert.deepEqual(service.readGoalSettings(), { status: "missing" });
});

test("readGoalSettings: битый JSON → invalid с причиной", () => {
  writeGoalFile('{ "first_action": "английский", ');
  assert.ok(invalidReason(service.readGoalSettings()).length > 0);
});

test("readGoalSettings: нет first_action → invalid", () => {
  writeGoalFile(JSON.stringify({ step_habit_ids: ["walk"] }));
  assert.match(invalidReason(service.readGoalSettings()), /first_action/);
});

test("readGoalSettings: пустой step_habit_ids → invalid", () => {
  writeGoalFile(JSON.stringify({ first_action: "английский", step_habit_ids: [] }));
  assert.match(invalidReason(service.readGoalSettings()), /step_habit_ids/);
});

test("readGoalSettings: полный файл → ok с точными значениями", () => {
  writeGoalFile(JSON.stringify(FULL, null, 2));
  assert.deepEqual(service.readGoalSettings(), { status: "ok", settings: FULL });
});

test("readGoalSettings: минимальный файл → значения по умолчанию", () => {
  writeGoalFile(JSON.stringify({ first_action: "английский", step_habit_ids: ["walk"] }));
  assert.deepEqual(service.readGoalSettings(), {
    status: "ok",
    settings: { first_action: "английский", step_habit_ids: ["walk"], nudge_hour: 14, min_screenshots: 5 },
  });
});

test("readGoalSettings: испорченный streak → invalid", () => {
  writeGoalFile(JSON.stringify({ ...FULL, streak: { start_date: "<день старта>", earn_every: 5, cap: 2, start_freezes: 1 } }));
  assert.match(invalidReason(service.readGoalSettings()), /streak/);
});

test('readGoalSettings: review_date "" → undefined', () => {
  writeGoalFile(JSON.stringify({ ...FULL, review_date: "" }));
  const result = service.readGoalSettings();
  assert.equal(result.status, "ok");
  assert.equal(result.status === "ok" ? result.settings.review_date : "set", undefined);
});

test("readGoalSettings: start_freezes больше cap → invalid", () => {
  writeGoalFile(JSON.stringify({ ...FULL, streak: { ...FULL.streak, cap: 2, start_freezes: 3 } }));
  assert.match(invalidReason(service.readGoalSettings()), /start_freezes/);
});

test("parseGoalSettings: не объект → invalid, missing не возвращает", () => {
  for (const raw of [null, undefined, "text", 5, [], [FULL]]) {
    assert.equal(service.parseGoalSettings(raw).status, "invalid");
  }
});

test("parseGoalSettings: обрезает пробелы и убирает повторы привычек", () => {
  const result = service.parseGoalSettings({
    first_action: "  английский  ",
    step_habit_ids: [" walk ", "walk", "node_learning"],
    question_habit_id: " talk_to_llm_eng ",
  });
  assert.deepEqual(result, {
    status: "ok",
    settings: {
      first_action: "английский",
      step_habit_ids: ["walk", "node_learning"],
      question_habit_id: "talk_to_llm_eng",
      nudge_hour: 14,
      min_screenshots: 5,
    },
  });
});

test("parseGoalSettings: обязательные поля не выдумываются", () => {
  const base = { first_action: "английский", step_habit_ids: ["walk"] };
  assert.equal(service.parseGoalSettings({ ...base, first_action: "   " }).status, "invalid");
  assert.equal(service.parseGoalSettings({ ...base, first_action: 5 }).status, "invalid");
  assert.equal(service.parseGoalSettings({ ...base, step_habit_ids: "walk" }).status, "invalid");
  assert.equal(service.parseGoalSettings({ ...base, step_habit_ids: ["walk", ""] }).status, "invalid");
  assert.equal(service.parseGoalSettings({ ...base, step_habit_ids: ["walk", 3] }).status, "invalid");
  assert.equal(service.parseGoalSettings({ ...base, question_habit_id: "" }).status, "invalid");
});

test("parseGoalSettings: границы nudge_hour и min_screenshots", () => {
  const base = { first_action: "английский", step_habit_ids: ["walk"] };
  for (const nudge_hour of [0, 23]) {
    const result = service.parseGoalSettings({ ...base, nudge_hour });
    assert.equal(result.status === "ok" ? result.settings.nudge_hour : null, nudge_hour);
  }
  for (const nudge_hour of [-1, 24, 14.5, "14"]) {
    assert.match(invalidReason(service.parseGoalSettings({ ...base, nudge_hour })), /nudge_hour/);
  }
  const zero = service.parseGoalSettings({ ...base, min_screenshots: 0 });
  assert.equal(zero.status === "ok" ? zero.settings.min_screenshots : null, 0);
  for (const min_screenshots of [-1, 2.5, "5"]) {
    assert.match(invalidReason(service.parseGoalSettings({ ...base, min_screenshots })), /min_screenshots/);
  }
});

test("parseGoalSettings: streak проверяется по каждому полю", () => {
  const base = { first_action: "английский", step_habit_ids: ["walk"] };
  const streak = { start_date: "2026-10-06", earn_every: 5, cap: 2, start_freezes: 1 };
  const bad: unknown[] = [
    "5",
    [],
    null,
    { ...streak, start_date: "2026-02-30" },
    { ...streak, start_date: "06.10.2026" },
    { ...streak, earn_every: 0 },
    { ...streak, earn_every: 1.5 },
    { ...streak, cap: -1 },
    { ...streak, start_freezes: -1 },
    { start_date: "2026-10-06", earn_every: 5, cap: 2 },
  ];
  for (const value of bad) {
    assert.match(invalidReason(service.parseGoalSettings({ ...base, streak: value })), /streak/, JSON.stringify(value));
  }
  const edge = service.parseGoalSettings({ ...base, streak: { ...streak, cap: 0, start_freezes: 0, earn_every: 1 } });
  assert.deepEqual(edge.status === "ok" ? edge.settings.streak : null, {
    start_date: "2026-10-06",
    earn_every: 1,
    cap: 0,
    start_freezes: 0,
  });
});

test("parseGoalSettings: review_date — настоящая дата или пусто", () => {
  const base = { first_action: "английский", step_habit_ids: ["walk"] };
  const ok = service.parseGoalSettings({ ...base, review_date: "2026-11-05" });
  assert.equal(ok.status === "ok" ? ok.settings.review_date : null, "2026-11-05");
  for (const review_date of ["2026-13-01", "2026-02-30", "скоро", 20261105]) {
    assert.match(invalidReason(service.parseGoalSettings({ ...base, review_date })), /review_date/);
  }
});

test("parseGoalSettings: goal не строка и лишние ключи не мешают", () => {
  const result = service.parseGoalSettings({
    first_action: "английский",
    step_habit_ids: ["walk"],
    goal: 42,
    unknown_key: { nested: true },
  });
  assert.deepEqual(result, {
    status: "ok",
    settings: { first_action: "английский", step_habit_ids: ["walk"], nudge_hour: 14, min_screenshots: 5 },
  });
});
