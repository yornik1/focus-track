import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveAppSettingsPath } from "./app-settings";

/** Правила серии с заморозками; без блока `streak` серии нет. */
export interface GoalStreakRules {
  start_date: string;
  earn_every: number;
  cap: number;
  start_freezes: number;
}

/** Настройки цели из `focus-goal.json`: файл правится руками, программа его только читает. */
export interface GoalSettings {
  /** Текст цели для человека; программа его не использует. */
  goal?: string;
  first_action: string;
  step_habit_ids: string[];
  /** Без него дневное сообщение уходит только в пустой день. */
  question_habit_id?: string;
  nudge_hour: number;
  min_screenshots: number;
  streak?: GoalStreakRules;
  /** Без даты сообщения проверки нет. */
  review_date?: string;
}

export type GoalSettingsResult =
  | { status: "missing" }
  | { status: "invalid"; reason: string }
  | { status: "ok"; settings: GoalSettings };

const GOAL_SETTINGS_FILENAME = "focus-goal.json";
const SPEAKING_TOPICS_FILENAME = "speaking-topics.txt";
const DEFAULT_NUDGE_HOUR = 14;
const DEFAULT_MIN_SCREENSHOTS = 5;

function invalid(reason: string): GoalSettingsResult {
  return { status: "invalid", reason };
}

function isInt(value: unknown, min: number, max: number = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Строка YYYY-MM-DD, которая есть в календаре (2026-02-30 не проходит). */
function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Абсолютный путь к файлу настроек цели (каталог тот же, что у `focus-app-settings.json`). */
export function goalSettingsPath(): string {
  return path.join(path.dirname(resolveAppSettingsPath()), GOAL_SETTINGS_FILENAME);
}

/** Абсолютный путь к списку запасных вопросов (тот же каталог). */
export function speakingTopicsPath(): string {
  return path.join(path.dirname(resolveAppSettingsPath()), SPEAKING_TOPICS_FILENAME);
}

/** Чистая проверка содержимого файла: значения обязательных полей не выдумываются. */
export function parseGoalSettings(raw: unknown): GoalSettingsResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return invalid("settings must be a JSON object");
  }
  const o = raw as Record<string, unknown>;

  const first_action = typeof o.first_action === "string" ? o.first_action.trim() : "";
  if (!first_action) return invalid("first_action must be a non-empty string");

  if (!Array.isArray(o.step_habit_ids) || o.step_habit_ids.length === 0) {
    return invalid("step_habit_ids must be a non-empty array");
  }
  const step_habit_ids: string[] = [];
  for (const item of o.step_habit_ids as unknown[]) {
    const id = typeof item === "string" ? item.trim() : "";
    if (!id) return invalid("step_habit_ids must contain only non-empty strings");
    if (!step_habit_ids.includes(id)) step_habit_ids.push(id);
  }

  const settings: GoalSettings = {
    first_action,
    step_habit_ids,
    nudge_hour: DEFAULT_NUDGE_HOUR,
    min_screenshots: DEFAULT_MIN_SCREENSHOTS,
  };
  if (typeof o.goal === "string") settings.goal = o.goal;

  if (o.question_habit_id !== undefined) {
    const id = typeof o.question_habit_id === "string" ? o.question_habit_id.trim() : "";
    if (!id) return invalid("question_habit_id must be a non-empty string");
    settings.question_habit_id = id;
  }

  if (o.nudge_hour !== undefined) {
    if (!isInt(o.nudge_hour, 0, 23)) return invalid("nudge_hour must be an integer from 0 to 23");
    settings.nudge_hour = o.nudge_hour;
  }

  if (o.min_screenshots !== undefined) {
    if (!isInt(o.min_screenshots, 0)) return invalid("min_screenshots must be an integer >= 0");
    settings.min_screenshots = o.min_screenshots;
  }

  // Блок есть, но испорчен — весь файл негоден: молча выключить серию было бы хуже.
  if (o.streak !== undefined) {
    if (typeof o.streak !== "object" || o.streak === null || Array.isArray(o.streak)) {
      return invalid("streak must be an object");
    }
    const s = o.streak as Record<string, unknown>;
    if (!isRealDate(s.start_date)) return invalid("streak.start_date must be a real YYYY-MM-DD date");
    if (!isInt(s.earn_every, 1)) return invalid("streak.earn_every must be an integer >= 1");
    if (!isInt(s.cap, 0)) return invalid("streak.cap must be an integer >= 0");
    if (!isInt(s.start_freezes, 0, s.cap)) {
      return invalid("streak.start_freezes must be an integer from 0 to streak.cap");
    }
    settings.streak = {
      start_date: s.start_date,
      earn_every: s.earn_every,
      cap: s.cap,
      start_freezes: s.start_freezes,
    };
  }

  if (o.review_date !== undefined && o.review_date !== "") {
    if (!isRealDate(o.review_date)) return invalid("review_date must be empty or a real YYYY-MM-DD date");
    settings.review_date = o.review_date;
  }

  return { status: "ok", settings };
}

/** Читает `focus-goal.json`: нет файла — `missing`, не читается или не JSON — `invalid`. */
export function readGoalSettings(): GoalSettingsResult {
  const filePath = goalSettingsPath();
  if (!existsSync(filePath)) {
    return { status: "missing" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (err) {
    return invalid(err instanceof SyntaxError ? `${GOAL_SETTINGS_FILENAME} is not valid JSON` : `cannot read ${GOAL_SETTINGS_FILENAME}`);
  }
  return parseGoalSettings(parsed);
}
