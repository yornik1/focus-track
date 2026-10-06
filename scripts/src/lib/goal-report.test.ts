import assert from "node:assert/strict";
import test from "node:test";
import { addDays } from "@workspace/categories";
import type { DailyQuestion } from "./daily-question";
import {
  type DailyFacts,
  type RecentShot,
  type ReportClock,
  type ReportSettings,
  type WeekFacts,
  dailyText,
  decideReport,
  partnerInstruction,
  isBusy,
  isWeekendKey,
  kievClock,
  kievMidnight,
  lastFinishedWeek,
  renderStreakDays,
  resolveHabits,
  reviewText,
  streakEventText,
  streakLine,
  topNonWork,
  weeklyText,
} from "./goal-report";

const epochOf = (iso: string): number => Date.parse(iso) / 1000;

test("kievClock: дата и час по Киеву, даже когда дата в UTC другая", () => {
  // 22:30 UTC 5 октября — это уже 01:30 вторника 6 октября в Киеве (летнее время, UTC+3).
  const night = epochOf("2026-10-05T22:30:00Z");
  assert.deepEqual(kievClock(night), { dateKey: "2026-10-06", hour: 1 });

  const saturday = epochOf("2026-10-03T11:05:00Z");
  assert.deepEqual(kievClock(saturday), { dateKey: "2026-10-03", hour: 14 });

  const sunday = epochOf("2026-10-04T09:00:00Z");
  assert.deepEqual(kievClock(sunday), { dateKey: "2026-10-04", hour: 12 });
});

test("kievClock: зимой UTC+2, полночь — это час 0, а не 24", () => {
  const newYear = epochOf("2026-12-31T22:30:00Z");
  assert.deepEqual(kievClock(newYear), { dateKey: "2027-01-01", hour: 0 });
});

test("kievMidnight: начало местных суток, в том числе в дни перевода часов", () => {
  assert.equal(kievMidnight("2026-10-06"), epochOf("2026-10-05T21:00:00Z"));
  assert.equal(kievMidnight("2026-12-15"), epochOf("2026-12-14T22:00:00Z"));

  // Свойство не зависит от того, в какой день переводят часы: секунда до полуночи — ещё вчера.
  for (const dateKey of ["2026-03-28", "2026-03-29", "2026-03-30", "2026-07-01", "2026-10-24", "2026-10-25", "2026-10-26", "2027-01-01"]) {
    const midnight = kievMidnight(dateKey);
    assert.equal(kievClock(midnight).dateKey, dateKey, dateKey);
    assert.equal(kievClock(midnight).hour, 0, dateKey);
    assert.equal(kievClock(midnight - 1).dateKey, addDays(dateKey, -1), dateKey);
  }
});

test("lastFinishedWeek: понедельник, среда и воскресенье дают прошлую неделю пн–вс", () => {
  const previous = { startKey: "2026-09-28", endKey: "2026-10-04" };
  assert.deepEqual(lastFinishedWeek("2026-10-05"), previous);
  assert.deepEqual(lastFinishedWeek("2026-10-07"), previous);
  assert.deepEqual(lastFinishedWeek("2026-10-11"), previous);
  // Воскресенье ещё принадлежит своей неделе, поэтому «прошлая» для него на неделю раньше.
  assert.deepEqual(lastFinishedWeek("2026-10-04"), { startKey: "2026-09-21", endKey: "2026-09-27" });
  assert.deepEqual(lastFinishedWeek("2027-01-01"), { startKey: "2026-12-21", endKey: "2026-12-27" });
});

test("isWeekendKey: суббота и воскресенье", () => {
  assert.equal(isWeekendKey("2026-10-03"), true);
  assert.equal(isWeekendKey("2026-10-04"), true);
  assert.equal(isWeekendKey("2026-10-02"), false);
  assert.equal(isWeekendKey("2026-10-05"), false);
});

const NOW = epochOf("2026-10-06T11:00:00Z");
const THRESHOLD = 6;

function shot(secondsAgo: number, category: string = "code", focus_score: number = 8): RecentShot {
  return { timestamp: NOW - secondsAgo, category, focus_score };
}

