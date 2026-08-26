import { Router } from "express";
import { and, gte, lte } from "drizzle-orm";
import {
  db,
  focusLogTable,
  garminDailyTable,
  ankiDailyTable,
  readAppSettings,
  getDefaultAppSettings,
  isDeepWorkCategory,
  computeEffort,
  wowDelta,
  mondayOf,
  addDaysStr,
  type FocusPoint,
} from "@workspace/db";

const WEEKS_HISTORY = 14; // сколько недель показываем в баре «усилие по неделям»
const SCATTER_DAYS = 98; // окно дневного ряда для скаттера (день/лаг/неделя)

type CategoryKind = "productive" | "neutral" | "distracting";

function categoryKind(category: string): CategoryKind {
  if (isDeepWorkCategory(category)) return "productive";
  if (category === "communication") return "neutral";
  return "distracting";
}

function localDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function kievToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kiev",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Целых дней от a до b (обе YYYY-MM-DD, арифметика в UTC). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** «17 Aug – 23 Aug» */
function weekLabel(start: string, end: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(y, m - 1, d)),
    );
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Аббревиатура дня недели по дате (Mon..Sun). */
function dowLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

type WeeklyInput = { start?: unknown };

interface Metric {
  value: number;
  delta_pct: number | null;
  source?: "garmin";
}

interface ByDay {
  date: string;
  dow: string;
  effort_h: number;
  active_h: number;
  focus_pct: number;
  focus_score: number | null;
  anki_reviews: number;
  steps: number | null;
  sleep_h: number | null;
}

interface CategoryHours {
  category: string;
  hours: number;
  kind: CategoryKind;
}

export interface DailySeriesPoint {
  date: string;
  effort_h: number;
  sleep_h: number | null;
  steps: number | null;
  anki_reviews: number;
}

export interface WeeklyStatsResponse {
  week: { start: string; end: string; label: string; is_current: boolean; is_partial: boolean; elapsed_days: number };
  cards: {
    effort_h_per_day: Metric;
    effort_total_h: Metric;
    active_h: Metric;
    focus_leak_h: Metric;
    focus_pct: Metric;
    focus_score: Metric;
    anki_reviews: Metric;
    anki_minutes: Metric;
    steps_per_day: Metric;
    sleep_avg_h: Metric;
  };
  weekly_effort_history: { week_start: string; effort_h_per_day: number; is_current: boolean }[];
  by_day: ByDay[];
  categories: CategoryHours[];
  daily_series: DailySeriesPoint[];
  coverage: { days_with_data: number };
}

/** Сырые суммы за одну неделю — база для карточек и WoW-дельт. */
interface WeekSums {
  effort_min: number;
  active_min: number;
  scores: number[];
  anki_reviews: number;
  anki_seconds: number;
  steps: number[]; // только дни с данными Garmin
  sleep_min: number[]; // только дни с данными Garmin
  days_with_focus: number;
}

