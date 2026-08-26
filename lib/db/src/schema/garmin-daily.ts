import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Дневная сводка Garmin, импортированная из vault-журналов (~/me/journal/activity).
 * Сервер сам Garmin не читает — таблицу наполняет импортёр (scripts/import-garmin).
 */
export const garminDailyTable = sqliteTable(
  "garmin_daily",
  {
    date: text("date").primaryKey(),
    steps: integer("steps"),
    sleep_minutes: integer("sleep_minutes"),
    resting_hr: integer("resting_hr"),
    source: text("source").notNull().default("garmin"),
    updated_at: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => ({
    validDate: check(
      "garmin_daily_date_valid",
      sql`${table.date} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(${table.date}, '+0 days') = ${table.date}`,
    ),
  }),
);

export type GarminDaily = typeof garminDailyTable.$inferSelect;
