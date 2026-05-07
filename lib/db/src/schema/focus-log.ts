import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";

export const focusLogTable = sqliteTable("focus_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  datetime: text("datetime").notNull(), // ISO 8601 формат
  timestamp: integer("timestamp").notNull(), // Unix timestamp в секундах
  category: text("category").notNull(),
  focus_score: real("focus_score").notNull(), // 0-10
  summary: text("summary").notNull(),
});

export const insertFocusLogSchema = createInsertSchema(focusLogTable).omit({ id: true });

export type InsertFocusLog = typeof focusLogTable.$inferInsert;
export type FocusLog = typeof focusLogTable.$inferSelect;