export async function computeWeeklyStats(input: WeeklyInput): Promise<WeeklyStatsResponse> {
  const settings = readAppSettings() ?? getDefaultAppSettings();
  const interval = settings.screenshot_interval ?? 2;

  const today = kievToday();
  const currentMonday = mondayOf(today);
  // По умолчанию открываем последнюю ЗАВЕРШЁННУЮ неделю — цифры всегда полные,
  // а не «−81%» на неделе, которая ещё не прожита. Текущая доступна стрелкой ›.
  const startRaw =
    typeof input.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.start)
      ? input.start
      : addDaysStr(currentMonday, -7);
  const weekStart = mondayOf(startRaw);
  const weekEnd = addDaysStr(weekStart, 6);
  const isCurrent = currentMonday === weekStart;
  // Сколько дней недели уже прожито (для текущей — Пн..сегодня; для прошлых — все 7).
  const elapsedDays = isCurrent ? Math.min(7, Math.max(1, daysBetween(weekStart, today) + 1)) : 7;
  const isPartial = isCurrent && elapsedDays < 7;

  // Окно данных: с запасом для истории по неделям и скаттера.
  const historyStart = addDaysStr(weekStart, -(WEEKS_HISTORY - 1) * 7);
  const scatterStart = addDaysStr(weekEnd, -(SCATTER_DAYS - 1));
  const windowStart = historyStart < scatterStart ? historyStart : scatterStart;

  const startTs = Math.floor(new Date(`${windowStart}T00:00:00`).getTime() / 1000);
  const endTs = Math.floor(new Date(`${weekEnd}T23:59:59`).getTime() / 1000);

  const [focusRows, garminRows, ankiRows] = await Promise.all([
    db
      .select()
      .from(focusLogTable)
      .where(and(gte(focusLogTable.timestamp, startTs), lte(focusLogTable.timestamp, endTs))),
    db
      .select()
      .from(garminDailyTable)
      .where(and(gte(garminDailyTable.date, windowStart), lte(garminDailyTable.date, weekEnd))),
    db
      .select()
      .from(ankiDailyTable)
      .where(and(gte(ankiDailyTable.date, windowStart), lte(ankiDailyTable.date, weekEnd))),
  ]);

  // Группировка по локальной дате.
  const pointsByDate = new Map<string, FocusPoint[]>();
  const scoresByDate = new Map<string, number[]>();
  for (const row of focusRows) {
    const date = localDateStr(new Date(row.timestamp * 1000));
    if (!pointsByDate.has(date)) pointsByDate.set(date, []);
    pointsByDate.get(date)!.push({ timestamp: row.timestamp, category: row.category, focus_score: row.focus_score });
    if (!scoresByDate.has(date)) scoresByDate.set(date, []);
    scoresByDate.get(date)!.push(row.focus_score);
  }

  const garminByDate = new Map<string, { steps: number | null; sleep_minutes: number | null }>();
  for (const row of garminRows) {
    garminByDate.set(row.date, { steps: row.steps, sleep_minutes: row.sleep_minutes });
  }
  const ankiByDate = new Map<string, { reviews: number; seconds: number }>();
  for (const row of ankiRows) {
    ankiByDate.set(row.date, { reviews: row.reviews, seconds: row.seconds });
  }

  // Дневное усилие (минуты deep-work) — общий кэш для скаттера и карточек.
  const effortMinByDate = new Map<string, number>();
  function dayEffortMin(date: string): number {
    let v = effortMinByDate.get(date);
    if (v === undefined) {
      v = computeEffort(pointsByDate.get(date) ?? [], interval).effort_min;
      effortMinByDate.set(date, v);
    }
    return v;
  }

  function sumsForWeek(startDate: string, days = 7): WeekSums {
    const s: WeekSums = {
      effort_min: 0,
      active_min: 0,
      scores: [],
      anki_reviews: 0,
      anki_seconds: 0,
      steps: [],
      sleep_min: [],
      days_with_focus: 0,
    };
    for (let i = 0; i < days; i++) {
      const date = addDaysStr(startDate, i);
      const points = pointsByDate.get(date);
      if (points && points.length > 0) {
        const e = computeEffort(points, interval);
        s.effort_min += e.effort_min;
        s.active_min += e.active_min;
        s.days_with_focus += 1;
      }
      const scores = scoresByDate.get(date);
      if (scores) s.scores.push(...scores);
      const anki = ankiByDate.get(date);
      if (anki) {
        s.anki_reviews += anki.reviews;
        s.anki_seconds += anki.seconds;
      }
      const garmin = garminByDate.get(date);
      if (garmin) {
        if (typeof garmin.steps === "number") s.steps.push(garmin.steps);
        if (typeof garmin.sleep_minutes === "number") s.sleep_min.push(garmin.sleep_minutes);
      }
    }
    return s;
  }

  const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  // Полные суммы недели → значения карточек.
  const cur = sumsForWeek(weekStart, 7);
  const prevStart = addDaysStr(weekStart, -7);
  // Дельты сравниваем сопоставимый отрезок: Пн..сегодня vs Пн..тот же день недели неделей раньше.
  // Для завершённой недели elapsedDays=7, т.е. полная неделя против полной.
  const curP = elapsedDays === 7 ? cur : sumsForWeek(weekStart, elapsedDays);
  const prevP = sumsForWeek(prevStart, elapsedDays);

  const hours = (min: number) => min / 60;
  const leakMin = (s: WeekSums) => s.active_min - s.effort_min;

  const curEffortH = hours(cur.effort_min);
  const curActiveH = hours(cur.active_min);

  const cards: WeeklyStatsResponse["cards"] = {
    // На незавершённой неделе делим на прожитые дни, а не на 7 — иначе средняя занижена.
    effort_h_per_day: {
      value: round1(curEffortH / elapsedDays),
      delta_pct: wowDelta(hours(curP.effort_min) / elapsedDays, hours(prevP.effort_min) / elapsedDays),
    },
    effort_total_h: { value: round1(curEffortH), delta_pct: wowDelta(curP.effort_min, prevP.effort_min) },
    active_h: { value: round1(curActiveH), delta_pct: wowDelta(curP.active_min, prevP.active_min) },
    focus_leak_h: { value: round1(hours(leakMin(cur))), delta_pct: wowDelta(leakMin(curP), leakMin(prevP)) },
    focus_pct: {
      value: Math.round(cur.active_min > 0 ? (cur.effort_min / cur.active_min) * 100 : 0),
      delta_pct: wowDelta(
        curP.active_min > 0 ? (curP.effort_min / curP.active_min) * 100 : 0,
        prevP.active_min > 0 ? (prevP.effort_min / prevP.active_min) * 100 : 0,
      ),
    },
    focus_score: { value: round1(avg(cur.scores)), delta_pct: wowDelta(avg(curP.scores), avg(prevP.scores)) },
    anki_reviews: { value: cur.anki_reviews, delta_pct: wowDelta(curP.anki_reviews, prevP.anki_reviews) },
    anki_minutes: {
      value: Math.round(cur.anki_seconds / 60),
      delta_pct: wowDelta(curP.anki_seconds, prevP.anki_seconds),
    },
    steps_per_day: {
      value: Math.round(avg(cur.steps)),
      delta_pct: wowDelta(avg(curP.steps), avg(prevP.steps)),
      source: "garmin",
    },
    sleep_avg_h: {
      value: round1(hours(avg(cur.sleep_min))),
      delta_pct: wowDelta(avg(curP.sleep_min), avg(prevP.sleep_min)),
      source: "garmin",
    },
  };

  // История усилия по неделям.
  const weekly_effort_history: WeeklyStatsResponse["weekly_effort_history"] = [];
  for (let w = WEEKS_HISTORY - 1; w >= 0; w--) {
    const ws = addDaysStr(weekStart, -w * 7);
    const sums = w === 0 ? cur : sumsForWeek(ws);
    // Текущую (незавершённую) неделю нормируем на прожитые дни, чтобы бар не проседал искусственно.
    const divisor = ws === weekStart ? elapsedDays : 7;
    weekly_effort_history.push({
      week_start: ws,
      effort_h_per_day: round1(sums.effort_min / 60 / divisor),
      is_current: ws === weekStart,
    });
  }

  // По дням текущей недели.
  const by_day: ByDay[] = [];
  const categoryMin: Record<string, number> = {};
  for (let i = 0; i < 7; i++) {
    const date = addDaysStr(weekStart, i);
    const e = computeEffort(pointsByDate.get(date) ?? [], interval);
    for (const [cat, min] of Object.entries(e.by_category)) {
      categoryMin[cat] = (categoryMin[cat] ?? 0) + min;
    }
    const scores = scoresByDate.get(date);
    const garmin = garminByDate.get(date);
    const anki = ankiByDate.get(date);
    by_day.push({
      date,
      dow: dowLabel(date),
      effort_h: round1(e.effort_min / 60),
      active_h: round1(e.active_min / 60),
      focus_pct: Math.round(e.focus_pct),
      focus_score: scores && scores.length ? round1(avg(scores)) : null,
      anki_reviews: anki?.reviews ?? 0,
      steps: typeof garmin?.steps === "number" ? garmin.steps : null,
      sleep_h: typeof garmin?.sleep_minutes === "number" ? round1(garmin.sleep_minutes / 60) : null,
    });
  }

  // Категории за неделю (часы), по убыванию.
  const categories: CategoryHours[] = Object.entries(categoryMin)
    .map(([category, min]) => ({ category, hours: round1(min / 60), kind: categoryKind(category) }))
    .filter((c) => c.hours > 0)
    .sort((a, b) => b.hours - a.hours);

  // Дневной ряд за окно — фронт строит из него скаттер в разных режимах
  // (день / лаг «сон прошлой ночи → усилие дня» / недельные агрегаты) и по разным осям.
  const daily_series: DailySeriesPoint[] = [];
  for (let i = SCATTER_DAYS - 1; i >= 0; i--) {
    const date = addDaysStr(weekEnd, -i);
    const garmin = garminByDate.get(date);
    const anki = ankiByDate.get(date);
    daily_series.push({
      date,
      effort_h: round1(dayEffortMin(date) / 60),
      sleep_h: typeof garmin?.sleep_minutes === "number" ? round1(garmin.sleep_minutes / 60) : null,
      steps: typeof garmin?.steps === "number" ? garmin.steps : null,
      anki_reviews: anki?.reviews ?? 0,
    });
  }

  return {
    week: {
      start: weekStart,
      end: weekEnd,
      label: weekLabel(weekStart, weekEnd),
      is_current: isCurrent,
      is_partial: isPartial,
      elapsed_days: elapsedDays,
    },
    cards,
    weekly_effort_history,
    by_day,
    categories,
    daily_series,
    coverage: { days_with_data: cur.days_with_focus },
  };
}

const router = Router();

// GET /api/stats/weekly?start=YYYY-MM-DD
router.get("/stats/weekly", async (req, res) => {
  const start = Array.isArray(req.query.start) ? req.query.start[0] : req.query.start;
  const data = await computeWeeklyStats({ start });
  res.json(data);
});

export default router;
