import type { Category, LogEntry } from "@/api";

export const SCREENSHOT_INTERVAL_MIN = 5;

export interface Segment {
  start: Date;
  end: Date;
  category: Category;
  avg_score: number;
  count: number;
  summary: string;
  /** Уникальные категории по порядку появления (для tooltip при слиянии). */
  categories: Category[];
}

export interface LayoutSegment extends Segment {
  column: number;
  columns: number;
}

interface SegmentBuilder {
  start: Date;
  end: Date;
  category: Category;
  avg_score: number;
  count: number;
  summary: string;
  categories: Category[];
  categoryCounts: Map<Category, number>;
}

function appendCategoryFlow(flow: Category[], category: Category): Category[] {
  if (flow.length === 0 || flow[flow.length - 1] !== category) {
    return [...flow, category];
  }
  return flow;
}

function dominantCategory(counts: Map<Category, number>, tieBreak: Category): Category {
  let best = tieBreak;
  let bestCount = 0;
  for (const [cat, n] of counts) {
    if (n > bestCount) {
      bestCount = n;
      best = cat;
    }
  }
  return best;
}

function builderToSegment(b: SegmentBuilder): Segment {
  return {
    start: b.start,
    end: b.end,
    category: dominantCategory(b.categoryCounts, b.category),
    avg_score: b.avg_score,
    count: b.count,
    summary: b.summary,
    categories: b.categories,
  };
}

function newBuilder(entry: LogEntry, gapMs: number): SegmentBuilder {
  const t = new Date(entry.datetime);
  const cat = entry.category;
  const counts = new Map<Category, number>([[cat, 1]]);
  return {
    start: t,
    end: new Date(t.getTime() + gapMs),
    category: cat,
    avg_score: entry.score,
    count: 1,
    summary: entry.summary,
    categories: [cat],
    categoryCounts: counts,
  };
}

function mergeEntryIntoBuilder(b: SegmentBuilder, entry: LogEntry, gapMs: number): void {
  const t = new Date(entry.datetime);
  const cat = entry.category;
  b.end = new Date(t.getTime() + gapMs);
  b.avg_score = (b.avg_score * b.count + entry.score) / (b.count + 1);
  b.count++;
  b.category = cat;
  b.categoryCounts.set(cat, (b.categoryCounts.get(cat) ?? 0) + 1);
  b.categories = appendCategoryFlow(b.categories, cat);
  if (entry.summary.trim()) {
    b.summary = entry.summary;
  }
}

/** Объединяет подряд идущие записи с паузой ≤ интервала скриншота (любые категории). */
export function groupIntoSegments(entries: LogEntry[]): Segment[] {
  if (entries.length === 0) return [];
  const sorted = [...entries].sort(
    (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime(),
  );
  const gapMs = SCREENSHOT_INTERVAL_MIN * 60_000;
  const segments: Segment[] = [];
  let cur = newBuilder(sorted[0], gapMs);

  for (let i = 1; i < sorted.length; i++) {
    const e = sorted[i];
    const t = new Date(e.datetime).getTime();
    const gap = t - cur.end.getTime();
    if (gap <= gapMs) {
      mergeEntryIntoBuilder(cur, e, gapMs);
    } else {
      segments.push(builderToSegment(cur));
      cur = newBuilder(e, gapMs);
    }
  }
  segments.push(builderToSegment(cur));
  return segments;
}

function segmentsOverlap(a: Segment, b: Segment): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/** Раскладка пересекающихся сегментов по колонкам (как в Google Calendar). */
export function assignSegmentColumns(segments: Segment[]): LayoutSegment[] {
  if (segments.length === 0) return [];

  const sorted = [...segments].sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      a.end.getTime() - b.end.getTime(),
  );

  const columnEnds: number[] = [];
  const columnIndex: number[] = [];

  for (const seg of sorted) {
    const start = seg.start.getTime();
    let col = 0;
    while (col < columnEnds.length && columnEnds[col] > start) {
      col++;
    }
    if (col >= columnEnds.length) {
      columnEnds.push(seg.end.getTime());
    } else {
      columnEnds[col] = seg.end.getTime();
    }
    columnIndex.push(col);
  }

  const n = sorted.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  };

  const union = (i: number, j: number): void => {
    const pi = find(i);
    const pj = find(j);
    if (pi !== pj) parent[pi] = pj;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (segmentsOverlap(sorted[i], sorted[j])) {
        union(i, j);
      }
    }
  }

  const clusterWidth = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    clusterWidth.set(root, Math.max(clusterWidth.get(root) ?? 0, columnIndex[i] + 1));
  }

  return sorted.map((seg, i) => ({
    ...seg,
    column: columnIndex[i],
    columns: clusterWidth.get(find(i)) ?? 1,
  }));
}

export function prepareDayLayout(entries: LogEntry[]): LayoutSegment[] {
  return assignSegmentColumns(groupIntoSegments(entries));
}
