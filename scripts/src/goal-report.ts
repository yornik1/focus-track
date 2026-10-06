#!/usr/bin/env node
/**
 * Сообщение по цели: читает настройки и базу, решает, что слать сейчас, и печатает это для bash-отправки.
 *
 *   pnpm --silent --filter @workspace/scripts run goal-report [--dry-run] [--as-of "YYYY-MM-DD HH:MM"] [--no-llm]
 *
 * Что уходит в stdout (bash разбирает именно это, JSON там нет):
 *   ничего                     — ещё не время, метку не ставить;
 *   одна строка с именем метки — решено молчать, метку поставить;
 *   имя метки, дальше текст    — отправить текст и поставить метку.
 * Базу скрипт только читает, меток `goal-*` не создаёт. `--dry-run` добавляет числа одной строкой JSON в stderr.
 * `dotenv` здесь не подключается: при загрузке файла он пишет строку в stdout и сломал бы разбор.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type AppSettings,
  getDefaultAppSettings,
  goalSettingsPath,
  readAppSettings,
  readGoalSettings,
  speakingTopicsPath,
  sqliteConnection,
} from "@workspace/db";
import { addDays, isDeepWorkCategory } from "@workspace/categories";
import { generateGeminiText } from "@workspace/llm";
import { type DailyQuestion, parseQuestionResponse, parseTopicsFile, resolveDailyQuestion } from "./lib/daily-question";
import {
  BUSY_SHOT_COUNT,
  BUSY_WINDOW_SECONDS,
  type DailyFacts,
  type RecentShot,
  type ReviewFacts,
  type WeekFacts,
  dailyText,
  decideReport,
  isBusy,
  isWeekendKey,
  kievClock,
  kievMidnight,
  lastFinishedWeek,
  reviewText,
  topNonWork,
  weeklyText,
} from "./lib/goal-report";

/** За сколько часов назад берутся описания снимков для вопроса дня. */
const QUESTION_WINDOW_SECONDS = 48 * 3600;
const GEMINI_TIMEOUT_MS = 15_000;

/** «Сейчас» в unix-секундах: `--as-of` читается как местное время машины (она живёт в Europe/Kiev). */
function parseAsOf(argv: readonly string[]): number {
  const index = argv.indexOf("--as-of");
  if (index < 0) return Math.floor(Date.now() / 1000);
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(argv[index + 1] ?? "");
  if (!match) throw new Error('--as-of expects "YYYY-MM-DD HH:MM"');
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  return Math.floor(new Date(year, month - 1, day, hour, minute).getTime() / 1000);
}

function placeholders(items: readonly unknown[]): string {
  return items.map(() => "?").join(", ");
}

/** Привычки из списка, которые сейчас активны: удаление только ставит `active = 0`. */
function activeHabits(ids: readonly string[]): Set<string> {
  const rows = sqliteConnection
    .prepare(`SELECT id FROM habit_definitions WHERE active = 1 AND id IN (${placeholders(ids)})`)
    .all(...ids) as { id: string }[];
  return new Set(rows.map((row) => row.id));
}

/** Даты отрезка, в которые отмечена хоть одна из привычек; дальше `todayKey` не заглядываем. */
function doneDates(habits: readonly string[], fromKey: string, toKey: string, todayKey: string): string[] {
  const rows = sqliteConnection
    .prepare(
      `SELECT DISTINCT date FROM habits
       WHERE habit IN (${placeholders(habits)}) AND done = 1 AND date BETWEEN ? AND ? AND date <= ?
       ORDER BY date`,
    )
    .all(...habits, fromKey, toKey, todayKey) as { date: string }[];
  return rows.map((row) => row.date);
}

