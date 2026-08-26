/** Чистые хелперы форматирования для страницы Weekly Mirror. */

export type DeltaDir = "up" | "down" | "flat";

/** Направление недельной дельты. null/0 → flat. */
export function deltaDir(pct: number | null): DeltaDir {
  if (pct === null || pct === 0) return "flat";
  return pct > 0 ? "up" : "down";
}

/** Подпись дельты: «+50%», «-35%», «—» если базы нет. */
export function formatDelta(pct: number | null): string {
  if (pct === null) return "—";
  const rounded = Math.round(pct);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

/** Разряды тысяч пробелом: 4947 → «4 947». */
export function groupThousands(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Навигация недель: сдвиг понедельника на ±N недель (арифметика в UTC). */
export function shiftWeek(mondayIso: string, weeks: number): string {
  const [y, m, d] = mondayIso.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + weeks * 7));
  return next.toISOString().slice(0, 10);
}

// --- Scatter (сон/anki ↔ усилие) ------------------------------------------

export interface DailyPoint {
  date: string;
  effort_h: number;
  sleep_h: number | null;
  steps: number | null;
  anki_reviews: number;
}

export type ScatterMode = "day" | "lag" | "week";
export type ScatterAxis = "sleep" | "anki";

export interface ScatterPointXY {
  x: number;
  y: number;
  label: string;
}

export interface ScatterResult {
  points: ScatterPointXY[];
  pearson_r: number | null;
  n: number;
}

/** Коэффициент Пирсона; null при n<2 или нулевой дисперсии. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

function mondayKey(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const shift = dow === 0 ? -6 : 1 - dow;
  return new Date(Date.UTC(y, m - 1, d + shift)).toISOString().slice(0, 10);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Строит облако точек «ось X ↔ усилие» из дневного ряда.
 * mode: day = X и усилие одного дня; lag = X прошлого дня → усилие следующего
 * (ловит «выспался → продуктивнее завтра»); week = недельные агрегаты.
 * axis: sleep (часы сна) или anki (число повторений).
 */
export function buildScatter(series: DailyPoint[], mode: ScatterMode, axis: ScatterAxis): ScatterResult {
  const xOf = (p: DailyPoint): number | null => (axis === "sleep" ? p.sleep_h : p.anki_reviews);
  const points: ScatterPointXY[] = [];

  if (mode === "week") {
    const byWeek = new Map<string, { effort: number; sleep: number[]; anki: number }>();
    for (const p of series) {
      const k = mondayKey(p.date);
      const acc = byWeek.get(k) ?? { effort: 0, sleep: [], anki: 0 };
      acc.effort += p.effort_h;
      if (p.sleep_h !== null) acc.sleep.push(p.sleep_h);
      acc.anki += p.anki_reviews;
      byWeek.set(k, acc);
    }
    for (const [k, acc] of byWeek) {
      const x =
        axis === "sleep"
          ? acc.sleep.length
            ? acc.sleep.reduce((s, v) => s + v, 0) / acc.sleep.length
            : null
          : acc.anki;
      if (x === null) continue;
      points.push({ x: r1(x), y: r1(acc.effort), label: k });
    }
  } else if (mode === "lag") {
    for (let i = 1; i < series.length; i++) {
      const x = xOf(series[i - 1]);
      if (x === null) continue;
      points.push({ x, y: series[i].effort_h, label: series[i].date });
    }
  } else {
    for (const p of series) {
      const x = xOf(p);
      if (x === null) continue;
      points.push({ x, y: p.effort_h, label: p.date });
    }
  }

  const r = pearson(
    points.map((p) => p.x),
    points.map((p) => p.y),
  );
  return { points, pearson_r: r === null ? null : r2(r), n: points.length };
}
