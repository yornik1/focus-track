import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const focusDirectionsTable = sqliteTable("focus_directions", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  weekly_target_minutes: integer("weekly_target_minutes"),
  archived_at: integer("archived_at"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const focusWorkSessionsTable = sqliteTable(
  "focus_work_sessions",
  {
    id: text("id").primaryKey(),
    request_id: text("request_id").notNull(),
    direction_id: text("direction_id")
      .notNull()
      .references(() => focusDirectionsTable.id),
    intention: text("intention"),
    planned_minutes: integer("planned_minutes").notNull(),
    started_at: integer("started_at").notNull(),
    planned_end_at: integer("planned_end_at").notNull(),
    ended_at: integer("ended_at"),
    status: text("status", { enum: ["running", "completed", "cancelled"] }).notNull(),
    completion_reason: text("completion_reason", { enum: ["deadline", "manual"] }),
    result_note: text("result_note"),
    self_rating: integer("self_rating"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("focus_work_sessions_request_id_uq").on(table.request_id)],
);

export type FocusDirection = typeof focusDirectionsTable.$inferSelect;
export type FocusWorkSession = typeof focusWorkSessionsTable.$inferSelect;