/** Числа итога недели и счётчики снимков, из которых получены часы (для сверки с прямым SQL). */
function collectWeek(input: {
  startKey: string;
  endKey: string;
  stepIds: readonly string[];
  questionId: string | undefined;
  now: number;
  todayKey: string;
  interval: number;
  threshold: number;
}): { week: WeekFacts; shots: Record<"weekday" | "weekend" | "weekdayWork" | "weekendWork", number> } {
  const { startKey, endKey, stepIds, questionId, now, todayKey, interval, threshold } = input;
  const stepDates = doneDates(stepIds, startKey, endKey, todayKey);
  const weekendNonEmpty = stepDates.filter(isWeekendKey).length;

  const rows = sqliteConnection
    .prepare("SELECT timestamp, category, focus_score FROM focus_log WHERE timestamp >= ? AND timestamp < ? AND timestamp <= ?")
    .all(kievMidnight(startKey), kievMidnight(addDays(endKey, 1)), now) as RecentShot[];

  const shots = { weekday: 0, weekend: 0, weekdayWork: 0, weekendWork: 0 };
  const minutesByCategory: Record<string, number> = {};
  for (const row of rows) {
    const weekend = isWeekendKey(kievClock(row.timestamp).dateKey);
    // Работа — как на Today: категория глубокой работы и оценка не ниже порога.
    const work = isDeepWorkCategory(row.category) && row.focus_score >= threshold;
    shots[weekend ? "weekend" : "weekday"] += 1;
    if (work) shots[weekend ? "weekendWork" : "weekdayWork"] += 1;
    minutesByCategory[row.category] = (minutesByCategory[row.category] ?? 0) + interval;
  }

  // Один снимок — `interval` минут; в текст идёт среднее на день.
  const hoursPerDay = (count: number, days: number): number => (count * interval) / 60 / days;
  return {
    shots,
    week: {
      startKey,
      endKey,
      nonEmptyDays: stepDates.length,
      weekdayNonEmpty: stepDates.length - weekendNonEmpty,
      weekendNonEmpty,
      englishDays: questionId === undefined ? null : doneDates([questionId], startKey, endKey, todayKey).length,
      screenHoursWeekday: hoursPerDay(shots.weekday, 5),
      screenHoursWeekend: hoursPerDay(shots.weekend, 2),
      workHoursWeekday: hoursPerDay(shots.weekdayWork, 5),
      workHoursWeekend: hoursPerDay(shots.weekendWork, 2),
      topNonWork: topNonWork(minutesByCategory),
    },
  };
}

/**
 * Вопрос дня: готовый из файла рядом с метками, иначе — новый (ИИ или запасной).
 * В файл попадает только ответ ИИ, чтобы пробный и настоящий запуск дали один текст и Gemini не вызывался дважды.
 */
