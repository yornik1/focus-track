import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHabitGridWeeks,
  applyOptimisticHabitUpdate,
  formatHabitDateLabel,
  getHabitCell,
  moveHabitId,
  toKievDateKey,
  upsertHabitCell,
  type HabitCell,
} from "./habit-grid.ts";

function cell(date: string, done = true, source: HabitCell["source"] = "manual"): HabitCell {
  return {
    date,
    habit: "walk",
    done,
    source,
    updated_at: "2026-03-31T12:00:00.000Z",
  };
}

test("toKievDateKey returns the Europe/Kiev calendar day for an absolute instant", () => {
  assert.equal(toKievDateKey(new Date("2026-03-28T22:30:00.000Z")), "2026-03-29");
});

test("formatHabitDateLabel keeps the civil date in Europe/Kiev", () => {
  assert.equal(formatHabitDateLabel("2026-03-09", "en-US"), "Mar 9");
});

test("buildHabitGridWeeks returns current Monday-Sunday week plus three previous weeks across DST", () => {
  const weeks = buildHabitGridWeeks(new Date("2026-04-01T09:00:00.000Z"));
  assert.deepEqual(
    weeks.map((week) => week.days.map((day) => day.date)),
    [
      ["2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13", "2026-03-14", "2026-03-15"],
      ["2026-03-16", "2026-03-17", "2026-03-18", "2026-03-19", "2026-03-20", "2026-03-21", "2026-03-22"],
      ["2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29"],
      ["2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-05"],
    ],
  );
});

test("buildHabitGridWeeks marks today and only later Kyiv dates as future", () => {
  const flat = buildHabitGridWeeks(new Date("2026-04-01T17:30:00.000Z")).flatMap((week) => week.days);
  assert.equal(flat.find((day) => day.date === "2026-04-01")?.isToday, true);
  assert.equal(flat.find((day) => day.date === "2026-04-01")?.isFuture, false);
  assert.equal(flat.find((day) => day.date === "2026-04-02")?.isFuture, true);
  assert.equal(flat.find((day) => day.date === "2026-03-31")?.isFuture, false);
});

test("getHabitCell returns the matching sparse cell and undefined for an empty date", () => {
  const entries = [cell("2026-03-31")];
  assert.equal(getHabitCell(entries, "walk", "2026-03-31")?.done, true);
  assert.equal(getHabitCell(entries, "walk", "2026-04-01"), undefined);
});

test("upsertHabitCell updates one composite key without mutating the original list", () => {
  const original = [cell("2026-03-31"), cell("2026-04-01", false, "auto")];
  const replacement = cell("2026-04-01", true, "manual");
  const updated = upsertHabitCell(original, replacement);

  assert.equal(original[1].done, false);
  assert.deepEqual(updated, [cell("2026-03-31"), replacement]);
  assert.notEqual(updated, original);
});

test("upsertHabitCell appends a previously absent sparse cell", () => {
  const original = [cell("2026-03-31")];
  const inserted = cell("2026-04-01", false);
  assert.deepEqual(upsertHabitCell(original, inserted), [cell("2026-03-31"), inserted]);
});

test("applyOptimisticHabitUpdate keeps an immutable rollback snapshot", () => {
  const previous = [cell("2026-04-01", false, "auto")];
  const optimistic = applyOptimisticHabitUpdate(
    previous,
    { date: "2026-04-01", habit: "walk", done: true },
    "2026-04-01T12:30:00.000Z",
  );

  assert.deepEqual(previous, [cell("2026-04-01", false, "auto")]);
  assert.deepEqual(optimistic, [{
    date: "2026-04-01",
    habit: "walk",
    done: true,
    source: "manual",
    updated_at: "2026-04-01T12:30:00.000Z",
  }]);
  assert.deepEqual(previous, [cell("2026-04-01", false, "auto")]);
});

test("moveHabitId inserts before or after a drop target without mutating the original order", () => {
  const original = ["meditation", "english", "walk", "node"];

  assert.deepEqual(
    moveHabitId(original, "node", "english", "before"),
    ["meditation", "node", "english", "walk"],
  );
  assert.deepEqual(
    moveHabitId(original, "meditation", "walk", "after"),
    ["english", "walk", "meditation", "node"],
  );
  assert.deepEqual(original, ["meditation", "english", "walk", "node"]);
});

test("moveHabitId treats invalid and same-position drops as no-ops", () => {
  const original = ["meditation", "english", "walk"];

  assert.equal(moveHabitId(original, "missing", "walk", "before"), original);
  assert.equal(moveHabitId(original, "walk", "missing", "after"), original);
  assert.equal(moveHabitId(original, "english", "english", "before"), original);
  assert.equal(moveHabitId(original, "meditation", "english", "before"), original);
});
