import { test } from "node:test";
import assert from "node:assert/strict";
import { pearson, wowDelta, mondayOf, addDays, weekBounds, computeEffort } from "./weekly";
import { type FocusPoint } from "./focus";

test("pearson: идеальная положительная корреляция = 1", () => {
  const r = pearson([1, 2, 3, 4], [2, 4, 6, 8]);
  assert.ok(r !== null);
  assert.ok(Math.abs((r as number) - 1) < 1e-9);
});

test("pearson: идеальная отрицательная = -1", () => {
  const r = pearson([1, 2, 3], [3, 2, 1]);
  assert.ok(r !== null);
  assert.ok(Math.abs((r as number) + 1) < 1e-9);
});

test("pearson: n<2 → null", () => {
  assert.equal(pearson([1], [2]), null);
});

test("pearson: нулевая дисперсия → null", () => {
  assert.equal(pearson([5, 5, 5], [1, 2, 3]), null);
});

test("pearson: известное значение", () => {
  // x=[1,2,3,4,5], y=[2,4,5,4,5] → r ≈ 0.7745966
  const r = pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]);
  assert.ok(r !== null);
  assert.ok(Math.abs((r as number) - 0.7745966) < 1e-6);
});

test("wowDelta: рост +50%", () => {
  assert.equal(wowDelta(15, 10), 50);
});

test("wowDelta: падение -34%", () => {
  const d = wowDelta(23.7, 35.9);
  assert.ok(d !== null && d < 0);
});

test("wowDelta: база 0 → null", () => {
  assert.equal(wowDelta(5, 0), null);
});

test("addDays: пересечение месяца", () => {
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
});

test("mondayOf: воскресенье относится к своей неделе (пн раньше)", () => {
  // 2026-08-23 — воскресенье → понедельник той же недели 2026-08-17
  assert.equal(mondayOf("2026-08-23"), "2026-08-17");
});

test("mondayOf: понедельник = сам себе", () => {
  assert.equal(mondayOf("2026-08-17"), "2026-08-17");
});

test("weekBounds: пн..вс", () => {
  const b = weekBounds("2026-08-20"); // четверг
  assert.deepEqual(b, { start: "2026-08-17", end: "2026-08-23" });
});

function pt(category: string, focus_score = 8): FocusPoint {
  return { timestamp: 0, category, focus_score };
}

test("computeEffort: усилие = только deep-work категории", () => {
  const points = [pt("code"), pt("research"), pt("social"), pt("communication"), pt("video")];
  const r = computeEffort(points, 2);
  assert.equal(r.active_min, 10); // 5 точек * 2
  assert.equal(r.effort_min, 4); // code+research (communication НЕ deep-work)
  assert.equal(r.focus_pct, 40);
  assert.equal(r.by_category.code, 2);
  assert.equal(r.by_category.communication, 2);
});

test("computeEffort: пусто → 0, без деления на ноль", () => {
  const r = computeEffort([], 2);
  assert.equal(r.active_min, 0);
  assert.equal(r.effort_min, 0);
  assert.equal(r.focus_pct, 0);
});