test("isBusy: снимков за 15 минут нет → не занят", () => {
  assert.equal(isBusy([], NOW, THRESHOLD), false);
  assert.equal(isBusy([shot(901), shot(3600)], NOW, THRESHOLD), false);
  // Граница строгая: снимок ровно 15 минут назад уже не считается.
  assert.equal(isBusy([shot(900)], NOW, THRESHOLD), false);
});

test("isBusy: три последних снимка — работа → занят", () => {
  assert.equal(isBusy([shot(60), shot(300, "research", 7), shot(600, "writing", 6)], NOW, THRESHOLD), true);
  // Порядок строк на входе не важен, а четвёртый с конца снимок уже не смотрим.
  assert.equal(isBusy([shot(840, "social", 1), shot(480), shot(60), shot(240)], NOW, THRESHOLD), true);
});

test("isBusy: один из трёх последних не работа → не занят", () => {
  assert.equal(isBusy([shot(60), shot(300, "social", 2), shot(600)], NOW, THRESHOLD), false);
  assert.equal(isBusy([shot(60, "video", 9), shot(300), shot(600)], NOW, THRESHOLD), false);
});

test("isBusy: единственный свежий рабочий снимок → занят", () => {
  assert.equal(isBusy([shot(120)], NOW, THRESHOLD), true);
  assert.equal(isBusy([shot(0)], NOW, THRESHOLD), true);
});

test("isBusy: старые снимки и снимки после «сейчас» не учитываются", () => {
  assert.equal(isBusy([shot(60), shot(1200, "social", 1)], NOW, THRESHOLD), true);
  assert.equal(isBusy([shot(-60)], NOW, THRESHOLD), false);
  assert.equal(isBusy([shot(-60, "social", 1), shot(60)], NOW, THRESHOLD), true);
  assert.equal(isBusy([shot(-60), shot(60, "social", 1)], NOW, THRESHOLD), false);
});

test("isBusy: рабочая категория с оценкой ниже порога — не работа", () => {
  assert.equal(isBusy([shot(60, "code", 5)], NOW, THRESHOLD), false);
  assert.equal(isBusy([shot(60, "code", 6)], NOW, THRESHOLD), true);
  assert.equal(isBusy([shot(60), shot(300, "code", 5.9), shot(600)], NOW, THRESHOLD), false);
});

const SETTINGS: ReportSettings = {
  nudgeHour: 14,
  minScreenshots: 5,
  hasQuestionHabit: true,
};

/** День, в который пора писать: снимков хватает, не занят, ничего не отмечено. */
const READY: DailyFacts = { screenshotsToday: 12, busy: false, stepDoneToday: false, questionHabitDoneToday: false };

/** Часы для решения: дата и час задаются прямо, без пересчёта из эпохи. */
function clockAt(dateKey: string, hour: number): ReportClock {
  return { dateKey, hour };
}

function weeklyMarker(dateKey: string): string {
  return `goal-weekly-${lastFinishedWeek(dateKey).startKey}`;
}

function decide(
  dateKey: string,
  hour: number,
  overrides: {
    settings?: Partial<ReportSettings>;
    daily?: Partial<DailyFacts>;
    markers?: string[];
    streakEvent?: "freeze_used" | "streak_broken" | null;
  } = {},
) {
  return decideReport({
    clock: clockAt(dateKey, hour),
    settings: { ...SETTINGS, ...overrides.settings },
    daily: { ...READY, ...overrides.daily },
    streakEvent: overrides.streakEvent,
    // По умолчанию итог прошлой недели уже отправлен — иначе он перекрывал бы дневное сообщение.
    existingMarkers: new Set(overrides.markers ?? [weeklyMarker(dateKey)]),
  });
}

const TUESDAY = "2026-10-06";
const NONE = { kind: "none" };

test("decideReport: дневное сообщение уходит в любой день недели, включая субботу и воскресенье", () => {
  for (let offset = 0; offset < 7; offset += 1) {
    const dateKey = addDays("2026-10-05", offset);
    assert.deepEqual(decide(dateKey, 15), { kind: "daily", marker: `goal-daily-${dateKey}`, emptyDay: true }, dateKey);
  }
});

