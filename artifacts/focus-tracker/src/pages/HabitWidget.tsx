import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getHabits, type HabitsResponse } from "@/api";
import {
  buildHabitGridWeeks,
  getHabitCell,
  toKievDateKey,
  formatHabitDateLabel,
} from "@/lib/habit-grid";

// Отдельная полноэкранная страница-виджет для «новой вкладки» браузера.
// Никакой навигации Focus — только большие стрики и зелёная «цепь», которую жалко рвать.

// Сколько последних дней показывать в полосе-цепи (без будущих).
const CHAIN_DAYS = 14;

interface ChainDay {
  date: string;
  dayOfMonth: number;
  weekday: string;
  done: boolean;
  isToday: boolean;
}

function buildChain(entries: HabitsResponse["entries"], habitId: string, now: Date): ChainDay[] {
  const todayKey = toKievDateKey(now);
  // 4 недели сетки → плоский список дней, отбрасываем будущее, берём хвост.
  const days = buildHabitGridWeeks(now)
    .flatMap((week) => week.days)
    .filter((day) => !day.isFuture)
    .slice(-CHAIN_DAYS);

  return days.map((day) => ({
    date: day.date,
    dayOfMonth: day.dayOfMonth,
    weekday: day.weekday,
    done: getHabitCell(entries, habitId, day.date)?.done === true,
    isToday: day.date === todayKey,
  }));
}

function HabitCard({
  label,
  autoFill,
  streak,
  chain,
}: {
  label: string;
  autoFill: boolean;
  streak: number;
  chain: ChainDay[];
}) {
  const today = chain[chain.length - 1];
  const doneToday = today?.done === true;
  const alive = streak > 0;

  return (
    <div
      className={`flex flex-col gap-5 rounded-3xl border p-6 transition-colors ${
        doneToday
          ? "border-green-500/30 bg-green-500/[0.06]"
          : alive
            ? "border-amber-500/25 bg-amber-500/[0.04]"
            : "border-zinc-800 bg-zinc-900/40"
      }`}
    >
      {/* Заголовок + большой стрик */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-lg font-semibold text-zinc-100">{label}</span>
            {autoFill && (
              <span className="shrink-0 rounded border border-cyan-500/25 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-300">
                auto
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-zinc-500">
            {doneToday ? "done today" : alive ? "keep it alive today" : "start a new streak"}
          </div>
        </div>
        <div className="flex shrink-0 items-baseline gap-1.5">
          <span className={`text-6xl font-bold tabular-nums leading-none ${alive ? "text-green-400" : "text-zinc-600"}`}>
            {streak}
          </span>
          <span className="text-2xl" aria-hidden>
            {alive ? "🔥" : "💤"}
          </span>
        </div>
      </div>

      {/* Полоса-цепь последних дней */}
      <div className="flex items-end gap-1.5">
        {chain.map((day) => {
          const base = "flex-1 rounded-lg transition-all";
          const height = day.isToday ? "h-14" : "h-11";
          const tone = day.done
            ? "bg-green-500 shadow-[0_0_12px_-2px_rgba(34,197,94,0.7)]"
            : "bg-zinc-800";
          const todayRing =
            day.isToday && !day.done ? "ring-2 ring-cyan-400 animate-pulse" : "";
          const todayDone = day.isToday && day.done ? "ring-2 ring-green-300" : "";
          return (
            <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
              <div className={`${base} ${height} ${tone} ${todayRing} ${todayDone} w-full`} title={`${day.date}: ${day.done ? "done" : "missing"}`} />
              <span className={`text-[9px] tabular-nums ${day.isToday ? "text-cyan-300" : "text-zinc-600"}`}>
                {day.dayOfMonth}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function HabitWidget() {
  const now = useMemo(() => new Date(), []);
  const weeks = useMemo(() => buildHabitGridWeeks(now), [now]);
  const days = weeks.flatMap((week) => week.days);
  const from = days[0]?.date ?? "";
  const to = days[days.length - 1]?.date ?? "";

  const { data, isLoading, isError, error } = useQuery<HabitsResponse>({
    queryKey: ["habits-widget", from, to],
    queryFn: () => getHabits(from, to),
    enabled: from.length > 0 && to.length > 0,
    refetchOnWindowFocus: true,
  });

  const habits = data?.habits ?? [];
  const bestStreak = habits.reduce((max, h) => Math.max(max, h.current_streak), 0);
  const todayKey = toKievDateKey(now);
  const leftToday = habits.filter(
    (h) => getHabitCell(data?.entries ?? [], h.id, todayKey)?.done !== true,
  ).length;

  return (
    <div className="min-h-screen bg-[#0a0a0b] px-8 py-10 text-zinc-100">
      <div className="mx-auto max-w-6xl">
        {/* Герой */}
        <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="text-sm uppercase tracking-[0.2em] text-zinc-500">
              {new Date(now).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
            </div>
            <h1 className="mt-2 text-4xl font-bold tracking-tight">
              {leftToday === 0 && habits.length > 0 ? (
                <span className="text-green-400">All done today. Don’t break the chain.</span>
              ) : (
                <>
                  Don’t break the chain.
                </>
              )}
            </h1>
          </div>
          <div className="flex items-center gap-8">
            <div className="text-right">
              <div className="text-5xl font-bold tabular-nums text-green-400">{bestStreak}</div>
              <div className="text-xs uppercase tracking-wide text-zinc-500">best streak 🔥</div>
            </div>
            <div className="text-right">
              <div className={`text-5xl font-bold tabular-nums ${leftToday > 0 ? "text-amber-400" : "text-zinc-600"}`}>
                {leftToday}
              </div>
              <div className="text-xs uppercase tracking-wide text-zinc-500">left today</div>
            </div>
          </div>
        </header>

        {isLoading && <div className="py-20 text-center text-zinc-500">Loading habits…</div>}
        {isError && (
          <div className="py-20 text-center text-red-400">
            {error instanceof Error ? error.message : "Failed to load habits"}
          </div>
        )}

        {!isLoading && !isError && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {habits.map((habit) => (
              <HabitCard
                key={habit.id}
                label={habit.label}
                autoFill={habit.auto_fill}
                streak={habit.current_streak}
                chain={buildChain(data?.entries ?? [], habit.id, now)}
              />
            ))}
          </div>
        )}

        <footer className="mt-10 text-center text-xs text-zinc-600">
          {formatHabitDateLabel(from)} – {formatHabitDateLabel(to)} · open a new tab to check in
        </footer>
      </div>
    </div>
  );
}
