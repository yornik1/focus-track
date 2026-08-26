/**
 * Чистые хелперы недельной сводки («Зеркало недели»). Без БД.
 * Усилие = время в DEEP_WORK-категориях (код+ресёрч+письмо+дизайн), как в артефакте.
 * Активное = всё время за ноутом (все скрины). Фокус = усилие / активное.
 */
import { type FocusPoint, isDeepWorkCategory } from "./focus";

/** Коэффициент корреляции Пирсона. null при n<2 или нулевой дисперсии. */
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

/** Процент изменения неделя-к-неделе. null, если базы нет (prev 0 / не число). */
export function wowDelta(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

/** date-строка YYYY-MM-DD + n дней (арифметика в UTC, без TZ-сдвигов). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

/** Понедельник той недели, в которую попадает дата (ISO: неделя начинается с пн). */
export function mondayOf(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay(); // 0=вс..6=сб
  const shift = dow === 0 ? -6 : 1 - dow; // к понедельнику
  return addDays(date, shift);
}

export interface WeekBounds {
  start: string; // понедельник YYYY-MM-DD
  end: string; // воскресенье YYYY-MM-DD
}

/** Границы недели по любой дате внутри неё (пн..вс). */
export function weekBounds(dateInWeek: string): WeekBounds {
  const start = mondayOf(dateInWeek);
  return { start, end: addDays(start, 6) };
}

export interface WeeklyEffort {
  effort_min: number; // время в DEEP_WORK-категориях
  active_min: number; // всё время за ноутом
  focus_pct: number; // усилие / активное * 100 (0 при active 0)
  by_category: Record<string, number>; // минуты по каждой категории
}

/**
 * Считает усилие/активное/фокус и разбивку по категориям для набора точек.
 * interval — минут на один скрин (прокси времени).
 */
export function computeEffort(points: FocusPoint[], interval: number): WeeklyEffort {
  let effort_min = 0;
  const active_min = points.length * interval;
  const by_category: Record<string, number> = {};

  for (const p of points) {
    by_category[p.category] = (by_category[p.category] ?? 0) + interval;
    if (isDeepWorkCategory(p.category)) effort_min += interval;
  }

  const focus_pct = active_min > 0 ? (effort_min / active_min) * 100 : 0;
  return { effort_min, active_min, focus_pct, by_category };
}
