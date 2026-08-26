import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "focus-track-weekly-"));
const databasePath = path.join(tmpRoot, "focus.db");

process.env.DATABASE_PATH = databasePath;
process.env.FOCUS_TRACK_ROOT = tmpRoot;
process.env.NODE_ENV = "test";

let sqlite: Database.Database;
let service: typeof import("./weekly");

/** Локальная полночь + смещение секунд — чтобы точка попала в нужную локальную дату. */
function tsAt(date: string, secondsOffset: number): number {
  return Math.floor(new Date(`${date}T12:00:00`).getTime() / 1000) + secondsOffset;
}

function insertFocus(date: string, category: string, score: number, idx: number): void {
  const ts = tsAt(date, idx * 120);
  sqlite
    .prepare("INSERT INTO focus_log (datetime, timestamp, category, focus_score, summary) VALUES (?, ?, ?, ?, ?)")
    .run(new Date(ts * 1000).toISOString(), ts, category, score, "seed");
}

before(async () => {
  // Импорт @workspace/db создаёт таблицы в tmp focus.db.
  await import("@workspace/db");
  service = await import("./weekly");
  sqlite = new Database(databasePath);

  // Понедельник 2026-08-17: 3×code(8) + 2×social(3) → усилие 6мин, активное 10мин, фокус 60%.
  insertFocus("2026-08-17", "code", 8, 0);
  insertFocus("2026-08-17", "code", 8, 1);
  insertFocus("2026-08-17", "code", 8, 2);
  insertFocus("2026-08-17", "social", 3, 3);
  insertFocus("2026-08-17", "social", 3, 4);
  // Вторник 2026-08-18: 1×research(9) → усилие 2мин, но БЕЗ Garmin (дыра).
  insertFocus("2026-08-18", "research", 9, 0);

  sqlite
    .prepare("INSERT INTO garmin_daily (date, steps, sleep_minutes, resting_hr) VALUES (?, ?, ?, ?)")
    .run("2026-08-17", 10000, 480, 45);
  sqlite.prepare("INSERT INTO anki_daily (date, reviews, seconds) VALUES (?, ?, ?)").run("2026-08-17", 100, 600);
});

after(() => {
  sqlite.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

test("week meta: понедельник-старт и границы", async () => {
  const r = await service.computeWeeklyStats({ start: "2026-08-20" }); // четверг → неделя пн 17
  assert.equal(r.week.start, "2026-08-17");
  assert.equal(r.week.end, "2026-08-23");
  assert.ok(r.week.label.length > 0);
  assert.equal(r.by_day.length, 7);
});

test("cards: усилие/активное/фокус из focus_log", async () => {
  const r = await service.computeWeeklyStats({ start: "2026-08-17" });
  // усилие = code(6мин)+research(2мин)=8мин=0.133ч; активное=12мин=0.2ч; фокус=8/12=67%
  assert.equal(r.cards.effort_total_h.value, 0.1);
  assert.equal(r.cards.active_h.value, 0.2);
  assert.equal(r.cards.focus_pct.value, 67);
  // score avg = (8*3+3*2+9)/6 = 6.5
  assert.equal(r.cards.focus_score.value, 6.5);
});

test("cards: Anki и Garmin", async () => {
  const r = await service.computeWeeklyStats({ start: "2026-08-17" });
  assert.equal(r.cards.anki_reviews.value, 100);
  assert.equal(r.cards.anki_minutes.value, 10);
  assert.equal(r.cards.steps_per_day.value, 10000);
  assert.equal(r.cards.steps_per_day.source, "garmin");
  assert.equal(r.cards.sleep_avg_h.value, 8);
  assert.equal(r.cards.sleep_avg_h.source, "garmin");
});

test("by_day: понедельник заполнен, вторник без Garmin (дыра)", async () => {
  const r = await service.computeWeeklyStats({ start: "2026-08-17" });
  const mon = r.by_day.find((d) => d.date === "2026-08-17")!;
  assert.equal(mon.effort_h, 0.1);
  assert.equal(mon.focus_pct, 60);
  assert.equal(mon.focus_score, 6.0);
  assert.equal(mon.anki_reviews, 100);
  assert.equal(mon.steps, 10000);
  assert.equal(mon.sleep_h, 8);

  const tue = r.by_day.find((d) => d.date === "2026-08-18")!;
  assert.equal(tue.steps, null); // Garmin-дыра
  assert.equal(tue.sleep_h, null);
  assert.equal(tue.focus_score, 9.0); // focus-данные есть, а Garmin нет
});

test("categories: kind по категориям", async () => {
  const r = await service.computeWeeklyStats({ start: "2026-08-17" });
  const code = r.categories.find((c) => c.category === "code");
  assert.ok(code);
  assert.equal(code!.kind, "productive");
  const social = r.categories.find((c) => c.category === "social");
  assert.equal(social?.kind, "distracting");
});

test("coverage: дни недели с данными focus", async () => {
  const r = await service.computeWeeklyStats({ start: "2026-08-17" });
  assert.equal(r.coverage.days_with_data, 2);
});

test("пустая неделя: нули и null-дельты", async () => {
  const r = await service.computeWeeklyStats({ start: "2026-01-05" });
  assert.equal(r.cards.effort_total_h.value, 0);
  assert.equal(r.cards.effort_total_h.delta_pct, null);
  assert.equal(r.coverage.days_with_data, 0);
  assert.equal(r.categories.length, 0);
});

test("weekly_effort_history: 14 недель", async () => {
  const r = await service.computeWeeklyStats({ start: "2026-08-17" });
  assert.equal(r.weekly_effort_history.length, 14);
  const last = r.weekly_effort_history[r.weekly_effort_history.length - 1];
  assert.equal(last.week_start, "2026-08-17");
});

test("focus_leak_h = active - effort", async () => {
  const r = await service.computeWeeklyStats({ start: "2026-08-17" });
  // active 12мин - effort 8мин = 4мин = 0.0667ч → round1 = 0.1
  assert.equal(r.cards.focus_leak_h.value, 0.1);
});

test("прошлая неделя: is_partial=false, elapsed_days=7, полные дельты", async () => {
  const r = await service.computeWeeklyStats({ start: "2026-08-17" });
  assert.equal(r.week.is_current, false); // 2026-08-17 давно в прошлом
  assert.equal(r.week.is_partial, false);
  assert.equal(r.week.elapsed_days, 7);
});

test("daily_series: ряд за окно скаттера", async () => {
  const r = await service.computeWeeklyStats({ start: "2026-08-17" });
  assert.equal(r.daily_series.length, 98);
  const mon = r.daily_series.find((d) => d.date === "2026-08-17")!;
  assert.ok(mon.effort_h > 0);
  assert.equal(mon.sleep_h, 8);
});

test("по умолчанию открывается ЗАВЕРШЁННАЯ неделя (не текущая)", async () => {
  const r = await service.computeWeeklyStats({});
  assert.equal(r.week.is_current, false);
  assert.equal(r.week.is_partial, false);
  assert.equal(r.week.elapsed_days, 7);
});
