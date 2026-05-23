import assert from "node:assert/strict";
import test from "node:test";
import type { LogEntry } from "@/api";
import {
  assignSegmentColumns,
  groupIntoSegments,
  type Segment,
} from "./calendar-layout.ts";

function entry(id: string, iso: string, category: string, score = 7): LogEntry {
  return { id, datetime: iso, category, score, summary: `${category} work` };
}

function seg(
  start: string,
  end: string,
  category: string,
  categories: string[] = [category],
): Segment {
  return {
    start: new Date(start),
    end: new Date(end),
    category,
    avg_score: 7,
    count: 1,
    summary: "test",
    categories,
  };
}

test("groupIntoSegments: соседние разные категории с паузой 3 мин → один сегмент", () => {
  const merged = groupIntoSegments([
    entry("1", "2025-05-20T10:00:00", "code"),
    entry("2", "2025-05-20T10:03:00", "research"),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].count, 2);
  assert.deepEqual(merged[0].categories, ["code", "research"]);
  assert.equal(merged[0].category, "code");
});

test("groupIntoSegments: пауза > 5 мин между концом блока и следующей записью → два сегмента", () => {
  const merged = groupIntoSegments([
    entry("1", "2025-05-20T10:00:00", "code"),
    entry("2", "2025-05-20T10:11:00", "research"),
  ]);
  assert.equal(merged.length, 2);
});

test("assignSegmentColumns: два непересекающихся → колонка 0, columns 1", () => {
  const layout = assignSegmentColumns([
    seg("2025-05-20T09:00:00", "2025-05-20T10:00:00", "code"),
    seg("2025-05-20T11:00:00", "2025-05-20T12:00:00", "research"),
  ]);
  assert.equal(layout.length, 2);
  assert.equal(layout[0].column, 0);
  assert.equal(layout[1].column, 0);
  assert.equal(layout[0].columns, 1);
  assert.equal(layout[1].columns, 1);
});

test("assignSegmentColumns: три пересекающихся → 3 колонки в кластере", () => {
  const layout = assignSegmentColumns([
    seg("2025-05-20T10:00:00", "2025-05-20T11:00:00", "code"),
    seg("2025-05-20T10:15:00", "2025-05-20T11:15:00", "research"),
    seg("2025-05-20T10:30:00", "2025-05-20T11:30:00", "social"),
  ]);
  const cols = new Set(layout.map((s) => s.column));
  assert.equal(cols.size, 3);
  assert.ok(layout.every((s) => s.columns === 3));
});

test("assignSegmentColumns: цепочка A-B, B-C → columns кластера 2", () => {
  const layout = assignSegmentColumns([
    seg("2025-05-20T09:00:00", "2025-05-20T10:00:00", "code"),
    seg("2025-05-20T09:30:00", "2025-05-20T10:30:00", "research"),
    seg("2025-05-20T10:00:00", "2025-05-20T11:00:00", "social"),
  ]);
  assert.ok(layout.every((s) => s.columns === 2));
});
