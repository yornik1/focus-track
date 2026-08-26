import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGarminDaily } from "./garmin-parse";

const FIXTURE = `---
tags: [activity, garmin]
created: 2026-08-25
agent: garmin-import
---

# Activity 2026-08-25

## Daily (garmin_daily)
\`\`\`json
[{"date":"2026-08-25","steps":6503,"sleep_minutes":431,"resting_hr":44,"avg_hr":66}]
\`\`\`

## Workouts (garmin_activities)
\`\`\`json
[{"activity_type":"walking","duration_min":30.1}]
\`\`\`
`;

test("parseGarminDaily: достаёт steps/sleep/resting_hr", () => {
  const row = parseGarminDaily(FIXTURE);
  assert.deepEqual(row, {
    date: "2026-08-25",
    steps: 6503,
    sleep_minutes: 431,
    resting_hr: 44,
  });
});

test("parseGarminDaily: нет блока → null", () => {
  assert.equal(parseGarminDaily("# Пустой файл\nбез данных"), null);
});

test("parseGarminDaily: битый JSON → null", () => {
  assert.equal(parseGarminDaily("garmin_daily)\n```json\n[{oops]\n```"), null);
});

test("parseGarminDaily: отсутствующие числа → null-поля", () => {
  const row = parseGarminDaily('garmin_daily)\n```json\n[{"date":"2026-01-02"}]\n```');
  assert.deepEqual(row, { date: "2026-01-02", steps: null, sleep_minutes: null, resting_hr: null });
});