test("decideReport: раньше nudge_hour молчим, с этого часа пишем", () => {
  assert.deepEqual(decide(TUESDAY, 13), NONE);
  assert.equal(decide(TUESDAY, 14).kind, "daily");
  assert.deepEqual(decide(TUESDAY, 16, { settings: { nudgeHour: 17 } }), NONE);
});

test("decideReport: с 22:00 молчим", () => {
  assert.equal(decide(TUESDAY, 21).kind, "daily");
  assert.deepEqual(decide(TUESDAY, 22), NONE);
  assert.deepEqual(decide(TUESDAY, 23), NONE);
});

test("decideReport: снимков меньше min_screenshots → молчим", () => {
  assert.deepEqual(decide(TUESDAY, 15, { daily: { screenshotsToday: 4 } }), NONE);
  assert.equal(decide(TUESDAY, 15, { daily: { screenshotsToday: 5 } }).kind, "daily");
});

test("decideReport: занят делом → молчим без метки, чтобы проверить на следующем проходе", () => {
  assert.deepEqual(decide(TUESDAY, 15, { daily: { busy: true } }), NONE);
});

test("decideReport: английский уже отмечен → молчим и ставим метку дня", () => {
  const silent = { kind: "silent", marker: `goal-daily-${TUESDAY}` };
  assert.deepEqual(decide(TUESDAY, 15, { daily: { questionHabitDoneToday: true, stepDoneToday: true } }), silent);
  // Метка ставится, даже если снимков мало или пользователь занят: писать сегодня всё равно не о чем.
  assert.deepEqual(decide(TUESDAY, 15, { daily: { questionHabitDoneToday: true, busy: true, screenshotsToday: 0 } }), silent);
  // Но не раньше nudge_hour: до него дневная ветка ничего не решает.
  assert.deepEqual(decide(TUESDAY, 10, { daily: { questionHabitDoneToday: true } }), NONE);
});

test("decideReport: без привычки с вопросом сообщение уходит только в пустой день", () => {
  const settings = { hasQuestionHabit: false };
  assert.deepEqual(decide(TUESDAY, 15, { settings, daily: { stepDoneToday: true } }), {
    kind: "silent",
    marker: `goal-daily-${TUESDAY}`,
  });
  assert.deepEqual(decide(TUESDAY, 15, { settings }), { kind: "daily", marker: `goal-daily-${TUESDAY}`, emptyDay: true });
  // Отметка английского без самой привычки в настройках ничего не значит.
  assert.equal(decide(TUESDAY, 15, { settings, daily: { questionHabitDoneToday: true } }).kind, "daily");
});

test("decideReport: метка дня уже стоит → молчим", () => {
  const markers = [weeklyMarker(TUESDAY), `goal-daily-${TUESDAY}`];
  assert.deepEqual(decide(TUESDAY, 15, { markers }), NONE);
  assert.deepEqual(decide(TUESDAY, 15, { markers, daily: { questionHabitDoneToday: true } }), NONE);
  // Вчерашняя метка сегодняшнему дню не мешает.
  assert.equal(decide(TUESDAY, 15, { markers: [weeklyMarker(TUESDAY), "goal-daily-2026-10-05"] }).kind, "daily");
});

test("decideReport: emptyDay повторяет stepDoneToday", () => {
  assert.deepEqual(decide(TUESDAY, 15, { daily: { stepDoneToday: false } }), {
    kind: "daily",
    marker: `goal-daily-${TUESDAY}`,
    emptyDay: true,
  });
  assert.deepEqual(decide(TUESDAY, 15, { daily: { stepDoneToday: true } }), {
    kind: "daily",
    marker: `goal-daily-${TUESDAY}`,
    emptyDay: false,
  });
});

