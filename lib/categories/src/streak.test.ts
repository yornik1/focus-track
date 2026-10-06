import assert from "node:assert/strict";
import test from "node:test";
import { computeStreak, streakDays, type StreakRules } from "./streak";

const RULES: StreakRules = { earn_every: 5, cap: 2, start_freezes: 1 };

/** «#» — непустой день, «.» — пустой: так же дни печатает пробный запуск. */
function days(pattern: string): boolean[] {
  return [...pattern].map((ch) => ch === "#");
}

test("computeStreak: пустая история — серия 0, заморозки стартовые, события нет", () => {
  assert.deepEqual(computeStreak([], RULES), { streak: 0, freezes: 1, lastEvent: null, streakBeforeLastDay: 0 });
});

test("computeStreak: все дни непустые — серия растёт, заморозок не больше cap", () => {
  const state = computeStreak(days("#".repeat(30)), RULES);
  assert.equal(state.streak, 30);
  assert.equal(state.freezes, 2);
  assert.equal(state.lastEvent, null);
});

test("computeStreak: заморозка даётся на earn_every-м дне подряд и не раньше", () => {
  const rules: StreakRules = { earn_every: 5, cap: 2, start_freezes: 0 };
  assert.equal(computeStreak(days("####"), rules).freezes, 0);
  assert.equal(computeStreak(days("#####"), rules).freezes, 1);
  assert.equal(computeStreak(days("#########"), rules).freezes, 1);
  assert.equal(computeStreak(days("##########"), rules).freezes, 2);
});

test("computeStreak: один пропуск с заморозкой — серия цела, заморозка потрачена", () => {
  const state = computeStreak(days("###."), RULES);
  assert.deepEqual(state, { streak: 3, freezes: 0, lastEvent: "freeze_used", streakBeforeLastDay: 3 });
});

test("computeStreak: два пропуска подряд при двух заморозках — серия цела", () => {
  // 5 дней подряд дают вторую заморозку к стартовой
  const state = computeStreak(days("#####.."), RULES);
  assert.equal(state.streak, 5);
  assert.equal(state.freezes, 0);
  assert.equal(state.lastEvent, "freeze_used");
});

test("computeStreak: три пропуска подряд — серия 0", () => {
  const state = computeStreak(days("#####..."), RULES);
  assert.deepEqual(state, { streak: 0, freezes: 0, lastEvent: "streak_broken", streakBeforeLastDay: 5 });
});

test("computeStreak: пропуск без заморозок обрывает серию", () => {
  const rules: StreakRules = { earn_every: 5, cap: 2, start_freezes: 0 };
  const state = computeStreak(days("###."), rules);
  assert.deepEqual(state, { streak: 0, freezes: 0, lastEvent: "streak_broken", streakBeforeLastDay: 3 });
});

test("computeStreak: пустой день при серии 0 и без заморозок — не событие", () => {
  const rules: StreakRules = { earn_every: 5, cap: 2, start_freezes: 0 };
  assert.equal(computeStreak(days("."), rules).lastEvent, null);
  assert.equal(computeStreak(days("#.."), rules).lastEvent, null);
});

test("computeStreak: при серии 0 пустой день заморозку не тратит — защищать ещё нечего", () => {
  // Старт с заморозкой и два пустых дня: заморозка цела, события нет.
  assert.deepEqual(computeStreak(days(".."), RULES), { streak: 0, freezes: 1, lastEvent: null, streakBeforeLastDay: 0 });
  // Дальше серия начинается как обычно и заморозка её защищает.
  assert.deepEqual(computeStreak(days("..##."), RULES), { streak: 2, freezes: 0, lastEvent: "freeze_used", streakBeforeLastDay: 2 });
});

test("computeStreak: после потраченной заморозки счёт до следующей начинается заново", () => {
  const rules: StreakRules = { earn_every: 5, cap: 2, start_freezes: 1 };
  // 4 дня, пропуск (заморозка потрачена), ещё 4 дня: подряд после пропуска только 4 — новой заморозки нет
  assert.equal(computeStreak(days("####.####"), rules).freezes, 0);
  // пятый день после пропуска её даёт
  assert.equal(computeStreak(days("####.#####"), rules).freezes, 1);
  // серия при этом не обнулялась
  assert.equal(computeStreak(days("####.#####"), rules).streak, 9);
});

test("computeStreak: непустой последний день — события нет, даже если раньше были пропуски", () => {
  const state = computeStreak(days("###.#"), RULES);
  assert.equal(state.lastEvent, null);
  assert.equal(state.streak, 4);
});

test("computeStreak: cap 0 — заморозок не бывает", () => {
  const rules: StreakRules = { earn_every: 1, cap: 0, start_freezes: 0 };
  assert.equal(computeStreak(days("######"), rules).freezes, 0);
  assert.equal(computeStreak(days("###."), rules).streak, 0);
});

test("streakDays: дни от старта до вчера; сегодня входит, только если уже непустой", () => {
  const nonEmpty = new Set(["2026-10-01", "2026-10-03"]);
  // сегодня (04) ещё пустой — в список не входит, серию не обрывает
  assert.deepEqual(streakDays("2026-10-01", "2026-10-04", nonEmpty), [true, false, true]);
  // сегодня уже непустой — входит последним
  assert.deepEqual(streakDays("2026-10-01", "2026-10-04", new Set([...nonEmpty, "2026-10-04"])), [true, false, true, true]);
});

test("streakDays: старт сегодня и старт в будущем", () => {
  assert.deepEqual(streakDays("2026-10-06", "2026-10-06", new Set()), []);
  assert.deepEqual(streakDays("2026-10-06", "2026-10-06", new Set(["2026-10-06"])), [true]);
  assert.deepEqual(streakDays("2026-10-10", "2026-10-06", new Set(["2026-10-06"])), []);
});

test("streakDays + computeStreak: сегодня ещё пустой — серия не обрывается", () => {
  const rules: StreakRules = { earn_every: 5, cap: 2, start_freezes: 0 };
  const list = streakDays("2026-10-01", "2026-10-04", new Set(["2026-10-01", "2026-10-02", "2026-10-03"]));
  assert.equal(computeStreak(list, rules).streak, 3);
});
