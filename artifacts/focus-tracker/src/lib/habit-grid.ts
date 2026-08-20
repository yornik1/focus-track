export type HabitSource = "auto" | "manual";

export interface HabitCell {
  date: string;
  habit: string;
  done: boolean;
  source: HabitSource;
  updated_at: string;
}

export interface HabitGridDay {
  date: string;
  weekday: string;
  dayOfMonth: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface HabitGridWeek {
  startDate: string;
  days: HabitGridDay[];
}

export interface HabitGridUpdate {
  date: string;
  habit: string;
  done: boolean;
}

export type HabitDropPosition = "before" | "after";

const KYIV_TIME_ZONE = "Europe/Kiev";
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dateParts(dateKey: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addCivilDays(dateKey: string, days: number): string {
  const { year, month, day } = dateParts(dateKey);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

function utcDayOfWeek(dateKey: string): number {
  const { year, month, day } = dateParts(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function toKievDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return formatDateKey(Number(values.year), Number(values.month), Number(values.day));
}

export function formatHabitDateLabel(dateKey: string, locale?: string | string[]): string {
  const { year, month, day } = dateParts(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    timeZone: KYIV_TIME_ZONE,
  });
}

export function buildHabitGridWeeks(now = new Date()): HabitGridWeek[] {
  const todayKey = toKievDateKey(now);
  const todayDow = utcDayOfWeek(todayKey);
  const daysSinceMonday = todayDow === 0 ? 6 : todayDow - 1;
  const currentMonday = addCivilDays(todayKey, -daysSinceMonday);
  const firstMonday = addCivilDays(currentMonday, -21);

  return Array.from({ length: 4 }, (_, weekIndex) => {
    const startDate = addCivilDays(firstMonday, weekIndex * 7);
    return {
      startDate,
      days: Array.from({ length: 7 }, (_, dayIndex) => {
        const date = addCivilDays(startDate, dayIndex);
        const { day } = dateParts(date);
        return {
          date,
          weekday: WEEKDAY_LABELS[dayIndex],
          dayOfMonth: day,
          isToday: date === todayKey,
          isFuture: date > todayKey,
        };
      }),
    };
  });
}

export function getHabitCell(entries: HabitCell[], habit: string, date: string): HabitCell | undefined {
  return entries.find((entry) => entry.habit === habit && entry.date === date);
}

export function upsertHabitCell(entries: HabitCell[], cell: HabitCell): HabitCell[] {
  const index = entries.findIndex((entry) => entry.habit === cell.habit && entry.date === cell.date);
  if (index === -1) return [...entries, cell];
  return entries.map((entry, entryIndex) => (entryIndex === index ? cell : entry));
}

export function applyOptimisticHabitUpdate(
  entries: HabitCell[],
  update: HabitGridUpdate,
  updatedAt: string,
): HabitCell[] {
  return upsertHabitCell(entries, {
    ...update,
    source: "manual",
    updated_at: updatedAt,
  });
}

export function moveHabitId(
  ids: string[],
  sourceId: string,
  targetId: string,
  position: HabitDropPosition,
): string[] {
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return ids;

  const withoutSource = ids.filter((id) => id !== sourceId);
  const adjustedTargetIndex = withoutSource.indexOf(targetId);
  const insertIndex = adjustedTargetIndex + (position === "after" ? 1 : 0);
  if (insertIndex === sourceIndex) return ids;

  const reordered = [...withoutSource];
  reordered.splice(insertIndex, 0, sourceId);
  return reordered;
}