test("decideReport: итог недели уходит на первом проходе после 09:00 в любой день", () => {
  const weekly = { kind: "weekly", marker: "goal-weekly-2026-09-28" };
  assert.deepEqual(decide("2026-10-07", 8, { markers: [] }), NONE);
  assert.deepEqual(decide("2026-10-05", 9, { markers: [] }), weekly);
  // Ноутбук открыли только в среду — итог уходит в среду и считает прошлую неделю.
  assert.deepEqual(decide("2026-10-07", 10, { markers: [] }), weekly);
  assert.deepEqual(decide("2026-10-11", 21, { markers: [] }), weekly);
  // Метка позапрошлой недели прошлую не закрывает.
  assert.deepEqual(decide("2026-10-07", 10, { markers: ["goal-weekly-2026-09-21"] }), weekly);
});

test("decideReport: с 22:00 не уходят ни итог недели, ни проверка плана", () => {
  assert.deepEqual(decide("2026-10-07", 22, { markers: [] }), NONE);
  assert.deepEqual(decide("2026-10-07", 23, { markers: [] }), NONE);
  const review = { settings: { reviewDate: "2026-10-07" } };
  assert.deepEqual(decide("2026-10-07", 21, review), { kind: "review", marker: "goal-review-2026-10-07" });
  assert.deepEqual(decide("2026-10-07", 22, review), NONE);
});

test("decideReport: метка недели стоит → дальше обычная дневная логика", () => {
  assert.deepEqual(decide("2026-10-07", 10), NONE);
  assert.deepEqual(decide("2026-10-07", 15), { kind: "daily", marker: "goal-daily-2026-10-07", emptyDay: true });
});

test("decideReport: проверка плана уходит в свой день или в первый день после него", () => {
  const settings = { reviewDate: "2026-11-05" };
  const review = { kind: "review", marker: "goal-review-2026-11-05" };
  assert.deepEqual(decide("2026-11-05", 10, { settings }), review);
  assert.deepEqual(decide("2026-11-08", 10, { settings }), review);
  // До дня проверки и раньше 09:00 — нет.
  assert.equal(decide("2026-11-04", 15, { settings }).kind, "daily");
  assert.deepEqual(decide("2026-11-05", 8, { settings }), NONE);
  // Метка проверки стоит — второй раз не шлём.
  const markers = [weeklyMarker("2026-11-08"), "goal-review-2026-11-05"];
  assert.equal(decide("2026-11-08", 15, { settings, markers }).kind, "daily");
});

test("decideReport: за один запуск одно сообщение — итог недели, потом проверка, потом день", () => {
  const dateKey = "2026-11-05";
  const settings = { reviewDate: dateKey };
  const weekly = weeklyMarker(dateKey);
  const review = `goal-review-${dateKey}`;
  const daily = `goal-daily-${dateKey}`;
  assert.deepEqual(decide(dateKey, 15, { settings, markers: [] }), { kind: "weekly", marker: weekly });
  assert.deepEqual(decide(dateKey, 15, { settings, markers: [weekly] }), { kind: "review", marker: review });
  assert.deepEqual(decide(dateKey, 15, { settings, markers: [weekly, review] }), { kind: "daily", marker: daily, emptyDay: true });
  assert.deepEqual(decide(dateKey, 15, { settings, markers: [weekly, review, daily] }), NONE);
});

const EMPTY_DAY_OPENINGS = [
  "Сегодня пока ничего не отмечено. Хватит 10 минут английского вслух.",
  "День ещё открыт. 10 минут английского вслух — и он засчитан.",
  "Можно начать с малого: 10 минут английского вслух.",
];

const QUESTION: DailyQuestion = {
  situation: "Your team ships a feature tomorrow. You notice a rare bug that nobody else has seen.",
  question: "Do you delay the release or ship it and fix the bug later?",
  opener: "Honestly, I would … because …",
  why: "правка теста для чтения настроек",
  followups: ["Who should make this decision?", "What if the bug costs you a customer?"],
  source: "llm",
};

/** Строки вопроса в сообщении за вторник 6 октября, в порядке появления. */
const QUESTION_LINES = [
  "Your team ships a feature tomorrow. You notice a rare bug that nobody else has seen.",
  "Do you delay the release or ship it and fix the bug later?",
  "Начни так: Honestly, I would … because …",
  `Скажи ИИ: ${partnerInstruction("2026-10-06")}`,
  "С чем связан: правка теста для чтения настроек",
  "Дальше можно спросить: 1) Who should make this decision? 2) What if the bug costs you a customer?",
];

