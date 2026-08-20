import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const habitDefinitionsTable = sqliteTable("habit_definitions", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  auto_fill: integer("auto_fill", { mode: "boolean" }).notNull().default(false),
  category: text("category"),
  sort_order: integer("sort_order").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  created_at: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updated_at: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const habitsTable = sqliteTable(
  "habits",
  {
    date: text("date").notNull(),
    habit: text("habit").notNull(),
    done: integer("done", { mode: "boolean" }).notNull(),
    source: text("source", { enum: ["auto", "manual"] }).notNull().default("manual"),
    updated_at: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.date, table.habit] }),
    validDate: check(
      "habits_date_valid",
      sql`${table.date} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(${table.date}, '+0 days') = ${table.date}`,
    ),
  }),
);

export const habitEventsTable = sqliteTable("habit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  habit: text("habit").notNull(),
  old_done: integer("old_done", { mode: "boolean" }),
  new_done: integer("new_done", { mode: "boolean" }).notNull(),
  old_source: text("old_source", { enum: ["auto", "manual"] }),
  new_source: text("new_source", { enum: ["auto", "manual"] }).notNull(),
  actor: text("actor", { enum: ["auto", "manual"] }).notNull(),
  changed_at: text("changed_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export type HabitDefinition = typeof habitDefinitionsTable.$inferSelect;
export type HabitCell = typeof habitsTable.$inferSelect;
export type HabitEvent = typeof habitEventsTable.$inferSelect;
