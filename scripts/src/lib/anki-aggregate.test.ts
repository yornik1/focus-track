import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateRevlog, localDate, type RevlogRow } from "./anki-aggregate";

test("aggregateRevlog: считает reviews и секунды по дням", () => {
  const day = new Date(2026, 7, 20, 10, 0, 0).getTime(); // 2026-08-20 локально
  const rows: RevlogRow[] = [
    { id: day, time: 3000 },
    { id: day + 60_000, time: 1500 },
    { id: day + 86_400_000, time: 2000 }, // следующий день
  ];
  const agg = aggregateRevlog(rows);
  const d0 = localDate(day);
  const d1 = localDate(day + 86_400_000);

  assert.equal(agg.get(d0)?.reviews, 2);
  assert.equal(agg.get(d0)?.seconds, 5); // round(3000/1000)+round(1500/1000)=3+2
  assert.equal(agg.get(d1)?.reviews, 1);
  assert.equal(agg.get(d1)?.seconds, 2);
});

test("aggregateRevlog: пусто → пустая карта", () => {
  assert.equal(aggregateRevlog([]).size, 0);
});