const FIRST_ACTION = "английский вслух с ИИ";

/** Текст цельный: ни пустых строк, ни пробелов на концах строк. */
function assertWellFormed(text: string): void {
  for (const line of text.split("\n")) {
    assert.notEqual(line, "", `пустая строка в тексте:\n${text}`);
    assert.equal(line, line.trim(), `пробелы по краям строки «${line}»`);
  }
}

test("dailyText: три начала пустого дня сменяются по дням", () => {
  const openings = [0, 1, 2, 3].map((offset) =>
    dailyText({ dateKey: addDays(TUESDAY, offset), emptyDay: true, firstAction: FIRST_ACTION, question: null }),
  );
  assert.deepEqual([...openings.slice(0, 3)].sort(), [...EMPTY_DAY_OPENINGS].sort());
  // Круг из трёх: на четвёртый день снова первое начало; один и тот же день — один и тот же текст.
  assert.equal(openings[3], openings[0]);
  assert.equal(dailyText({ dateKey: TUESDAY, emptyDay: true, firstAction: FIRST_ACTION, question: null }), openings[0]);
});

test("dailyText: пустой день с вопросом", () => {
  const text = dailyText({ dateKey: TUESDAY, emptyDay: true, firstAction: FIRST_ACTION, question: QUESTION });
  const [opening, ...rest] = text.split("\n");
  assert.ok(EMPTY_DAY_OPENINGS.includes(opening));
  assert.deepEqual(rest, QUESTION_LINES);
  assertWellFormed(text);
});

test("dailyText: непустой день с вопросом", () => {
  assert.equal(
    dailyText({ dateKey: TUESDAY, emptyDay: false, firstAction: FIRST_ACTION, question: QUESTION }),
    ["Вопрос дня для английского вслух.", ...QUESTION_LINES].join("\n"),
  );
});

test("dailyText: непустой день без вопроса называет первый шаг", () => {
  assert.equal(
    dailyText({ dateKey: TUESDAY, emptyDay: false, firstAction: FIRST_ACTION, question: null }),
    "Английский вслух сегодня ещё не отмечен. Хватит 10 минут: английский вслух с ИИ.",
  );
});

test("dailyText: вопрос без пояснения или без продолжений остаётся цельным", () => {
  const head = ["Вопрос дня для английского вслух.", ...QUESTION_LINES.slice(0, 4)];
  const text = (question: DailyQuestion) => dailyText({ dateKey: TUESDAY, emptyDay: false, firstAction: FIRST_ACTION, question });

  const noWhy = text({ ...QUESTION, why: "" });
  assert.deepEqual(noWhy.split("\n"), [...head, QUESTION_LINES[5]]);

  const noFollowups = text({ ...QUESTION, followups: [] });
  assert.deepEqual(noFollowups.split("\n"), [...head, QUESTION_LINES[4]]);

  // Один вопрос для продолжения строку «1) … 2) …» не собирает.
  const oneFollowup = text({ ...QUESTION, followups: ["Who should make this decision?"] });
  assert.deepEqual(oneFollowup.split("\n"), [...head, QUESTION_LINES[4]]);

  // Запасной вопрос из файла: ни ситуации, ни своей первой фразы — но начать всё равно есть с чего.
  const bare = text({ situation: "", question: QUESTION.question, opener: "", why: "", followups: [], source: "fallback" });
  assert.deepEqual(bare.split("\n"), [
    "Вопрос дня для английского вслух.",
    QUESTION.question,
    "Начни так: Honestly, I think … because …",
    QUESTION_LINES[3],
  ]);

  for (const value of [noWhy, noFollowups, oneFollowup, bare]) assertWellFormed(value);
});

test("dailyText: строка серии идёт последней, а без неё текст не меняется", () => {
  const streakLine = "Серия 7 · заморозок 1 из 2";
  const base = { dateKey: TUESDAY, firstAction: FIRST_ACTION };
  for (const variant of [
    { emptyDay: true, question: QUESTION },
    { emptyDay: true, question: null },
    { emptyDay: false, question: QUESTION },
    { emptyDay: false, question: null },
  ]) {
    const plain = dailyText({ ...base, ...variant });
    assert.equal(dailyText({ ...base, ...variant, streakLine }), `${plain}\n${streakLine}`);
    assertWellFormed(plain);
  }
});