async function questionOfDay(input: {
  dateKey: string;
  now: number;
  markersDir: string;
  noLlm: boolean;
  app: AppSettings;
}): Promise<DailyQuestion | null> {
  const { app } = input;
  const cachePath = path.join(input.markersDir, `question-${input.dateKey}.txt`);
  // С --no-llm готовый вопрос от ИИ не читаем: ключ нужен, чтобы увидеть именно запасной.
  if (!input.noLlm && existsSync(cachePath)) {
    const cached = parseQuestionResponse(readFileSync(cachePath, "utf8"));
    if (cached) return { ...cached, source: "llm" };
  }

  // Переписку и ленты в вопрос не берём.
  const summaries = (
    sqliteConnection
      .prepare(
        `SELECT DISTINCT summary FROM focus_log
         WHERE timestamp > ? AND timestamp <= ? AND category NOT IN ('communication', 'social')`,
      )
      .all(input.now - QUESTION_WINDOW_SECONDS, input.now) as { summary: string }[]
  ).map((row) => row.summary);
  const topicsPath = speakingTopicsPath();
  const topics = existsSync(topicsPath) ? parseTopicsFile(readFileSync(topicsPath, "utf8")) : [];

  // Провайдер, ключи и модель — те же, что у разбора снимков (analyze-screenshot.ts).
  const apiKey =
    app.provider === "gemini" ? app.token.trim() || (process.env.GEMINI_API_KEY ?? "") : (process.env.GEMINI_API_KEY ?? "");
  const apiKeys = [...new Set([apiKey, ...app.tokens].map((key) => key.trim()).filter(Boolean))];

  const question = await resolveDailyQuestion({
    dateKey: input.dateKey,
    summaries,
    topics,
    provider: app.provider,
    noLlm: input.noLlm,
    generate: (prompt) => generateGeminiText({ apiKeys, model: app.model, prompt, timeoutMs: GEMINI_TIMEOUT_MS }),
  });

  if (question?.source === "llm") {
    try {
      mkdirSync(input.markersDir, { recursive: true });
      writeFileSync(cachePath, JSON.stringify(question), "utf8");
    } catch (err) {
      // Не записалось — сообщение всё равно уходит: bash поставит метку дня, и повторного вызова не будет.
      console.error(`goal-report: cannot save ${path.basename(cachePath)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return question;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const noLlm = argv.includes("--no-llm");

  const goal = readGoalSettings();
  // Файла нет — обычное состояние на чужих установках: выходим молча.
  if (goal.status === "missing") return;
  if (goal.status === "invalid") {
    console.error(`goal-report: ${goal.reason}`);
    return;
  }
  const settings = goal.settings;

  const active = activeHabits([...settings.step_habit_ids, ...(settings.question_habit_id ? [settings.question_habit_id] : [])]);
  const stepIds = settings.step_habit_ids.filter((id) => active.has(id));
  if (stepIds.length === 0) {
    console.error("goal-report: no active habit from step_habit_ids");
    return;
  }
  // Привычка с вопросом неактивна — ведём себя так, будто её не задавали.
  const questionId =
    settings.question_habit_id !== undefined && active.has(settings.question_habit_id) ? settings.question_habit_id : undefined;

  const app = readAppSettings() ?? getDefaultAppSettings();
  const now = parseAsOf(argv);
  const clock = kievClock(now);
  const today = clock.dateKey;

  // Все запросы ограничены сверху моментом «сейчас»: с `--as-of` будущее не подглядывается.
  const screenshotsToday = (
    sqliteConnection
      .prepare("SELECT COUNT(*) AS n FROM focus_log WHERE timestamp >= ? AND timestamp <= ?")
      .get(kievMidnight(today), now) as { n: number }
  ).n;
  const recent = sqliteConnection
    .prepare(
      `SELECT timestamp, category, focus_score FROM focus_log
       WHERE timestamp > ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT ${BUSY_SHOT_COUNT}`,
    )
    .all(now - BUSY_WINDOW_SECONDS, now) as RecentShot[];
  const daily: DailyFacts = {
    screenshotsToday,
    busy: isBusy(recent, now, app.focused_score_threshold),
    stepDoneToday: doneDates(stepIds, today, today, today).length > 0,
    questionHabitDoneToday: questionId !== undefined && doneDates([questionId], today, today, today).length > 0,
  };

  // Метки ставит bash-отправка; здесь они только читаются.
  const markersDir = path.join(path.dirname(goalSettingsPath()), "data", "markers");
  const existingMarkers = new Set(existsSync(markersDir) ? readdirSync(markersDir) : []);

  const decision = decideReport({
    clock,
    settings: {
      firstAction: settings.first_action,
      nudgeHour: settings.nudge_hour,
      minScreenshots: settings.min_screenshots,
      reviewDate: settings.review_date,
      hasQuestionHabit: questionId !== undefined,
    },
    daily,
    existingMarkers,
  });

  const numbers: Record<string, unknown> = {
    asOf: clock,
    decision,
    habits: { steps: stepIds, question: questionId ?? null },
    daily,
    recent,
    markers: [...existingMarkers].sort(),
  };

  let text: string | undefined;
  if (decision.kind === "weekly") {
    const { week, shots } = collectWeek({
      ...lastFinishedWeek(today),
      stepIds,
      questionId,
      now,
      todayKey: today,
      interval: app.screenshot_interval,
      threshold: app.focused_score_threshold,
    });
    numbers.week = { ...week, shots, interval: app.screenshot_interval, threshold: app.focused_score_threshold };
    text = weeklyText(week);
  } else if (decision.kind === "review") {
    // 14 дней, которые кончаются вчера.
    const fromKey = addDays(today, -14);
    const toKey = addDays(today, -1);
    const stepDates = doneDates(stepIds, fromKey, toKey, today);
    const review: ReviewFacts = {
      englishDays: questionId === undefined ? null : doneDates([questionId], fromKey, toKey, today).length,
      nonEmptyDays: stepDates.length,
      weekendNonEmpty: stepDates.filter(isWeekendKey).length,
    };
    numbers.review = { fromKey, toKey, ...review };
    text = reviewText(review);
  } else if (decision.kind === "daily") {
    // Gemini вызывается только здесь — когда уже решено слать дневное сообщение.
    const question = await questionOfDay({ dateKey: today, now, markersDir, noLlm, app });
    numbers.question = question;
    text = dailyText({ dateKey: today, emptyDay: decision.emptyDay, firstAction: settings.first_action, question });
  }

  if (decision.kind !== "none") {
    console.log(decision.marker);
    if (text !== undefined) console.log(text);
  }
  if (dryRun) console.error(JSON.stringify(numbers));
}

main().catch((err) => {
  console.error(`goal-report: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
