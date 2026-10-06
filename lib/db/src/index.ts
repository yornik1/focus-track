export { db, sqliteConnection } from "./connection";
export * from "./schema";
export * from "./app-settings";
export * from "./goal-settings";
export * from "./category-queries";
export * from "./focus-workspace";
export { initializeFocusWorkspaceSchema } from "./focus-workspace-migration";
export { ALLOWED_CATEGORIES, PRODUCTIVE_CATEGORIES, PRODUCTIVE_DAY_MINUTES, isProductiveCategory, normalizeCategory, buildAnalysisPrompt } from "@workspace/categories";
export {
  DEEP_WORK_CATEGORIES,
  isDeepWorkCategory,
  FOCUS_FLOOR_MINUTES,
  FOCUS_TARGET_CAP_MINUTES,
  computeFocusSessions,
  summarizeDailyFocus,
  nextFocusTarget,
  medianActiveBest,
} from "@workspace/categories";
export type { FocusPoint, FocusSession, FocusSessionOptions, DailyFocusSummary } from "@workspace/categories";
export {
  pearson,
  wowDelta,
  mondayOf,
  addDays as addDaysStr,
  weekBounds,
  computeEffort,
} from "@workspace/categories";
export type { WeeklyEffort } from "@workspace/categories";