const WEEK: WeekFacts = {
  startKey: "2026-09-28",
  endKey: "2026-10-04",
  nonEmptyDays: 6,
  weekdayNonEmpty: 4,
  weekendNonEmpty: 2,
  englishDays: 3,
  screenHoursWeekday: 4.1,
  screenHoursWeekend: 2,
  workHoursWeekday: 1.52,
  workHoursWeekend: 0.33,
  topNonWork: [
    { category: "social", hours: 3.2 },
    { category: "video", hours: 2 },
    { category: "gaming", hours: 0.5 },
  ],
};

test("weeklyText: полный итог недели, часы с запятой и одним знаком", () => {
  assert.equal(
    weeklyText(WEEK),
    [
      "Итог недели 28.09–04.10.",
      "Непустых дней: 6 из 7 (будни 4 из 5, выходные 2 из 2).",
      "Английский вслух: 3 дня.",
      "За экраном в день: будни 4,1 ч, выходные 2,0 ч; из них работа: 1,5 ч и 0,3 ч.",
      "Не работа, больше всего: social 3,2 ч, video 2,0 ч, gaming 0,5 ч.",
      "Планка: можно прибавить 5 минут к первому шагу.",
    ].join("\n"),
  );
});

test("weeklyText: слово «день» склоняется по числу", () => {
  const englishLine = (englishDays: number): string =>
    weeklyText({ ...WEEK, englishDays }).split("\n").find((line) => line.startsWith("Английский вслух")) ?? "";
  assert.equal(englishLine(0), "Английский вслух: 0 дней.");
  assert.equal(englishLine(1), "Английский вслух: 1 день.");
  assert.equal(englishLine(2), "Английский вслух: 2 дня.");
  assert.equal(englishLine(4), "Английский вслух: 4 дня.");
  assert.equal(englishLine(5), "Английский вслух: 5 дней.");
  assert.equal(englishLine(7), "Английский вслух: 7 дней.");
});

test("weeklyText: без привычки с вопросом строки про английский нет", () => {
  const lines = weeklyText({ ...WEEK, englishDays: null }).split("\n");
  assert.equal(lines.length, 5);
  assert.equal(lines.some((line) => line.startsWith("Английский вслух")), false);
  // Ноль дней — это число, строка остаётся.
  assert.ok(weeklyText({ ...WEEK, englishDays: 0 }).split("\n").includes("Английский вслух: 0 дней."));
});

test("weeklyText: строка «не работа» только из ненулевых записей, без них её нет", () => {
  const empty = weeklyText({ ...WEEK, topNonWork: [] });
  assert.equal(empty.includes("Не работа"), false);
  assertWellFormed(empty);

  const zeros = weeklyText({ ...WEEK, topNonWork: [{ category: "news", hours: 0 }] });
  assert.equal(zeros.includes("Не работа"), false);

  const one = weeklyText({ ...WEEK, topNonWork: [{ category: "social", hours: 1.5 }, { category: "video", hours: 0 }] });
  assert.ok(one.split("\n").includes("Не работа, больше всего: social 1,5 ч."));
});

test("weeklyText: три подсказки про планку по числу непустых дней", () => {
  const hint = (nonEmptyDays: number): string => weeklyText({ ...WEEK, nonEmptyDays }).split("\n").at(-1) ?? "";
  assert.equal(hint(7), "Планка: можно прибавить 5 минут к первому шагу.");
  assert.equal(hint(6), "Планка: можно прибавить 5 минут к первому шагу.");
  assert.equal(hint(5), "Планка: оставь как есть.");
  assert.equal(hint(4), "Планка: оставь как есть.");
  assert.equal(hint(3), "Планка: уменьши первый шаг вдвое, это нормально.");
  assert.equal(hint(0), "Планка: уменьши первый шаг вдвое, это нормально.");
});

