/**
 * Серия непустых дней с заморозками. Чистый расчёт без базы: вход — список дней,
 * состояние нигде не хранится, поэтому отметка задним числом учитывается сама.
 */
import { addDays } from "./weekly";

/** Правила серии из `focus-goal.json` (блок `streak`, без даты старта). */
export interface StreakRules {
  earn_every: number; // столько непустых дней подряд дают одну заморозку
  cap: number; // больше стольких заморозок в запасе не бывает
  start_freezes: number; // заморозки на старте
}

/** Что случилось в последний день списка: потрачена заморозка, серия прервана или ничего. */
export type StreakEvent = "freeze_used" | "streak_broken" | null;

export interface StreakState {
  streak: number;
  freezes: number;
  lastEvent: StreakEvent;
  /** Серия перед последним днём списка — нужна тексту «серия N прервана». */
  streakBeforeLastDay: number;
}

/**
 * Проигрывает дни по порядку. `days[i]` — был ли день непустым.
 * Пустой день тратит заморозку (серия цела) или, если их нет, обнуляет серию;
 * пока серия нулевая, пустые дни ничего не меняют.
 */
export function computeStreak(days: readonly boolean[], rules: StreakRules): StreakState {
  let streak = 0;
  let freezes = Math.min(rules.start_freezes, rules.cap);
  let run = 0; // непустых дней подряд с последнего пропуска — счёт до следующей заморозки
  let lastEvent: StreakEvent = null;
  let streakBeforeLastDay = 0;

  for (const nonEmpty of days) {
    streakBeforeLastDay = streak;
    lastEvent = null;

    if (nonEmpty) {
      streak += 1;
      run += 1;
      if (run % rules.earn_every === 0 && freezes < rules.cap) freezes += 1;
      continue;
    }

    run = 0;
    // Серии ещё нет — защищать нечего: заморозка не тратится, события нет.
    if (streak === 0) continue;
    if (freezes > 0) {
      freezes -= 1;
      lastEvent = "freeze_used";
    } else {
      lastEvent = "streak_broken";
      streak = 0;
    }
  }

  return { streak, freezes, lastEvent, streakBeforeLastDay };
}

/**
 * Список дней для `computeStreak`: от дня старта до вчера включительно.
 * Сегодня входит, только если он уже непустой — иначе незаконченный день обрывал бы серию.
 */
export function streakDays(startKey: string, todayKey: string, nonEmptyDates: ReadonlySet<string>): boolean[] {
  const days: boolean[] = [];
  for (let day = startKey; day < todayKey; day = addDays(day, 1)) {
    days.push(nonEmptyDates.has(day));
  }
  if (startKey <= todayKey && nonEmptyDates.has(todayKey)) days.push(true);
  return days;
}
