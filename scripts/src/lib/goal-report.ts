/**
 * Сообщения по цели: решение «что слать сейчас» и тексты. Чистые функции без базы, файлов и сети —
 * числа собирает `scripts/src/goal-report.ts`, отправляет bash.
 */
import { addDays, isDeepWorkCategory, mondayOf, type StreakEvent, type StreakState } from "@workspace/categories";
import { type DailyQuestion, pickByDate } from "./daily-question";

/** «Сейчас» глазами отчёта: местная дата и час по Киеву. */
export interface ReportClock {
  epoch: number; // unix-секунды
  dateKey: string; // местная дата YYYY-MM-DD
  hour: number; // 0–23
  weekdayIndex: number; // 0 = пн … 6 = вс
}

const KIEV_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Kiev",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
});

/** День недели по ключу даты: 0 = пн … 6 = вс. */
function weekdayIndexOf(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export function kievClock(epochSeconds: number): ReportClock {
  const parts: Record<string, string> = {};
  for (const part of KIEV_PARTS.formatToParts(new Date(epochSeconds * 1000))) {
    parts[part.type] = part.value;
  }
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  return { epoch: epochSeconds, dateKey, hour: Number(parts.hour), weekdayIndex: weekdayIndexOf(dateKey) };
}

/** Unix-секунды местной (киевской) полуночи, с которой начинается день `dateKey`. */
export function kievMidnight(dateKey: string): number {
  const utcMidnight = Date.parse(`${dateKey}T00:00:00Z`) / 1000;
  // Киев — UTC+3 летом и UTC+2 зимой; часы переводят в 03:00–04:00, сама полночь не двигается.
  const summer = utcMidnight - 3 * 3600;
  return kievClock(summer).dateKey === dateKey ? summer : utcMidnight - 2 * 3600;
}

/** Последняя завершённая неделя (пн..вс) — та, что перед неделей с датой `dateKey`. */
export function lastFinishedWeek(dateKey: string): { startKey: string; endKey: string } {
  const startKey = addDays(mondayOf(dateKey), -7);
  return { startKey, endKey: addDays(startKey, 6) };
}

export function isWeekendKey(dateKey: string): boolean {
  return weekdayIndexOf(dateKey) >= 5;
}

export interface RecentShot {
  timestamp: number; // unix-секунды
  category: string;
  focus_score: number;
}

/** Окно, в котором снимки говорят о «сейчас», и сколько последних из них смотрим. */
export const BUSY_WINDOW_SECONDS = 15 * 60;
export const BUSY_SHOT_COUNT = 3;

/**
 * Занят — если за последние 15 минут есть снимки и последние из них (до трёх) все — работа.
 * Снимков нет — не занят: при простое снимки не делаются, сообщение уйдёт на телефон.
 */
export function isBusy(recent: readonly RecentShot[], nowEpoch: number, threshold: number): boolean {
  const latest = recent
    .filter((shot) => shot.timestamp > nowEpoch - BUSY_WINDOW_SECONDS && shot.timestamp <= nowEpoch)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, BUSY_SHOT_COUNT);
  if (latest.length === 0) return false;
  return latest.every((shot) => isDeepWorkCategory(shot.category) && shot.focus_score >= threshold);
}

export interface ReportSettings {
  nudgeHour: number;
  minScreenshots: number;
  reviewDate?: string;
  /** Привычка с вопросом задана и активна. */
  hasQuestionHabit: boolean;
}

/**
 * Привычки из настроек против активных в базе: неактивные пропускаются.
 * Ни одной активной из списка шагов — null: файл настроек негоден.
 */
export function resolveHabits(
  stepHabitIds: readonly string[],
  questionHabitId: string | undefined,
  active: ReadonlySet<string>,
): { stepIds: string[]; questionId: string | undefined } | null {
  const stepIds = stepHabitIds.filter((id) => active.has(id));
  if (stepIds.length === 0) return null;
  // Привычка с вопросом неактивна — ведём себя так, будто её не задавали.
  const questionId = questionHabitId !== undefined && active.has(questionHabitId) ? questionHabitId : undefined;
  return { stepIds, questionId };
}

export interface DailyFacts {
  screenshotsToday: number;
  busy: boolean;
  /** Сегодня отмечена хоть одна привычка из списка шагов. */
  stepDoneToday: boolean;
  questionHabitDoneToday: boolean;
}

/**
 * `none` — ещё не время, метку не ставить; `silent` — решено молчать, метку поставить;
 * остальные — отправить текст и поставить метку.
 */
export type ReportDecision =
  | { kind: "none" }
  | { kind: "silent"; marker: string }
  | { kind: "streak"; marker: string }
  | { kind: "weekly"; marker: string }
  | { kind: "review"; marker: string }
  | { kind: "daily"; marker: string; emptyDay: boolean };

/** Итог недели и проверка плана уходят не раньше этого часа: снимки после полуночи есть почти каждый день. */
const MORNING_HOUR = 9;
/** С этого часа до утра сообщения не шлём — ни дневное, ни итог недели, ни проверку плана. */
const QUIET_HOUR = 22;

