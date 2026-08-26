import { test } from "node:test";
import assert from "node:assert/strict";
import { deltaDir, formatDelta, groupThousands, shiftWeek, buildScatter, pearson, type DailyPoint } from "./week-format";

test("deltaDir: знак и flat", () => {
  assert.equal(deltaDir(12), "up");
  assert.equal(deltaDir(-5), "down");
  assert.equal(deltaDir(0), "flat");
  assert.equal(deltaDir(null), "flat");
});

test("formatDelta: подпись со знаком", () => {
  assert.equal(formatDelta(50.4), "+50%");
  assert.equal(formatDelta(-35), "-35%");
  assert.equal(formatDelta(null), "—");
});

test("groupThousands: пробел в разрядах", () => {
  assert.equal(groupThousands(4947), "4 947");
  assert.equal(groupThousands(10137), "10 137");
  assert.equal(groupThousands(232), "232");
});

test("shiftWeek: сдвиг на неделю через границу месяца", () => {
  assert.equal(shiftWeek("2026-08-31", -1), "2026-08-24");
  assert.equal(shiftWeek("2026-08-17", 1), "2026-08-24");
});

const SERIES: DailyPoint[] = [
  { date: "2026-08-17", effort_h: 2, sleep_h: 6, steps: 5000, anki_reviews: 50 },
  { date: "2026-08-18", effort_h: 4, sleep_h: 8, steps: 8000, anki_reviews: 20 },
  { date: "2026-08-19", effort_h: 1, sleep_h: null, steps: null, anki_reviews: 0 },
  { date: "2026-08-20", effort_h: 5, sleep_h: 7, steps: 9000, anki_reviews: 80 },
];

test("buildScatter day/sleep: пропускает дни без сна", () => {
  const r = buildScatter(SERIES, "day", "sleep");
  assert.equal(r.n, 3); // 19-е без сна выпадает
  assert.deepEqual(
    r.points.map((p) => p.x),
    [6, 8, 7],
  );
});

test("buildScatter lag: X прошлого дня → усилие следующего", () => {
  const r = buildScatter(SERIES, "lag", "sleep");
  // пары: (17→18):x6,y4; (18→19):x8,y1; (19→20): у 19 сон null → выпадает
  assert.equal(r.n, 2);
  assert.deepEqual(r.points[0], { x: 6, y: 4, label: "2026-08-18" });
});

test("buildScatter week: агрегирует по неделе", () => {
  const r = buildScatter(SERIES, "week", "sleep");
  assert.equal(r.n, 1); // все в одной неделе
  assert.equal(r.points[0].y, 12); // сумма усилия 2+4+1+5
});

test("buildScatter anki axis: 0 повторений не выпадает", () => {
  const r = buildScatter(SERIES, "day", "anki");
  assert.equal(r.n, 4);
});

test("pearson (client): идеальная корреляция", () => {
  assert.ok(Math.abs((pearson([1, 2, 3], [2, 4, 6]) as number) - 1) < 1e-9);
});
