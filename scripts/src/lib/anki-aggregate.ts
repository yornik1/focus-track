/** Чистая свёртка revlog Anki по локальной дате. Без БД и без побочек. */

export interface RevlogRow {
  id: number; // timestamp повторения в мс
  time: number; // затрачено мс
}

export interface AnkiDayAgg {
  reviews: number;
  seconds: number;
}

/** Локальная дата (машинная TZ, как в focus-роутах) из unix-мс. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Свёртка revlog по локальной дате: {reviews, seconds}. */
export function aggregateRevlog(rows: RevlogRow[]): Map<string, AnkiDayAgg> {
  const byDate = new Map<string, AnkiDayAgg>();
  for (const row of rows) {
    const date = localDate(row.id);
    const acc = byDate.get(date) ?? { reviews: 0, seconds: 0 };
    acc.reviews += 1;
    acc.seconds += Math.round(row.time / 1000);
    byDate.set(date, acc);
  }
  return byDate;
}