/** За один запуск — одно сообщение; порядок: событие серии, итог недели, проверка плана, день. */
export function decideReport(input: {
  clock: ReportClock;
  settings: ReportSettings;
  daily: DailyFacts;
  /** Что случилось с серией вчера; без блока `streak` в настройках — не задано. */
  streakEvent?: StreakEvent;
  existingMarkers: ReadonlySet<string>;
}): ReportDecision {
  const { clock, settings, daily, existingMarkers } = input;

  if (clock.hour >= MORNING_HOUR && clock.hour < QUIET_HOUR) {
    // Событие серии — про вчерашний день, поэтому идёт первым и один раз за сегодня.
    if (input.streakEvent) {
      const streakMarker = `goal-streak-${clock.dateKey}`;
      if (!existingMarkers.has(streakMarker)) return { kind: "streak", marker: streakMarker };
    }

    const weeklyMarker = `goal-weekly-${lastFinishedWeek(clock.dateKey).startKey}`;
    if (!existingMarkers.has(weeklyMarker)) return { kind: "weekly", marker: weeklyMarker };

    if (settings.reviewDate && clock.dateKey >= settings.reviewDate) {
      const reviewMarker = `goal-review-${settings.reviewDate}`;
      if (!existingMarkers.has(reviewMarker)) return { kind: "review", marker: reviewMarker };
    }
  }

  const dailyMarker = `goal-daily-${clock.dateKey}`;
  if (existingMarkers.has(dailyMarker)) return { kind: "none" };
  if (clock.hour < settings.nudgeHour || clock.hour >= QUIET_HOUR) return { kind: "none" };

  // Английский уже отмечен — на сегодня вопрос закрыт.
  if (settings.hasQuestionHabit && daily.questionHabitDoneToday) return { kind: "silent", marker: dailyMarker };
  // Без привычки с вопросом сообщение уходит только в пустой день.
  if (!settings.hasQuestionHabit && daily.stepDoneToday) return { kind: "silent", marker: dailyMarker };

  if (daily.screenshotsToday < settings.minScreenshots) return { kind: "none" };
  // Занят делом — без метки: проверим на следующем проходе.
  if (daily.busy) return { kind: "none" };

  return { kind: "daily", marker: dailyMarker, emptyDay: !daily.stepDoneToday };
}

/** Начала для пустого дня, по кругу по дате; новый вариант добавляется строкой в список. */
const EMPTY_DAY_OPENINGS: readonly string[] = [
  "Сегодня пока ничего не отмечено. Хватит 10 минут английского вслух.",
  "День ещё открыт. 10 минут английского вслух — и он засчитан.",
  "Можно начать с малого: 10 минут английского вслух.",
];

/** Первая фраза, если ИИ свою не дал или вопрос запасной. */
const DEFAULT_OPENER = "Honestly, I think … because …";

/** Роль собеседника меняется по дням, чтобы разговор не шёл каждый раз по одной колее. */
const PARTNER_ROLES: readonly string[] = [
  "Disagree with me.",
  "Play a sceptical friend.",
  "Interview me like a curious journalist.",
];

/** Готовая фраза для ИИ-собеседника: с неё разговор начинается без раздумий. */
export function partnerInstruction(dateKey: string): string {
  const role = pickByDate(PARTNER_ROLES, dateKey, "role") ?? PARTNER_ROLES[0];
  return `Let's discuss this in English for 10 minutes. ${role} Ask me one question at a time and correct my mistakes briefly.`;
}

export function dailyText(input: {
  dateKey: string;
  emptyDay: boolean;
  firstAction: string;
  question: DailyQuestion | null;
  streakLine?: string;
  /** Текущая серия; при серии больше нуля в круг начал добавляется «Серия N ждёт». */
  streak?: number;
}): string {
  const { question } = input;
  const lines: string[] = [];

  if (input.emptyDay) {
    const openings =
      input.streak && input.streak > 0
        ? [...EMPTY_DAY_OPENINGS, `Серия ${input.streak} ждёт. 10 минут английского вслух.`]
        : EMPTY_DAY_OPENINGS;
    lines.push(pickByDate(openings, input.dateKey) ?? openings[0]);
  } else if (question) {
    lines.push("Вопрос дня для английского вслух.");
  } else {
    lines.push(`Английский вслух сегодня ещё не отмечен. Хватит 10 минут: ${input.firstAction}.`);
  }

  if (question) {
    // У запасного вопроса из файла нет ни ситуации, ни своей первой фразы, ни пояснения, ни продолжений.
    if (question.situation) lines.push(question.situation);
    lines.push(question.question);
    lines.push(`Начни так: ${question.opener || DEFAULT_OPENER}`);
    lines.push(`Скажи ИИ: ${partnerInstruction(input.dateKey)}`);
    if (question.why) lines.push(`С чем связан: ${question.why}`);
    if (question.followups.length >= 2) {
      lines.push(`Дальше можно спросить: 1) ${question.followups[0]} 2) ${question.followups[1]}`);
    }
  }

  if (input.streakLine) lines.push(input.streakLine);
  return lines.join("\n");
}