test("weeklyText: строка серии стоит перед подсказкой про планку", () => {
  const streakLine = "Серия: 7, заморозок 1 из 2.";
  const plain = weeklyText(WEEK).split("\n");
  assert.deepEqual(weeklyText(WEEK, streakLine).split("\n"), [...plain.slice(0, -1), streakLine, plain.at(-1)]);
});

test("weeklyText: нулевая неделя остаётся цельной", () => {
  const text = weeklyText({
    ...WEEK,
    nonEmptyDays: 0,
    weekdayNonEmpty: 0,
    weekendNonEmpty: 0,
    englishDays: null,
    screenHoursWeekday: 0,
    screenHoursWeekend: 0,
    workHoursWeekday: 0,
    workHoursWeekend: 0,
    topNonWork: [],
  });
  assert.deepEqual(text.split("\n"), [
    "Итог недели 28.09–04.10.",
    "Непустых дней: 0 из 7 (будни 0 из 5, выходные 0 из 2).",
    "За экраном в день: будни 0,0 ч, выходные 0,0 ч; из них работа: 0,0 ч и 0,0 ч.",
    "Планка: уменьши первый шаг вдвое, это нормально.",
  ]);
});

test("reviewText: с английским и без него", () => {
  assert.equal(
    reviewText({ englishDays: 5, nonEmptyDays: 9, weekendNonEmpty: 3 }),
    "Сегодня проверка плана. За последние 14 дней: английский вслух 5 (перед стартом 0, лучшие две недели 7), непустых 9 (было в среднем 11), из них выходных 3 из 4. Открой план, раздел 6.",
  );
  assert.equal(
    reviewText({ englishDays: null, nonEmptyDays: 9, weekendNonEmpty: 3 }),
    "Сегодня проверка плана. За последние 14 дней: непустых 9 (было в среднем 11), из них выходных 3 из 4. Открой план, раздел 6.",
  );
});

test("topNonWork: без работы и communication, по убыванию, нули отброшены", () => {
  const minutes = { code: 600, research: 300, design: 90, writing: 45, communication: 500, social: 190, video: 120, gaming: 31, news: 2, idle: 0 };
  assert.deepEqual(topNonWork(minutes), [
    { category: "social", hours: 3.2 },
    { category: "video", hours: 2 },
    { category: "gaming", hours: 0.5 },
  ]);
  assert.deepEqual(topNonWork(minutes, 1), [{ category: "social", hours: 3.2 }]);
  // Две минуты округляются до 0,0 ч — такая запись в текст не идёт, даже если места хватает.
  assert.equal(topNonWork(minutes, 10).length, 3);
  assert.deepEqual(topNonWork({ code: 600, communication: 30 }), []);
  assert.deepEqual(topNonWork({}), []);
});

// ---------- серия с заморозками (шаг 4) ----------

test("decideReport: событие серии уходит первым, после 09:00 и один раз в день", () => {
  const event = { streakEvent: "freeze_used" as const };
  const streak = { kind: "streak", marker: "goal-streak-2026-10-07" };
  // Раньше итога недели и раньше дневного сообщения.
  assert.deepEqual(decide("2026-10-07", 10, { ...event, markers: [] }), streak);
  assert.deepEqual(decide("2026-10-07", 15, event), streak);
  assert.deepEqual(decide("2026-10-07", 15, { streakEvent: "streak_broken" }), streak);
  // До 09:00 и с 22:00 — молчим.
  assert.deepEqual(decide("2026-10-07", 8, event), NONE);
  assert.deepEqual(decide("2026-10-07", 22, event), NONE);
  // Метка события стоит — дальше обычный порядок.
  const sent = [weeklyMarker("2026-10-07"), "goal-streak-2026-10-07"];
  assert.deepEqual(decide("2026-10-07", 15, { ...event, markers: sent }), {
    kind: "daily",
    marker: "goal-daily-2026-10-07",
    emptyDay: true,
  });
  // События нет — как раньше.
  assert.deepEqual(decide("2026-10-07", 10, { streakEvent: null, markers: [] }), {
    kind: "weekly",
    marker: "goal-weekly-2026-09-28",
  });
});

