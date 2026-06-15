/**
 * Чистые хелперы аналитики фокуса: непрерывные сессии, дневная сводка,
 * адаптивная цель. Без зависимостей от БД — вход это массив «точек» (скринов).
 */

/** Категории «глубокой работы» — ядро Deep Work и стрика (без communication). */
export const DEEP_WORK_CATEGORIES = [
  "code",
  "research",
  "design",
  "writing",
] as const;

export type DeepWorkCategory = (typeof DEEP_WORK_CATEGORIES)[number];

const DEEP_WORK_SET = new Set<string>(DEEP_WORK_CATEGORIES);

export function isDeepWorkCategory(category: string): boolean {
  return DEEP_WORK_SET.has(category);
}

/** Базовый порог: один непрерывный блок ≥ 15 мин держит стрик. */
export const FOCUS_FLOOR_MINUTES = 15;

/** Верхняя граница адаптивной цели. */
export const FOCUS_TARGET_CAP_MINUTES = 180;

/** Точка наблюдения — один скриншот. */
export interface FocusPoint {
  timestamp: number; // unix-секунды
  category: string;
  focus_score: number;
}

export interface FocusSessionOptions {
  interval: number; // минут на скрин (прокси)
  threshold: number; // focus_score >= threshold считается фокусом
  maxGap?: number; // максимум минут между скринами внутри одной сессии
}

export interface FocusSession {
  start: number; // ts первого скрина
  end: number; // ts последнего скрина
  count: number; // число качественных скринов
  minutes: number; // count * interval
}

export interface DailyFocusSummary {
  best_session_min: number;
  deep_work_minutes: number;
  by_category: Record<string, number>;
}

function isQualityPoint(p: FocusPoint, threshold: number): boolean {
  return isDeepWorkCategory(p.category) && p.focus_score >= threshold;
}

function resolveMaxGap(interval: number, maxGap?: number): number {
  if (typeof maxGap === "number" && maxGap > 0) return maxGap;
  // Терпим один пропущенный/пограничный скрин, но не idle-дыру
  return Math.max(6, interval * 2.5);
}

/**
 * Собирает непрерывные focus-сессии за один день.
 * Точки могут идти в любом порядке — сортируем по времени.
 * Сессию рвёт: не-качественный скрин ИЛИ зазор > maxGap (в т.ч. idle-дыра).
 */
export function computeFocusSessions(points: FocusPoint[], opts: FocusSessionOptions): FocusSession[] {
  const { interval, threshold } = opts;
  const maxGapSec = resolveMaxGap(interval, opts.maxGap) * 60;

  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const sessions: FocusSession[] = [];
  let cur: FocusSession | null = null;

  for (const p of sorted) {
    if (!isQualityPoint(p, threshold)) {
      cur = null; // не-качественный скрин рвёт сессию
      continue;
    }
    if (cur && p.timestamp - cur.end <= maxGapSec) {
      cur.end = p.timestamp;
      cur.count += 1;
      cur.minutes = cur.count * interval;
    } else {
      cur = { start: p.timestamp, end: p.timestamp, count: 1, minutes: interval };
      sessions.push(cur);
    }
  }
  return sessions;
}

/** Сводка по одному дню: лучшая сессия, сумма deep-work минут, разбивка по категориям. */
export function summarizeDailyFocus(points: FocusPoint[], opts: FocusSessionOptions): DailyFocusSummary {
  const sessions = computeFocusSessions(points, opts);
  const best_session_min = sessions.reduce((m, s) => Math.max(m, s.minutes), 0);

  let deep_work_minutes = 0;
  const by_category: Record<string, number> = {};
  for (const p of points) {
    if (!isQualityPoint(p, opts.threshold)) continue;
    deep_work_minutes += opts.interval;
    by_category[p.category] = (by_category[p.category] ?? 0) + opts.interval;
  }

  return { best_session_min, deep_work_minutes, by_category };
}

function roundUp5(n: number): number {
  return Math.ceil(n / 5) * 5;
}

/**
 * Адаптивная дневная цель от ТИПИЧНОГО недавнего блока.
 * Стоит на одну ступень (5 мин) выше типичного, не ниже floor, не выше cap.
 * Привязка к медиане (а не к пику) делает рост мягким: планка следует за тем,
 * что ты обычно делаешь, и поднимается лишь когда растёт типичный уровень —
 * «без насилия», без погони за рекордом.
 */
export function nextFocusTarget(typicalBestMin: number): number {
  if (!Number.isFinite(typicalBestMin) || typicalBestMin < FOCUS_FLOOR_MINUTES) {
    return FOCUS_FLOOR_MINUTES;
  }
  const stretched = roundUp5(typicalBestMin + 5);
  return Math.min(FOCUS_TARGET_CAP_MINUTES, Math.max(FOCUS_FLOOR_MINUTES, stretched));
}

/**
 * Типичный недавний блок: медиана лучших сессий по активным дням
 * (дни без фокуса не учитываются). Устойчиво к выбросам, отражает «обычный»
 * уровень, а не пик. 0, если активных дней нет.
 */
export function medianActiveBest(bestPerDay: number[]): number {
  const active = bestPerDay.filter((v) => v > 0).sort((a, b) => a - b);
  if (active.length === 0) return 0;
  const mid = Math.floor(active.length / 2);
  return active.length % 2 ? active[mid] : (active[mid - 1] + active[mid]) / 2;
}
