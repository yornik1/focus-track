import assert from "node:assert/strict";
import test from "node:test";
import {
  computeFocusSessions,
  summarizeDailyFocus,
  nextFocusTarget,
  medianActiveBest,
  FOCUS_FLOOR_MINUTES,
  FOCUS_TARGET_CAP_MINUTES,
  type FocusPoint,
} from "./focus";

// Хелпер: точка через `min` минут от базы.
const BASE = 1_700_000_000;
function p(min: number, category: string, focus_score: number): FocusPoint {
  return { timestamp: BASE + min * 60, category, focus_score };
}

const opts = { interval: 2, threshold: 6 };

test("один качественный скрин = сессия в один интервал", () => {
  const sessions = computeFocusSessions([p(0, "code", 8)], opts);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].minutes, 2);
});

test("подряд идущие качественные скрины склеиваются в одну сессию", () => {
  const pts = [p(0, "code", 8), p(2, "code", 9), p(4, "research", 7), p(6, "code", 8)];
  const sessions = computeFocusSessions(pts, opts);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].count, 4);
  assert.equal(sessions[0].minutes, 8);
});

test("большой зазор (idle-дыра) рвёт сессию", () => {
  // зазор 30 мин > maxGap (max(6, 2*2.5)=6)
  const pts = [p(0, "code", 8), p(2, "code", 8), p(32, "code", 8), p(34, "code", 8)];
  const sessions = computeFocusSessions(pts, opts);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].minutes, 4);
  assert.equal(sessions[1].minutes, 4);
});

test("не-deep категория рвёт сессию", () => {
  const pts = [p(0, "code", 9), p(2, "social", 9), p(4, "code", 9)];
  const sessions = computeFocusSessions(pts, opts);
  assert.equal(sessions.length, 2);
});

test("низкий score рвёт сессию (учитывается threshold)", () => {
  const pts = [p(0, "code", 9), p(2, "code", 3), p(4, "code", 9)];
  const sessions = computeFocusSessions(pts, opts);
  assert.equal(sessions.length, 2);
});

test("точки не по порядку сортируются", () => {
  const pts = [p(4, "code", 8), p(0, "code", 8), p(2, "code", 8)];
  const sessions = computeFocusSessions(pts, opts);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].count, 3);
});

test("summarizeDailyFocus: лучшая сессия, сумма, разбивка по категориям", () => {
  const pts = [
    p(0, "code", 8),
    p(2, "code", 8),
    p(4, "research", 8),
    p(30, "social", 9), // не deep — не в зачёт
    p(60, "design", 9), // одинокий блок
  ];
  const s = summarizeDailyFocus(pts, opts);
  assert.equal(s.best_session_min, 6); // 3 скрина подряд
  assert.equal(s.deep_work_minutes, 8); // 4 качественных × 2
  assert.deepEqual(s.by_category, { code: 4, research: 2, design: 2 });
});

test("nextFocusTarget: пусто/мало → floor", () => {
  assert.equal(nextFocusTarget(0), FOCUS_FLOOR_MINUTES);
  assert.equal(nextFocusTarget(14), FOCUS_FLOOR_MINUTES);
});

test("nextFocusTarget: растёт ступенями по 5 над недавним лучшим", () => {
  assert.equal(nextFocusTarget(15), 20);
  assert.equal(nextFocusTarget(20), 25);
  assert.equal(nextFocusTarget(22), 30);
});

test("nextFocusTarget: не выше cap", () => {
  assert.equal(nextFocusTarget(10_000), FOCUS_TARGET_CAP_MINUTES);
});

test("medianActiveBest: медиана активных дней, robust к выбросам", () => {
  assert.equal(medianActiveBest([]), 0);
  assert.equal(medianActiveBest([0, 0]), 0); // дни без фокуса не считаются
  assert.equal(medianActiveBest([42]), 42);
  assert.equal(medianActiveBest([10, 30, 50]), 30);
  assert.equal(medianActiveBest([90, 25, 20, 0]), 25); // [20,25,90] → 25, пик 90 не задирает
  assert.equal(medianActiveBest([20, 40]), 30); // чётное → среднее двух средних
});