test("streakLine: серия и заморозки одной строкой", () => {
  assert.equal(streakLine({ streak: 6, freezes: 2 }, 2), "Серия 6 · заморозок 2 из 2");
  assert.equal(streakLine({ streak: 0, freezes: 1 }, 2), "Серия 0 · заморозок 1 из 2");
});

test("streakEventText: заморозка, обрыв серии и отсутствие события", () => {
  assert.equal(
    streakEventText({ streak: 6, freezes: 1, lastEvent: "freeze_used", streakBeforeLastDay: 6 }),
    "По отметкам вчера пусто: сработала заморозка, серия 6 цела, осталось 1. Придёт отметка позже — пересчитается само.",
  );
  assert.equal(
    streakEventText({ streak: 0, freezes: 0, lastEvent: "streak_broken", streakBeforeLastDay: 6 }),
    "По отметкам вчера пусто, заморозок нет: серия 6 прервана. Придёт отметка за вчера — серия вернётся.",
  );
  assert.equal(streakEventText({ streak: 3, freezes: 1, lastEvent: null, streakBeforeLastDay: 2 }), null);
});

test("dailyText: начало «Серия N ждёт» есть в круге только при серии больше нуля", () => {
  const base = { emptyDay: true, firstAction: "английский вслух с ИИ", question: null };
  const openings = (streak: number | undefined): Set<string> =>
    new Set(
      Array.from({ length: 12 }, (_, i) => dailyText({ ...base, dateKey: addDays("2026-10-06", i), streak }).split("\n")[0]),
    );
  const waiting = "Серия 4 ждёт. 10 минут английского вслух.";
  assert.equal(openings(4).size, 4);
  assert.equal(openings(4).has(waiting), true);
  // Серии нет или она нулевая — круг из трёх прежних начал.
  assert.equal(openings(0).size, 3);
  assert.equal(openings(undefined).size, 3);
  assert.equal([...openings(0)].some((line) => line.startsWith("Серия")), false);
  // В непустой день начало от серии не зависит.
  assert.equal(
    dailyText({ ...base, emptyDay: false, dateKey: "2026-10-06", streak: 4 }).split("\n")[0],
    "Английский вслух сегодня ещё не отмечен. Хватит 10 минут: английский вслух с ИИ.",
  );
});

test("renderStreakDays: # — непустой день, . — пустой", () => {
  assert.equal(renderStreakDays([true, true, false, true]), "##.#");
  assert.equal(renderStreakDays([]), "");
});

// ---------- привычки из настроек против активных в базе ----------

test("resolveHabits: все привычки из списка неактивны → null (файл негоден)", () => {
  assert.equal(resolveHabits(["walk", "anki"], "talk", new Set(["talk"])), null);
  assert.equal(resolveHabits(["walk"], undefined, new Set()), null);
});

test("resolveHabits: неактивная привычка из списка пропускается, порядок остальных сохраняется", () => {
  assert.deepEqual(resolveHabits(["walk", "old", "anki"], "talk", new Set(["walk", "anki", "talk"])), {
    stepIds: ["walk", "anki"],
    questionId: "talk",
  });
});

test("resolveHabits: привычка с вопросом неактивна или не задана → questionId нет", () => {
  assert.deepEqual(resolveHabits(["walk"], "talk", new Set(["walk"])), { stepIds: ["walk"], questionId: undefined });
  assert.deepEqual(resolveHabits(["walk"], undefined, new Set(["walk"])), { stepIds: ["walk"], questionId: undefined });
});

// ---------- как начать разговор ----------

test("partnerInstruction: готовая фраза для ИИ, роль собеседника меняется по дням", () => {
  const days = Array.from({ length: 6 }, (_, i) => partnerInstruction(addDays("2026-10-06", i)));
  for (const line of days) {
    assert.match(line, /^Let's discuss this in English for 10 minutes\. .+ Ask me one question at a time and correct my mistakes briefly\.$/);
  }
  assert.equal(new Set(days).size, 3);
  assert.notEqual(days[0], days[1]);
  assert.equal(days[0], days[3]);
});
