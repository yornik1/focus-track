import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Дневная сводка Anki по revlog: сколько карточек повторено и сколько времени потрачено.
 * Наполняется импортёром (scripts/import-anki), который читает КОПИЮ коллекции.
 * seconds храним в секундах — минуты выводим в API.
 */
export const ankiDailyTable = sqliteTable(
  "anki_daily",
  {
    date: text("date").primaryKey(),
    reviews: integer("reviews").notNull().default(0),
    seconds: integer("seconds").notNull().default(0),
    updated_at: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => ({
    validDate: check(
      "anki_daily_date_valid",
      sql`${table.date} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(${table.date}, '+0 days') = ${table.date}`,
    ),
  }),
);

export type AnkiDaily = typeof ankiDailyTable.$inferSelect;