/** Строка серии для дневного сообщения и итога недели. */
export function streakLine(state: Pick<StreakState, "streak" | "freezes">, cap: number): string {
  return `Серия ${state.streak} · заморозок ${state.freezes} из ${cap}`;
}

/**
 * Сообщение утром после пустого дня; `state` — серия по дням до вчера включительно.
 * Оговорка в тексте нужна, потому что часть автоотметок записывается задним числом.
 */
export function streakEventText(state: StreakState): string | null {
  if (state.lastEvent === "freeze_used") {
    return `По отметкам вчера пусто: сработала заморозка, серия ${state.streak} цела, осталось ${state.freezes}. Придёт отметка позже — пересчитается само.`;
  }
  if (state.lastEvent === "streak_broken") {
    return `По отметкам вчера пусто, заморозок нет: серия ${state.streakBeforeLastDay} прервана. Придёт отметка за вчера — серия вернётся.`;
  }
  return null;
}

/** Дни серии строкой для пробного запуска: «#» — непустой, «.» — пустой. */
export function renderStreakDays(days: readonly boolean[]): string {
  return days.map((nonEmpty) => (nonEmpty ? "#" : ".")).join("");
}

/** Числа итога недели; часы — среднее на день: будни ÷ 5, выходные ÷ 2. */
export interface WeekFacts {
  startKey: string;
  endKey: string;
  nonEmptyDays: number;
  weekdayNonEmpty: number;
  weekendNonEmpty: number;
  /** null — привычки с вопросом нет, строка про английский не печатается. */
  englishDays: number | null;
  screenHoursWeekday: number;
  screenHoursWeekend: number;
  workHoursWeekday: number;
  workHoursWeekend: number;
  topNonWork: { category: string; hours: number }[];
}

/** Часы с одним знаком после запятой: 4,1; целые — 2,0. */
function formatHours(hours: number): string {
  return (Math.round(hours * 10) / 10).toFixed(1).replace(".", ",");
}

/** «день» в нужной форме: 1 день, 2 дня, 5 дней, 11 дней, 21 день. */
function daysWord(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return "дней";
  if (count % 10 === 1) return "день";
  if (count % 10 >= 2 && count % 10 <= 4) return "дня";
  return "дней";
}

/** YYYY-MM-DD → ДД.ММ */
function shortDate(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${day}.${month}`;
}

function barHint(nonEmptyDays: number): string {
  if (nonEmptyDays >= 6) return "Планка: можно прибавить 5 минут к первому шагу.";
  if (nonEmptyDays >= 4) return "Планка: оставь как есть.";
  return "Планка: уменьши первый шаг вдвое, это нормально.";
}

export function weeklyText(week: WeekFacts, streakLine?: string): string {
  const lines: string[] = [
    `Итог недели ${shortDate(week.startKey)}–${shortDate(week.endKey)}.`,
    `Непустых дней: ${week.nonEmptyDays} из 7 (будни ${week.weekdayNonEmpty} из 5, выходные ${week.weekendNonEmpty} из 2).`,
  ];
  if (week.englishDays !== null) lines.push(`Английский вслух: ${week.englishDays} ${daysWord(week.englishDays)}.`);
  lines.push(
    `За экраном в день: будни ${formatHours(week.screenHoursWeekday)} ч, выходные ${formatHours(week.screenHoursWeekend)} ч; ` +
      `из них работа: ${formatHours(week.workHoursWeekday)} ч и ${formatHours(week.workHoursWeekend)} ч.`,
  );

  const nonWork = week.topNonWork.filter((item) => item.hours > 0);
  if (nonWork.length > 0) {
    lines.push(`Не работа, больше всего: ${nonWork.map((item) => `${item.category} ${formatHours(item.hours)} ч`).join(", ")}.`);
  }

  if (streakLine) lines.push(streakLine);
  lines.push(barHint(week.nonEmptyDays));
  return lines.join("\n");
}

/** Числа за 14 дней перед днём проверки. */
export interface ReviewFacts {
  englishDays: number | null;
  nonEmptyDays: number;
  weekendNonEmpty: number;
}

export function reviewText(review: ReviewFacts): string {
  const english =
    review.englishDays === null ? "" : `английский вслух ${review.englishDays} (перед стартом 0, лучшие две недели 7), `;
  return (
    `Сегодня проверка плана. За последние 14 дней: ${english}непустых ${review.nonEmptyDays} (было в среднем 11), ` +
    `из них выходных ${review.weekendNonEmpty} из 4. Открой план, раздел 6.`
  );
}

/**
 * Категории «не работа» по убыванию минут: без глубокой работы и без `communication`.
 * Часы — с одним знаком; записи, которые округляются до нуля, отбрасываются.
 */
export function topNonWork(
  minutesByCategory: Readonly<Record<string, number>>,
  limit: number = 3,
): { category: string; hours: number }[] {
  return Object.entries(minutesByCategory)
    .filter(([category]) => !isDeepWorkCategory(category) && category !== "communication")
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([category, minutes]) => ({ category, hours: Math.round(minutes / 6) / 10 }))
    .filter((item) => item.hours > 0);
}
