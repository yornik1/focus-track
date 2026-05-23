import { sql, gte, eq } from "drizzle-orm";
import { ALLOWED_CATEGORIES, normalizeCategory } from "@workspace/categories";
import { db } from "./connection";
import { focusLogTable } from "./schema/focus-log";

export interface CategoryAuditRow {
  category: string;
  count: number;
  normalized: string;
  needsUpdate: boolean;
}

/** Все distinct-категории в логах с числом записей и канонической формой. */
export async function getDistinctCategoriesWithCounts(): Promise<CategoryAuditRow[]> {
  const rows = await db
    .select({
      category: focusLogTable.category,
      count: sql<number>`cast(count(*) as integer)`.as("count"),
    })
    .from(focusLogTable)
    .groupBy(focusLogTable.category)
    .orderBy(sql`count(*) desc`);

  return rows.map((row) => {
    const normalized = normalizeCategory(row.category);
    return {
      category: row.category,
      count: row.count,
      normalized,
      needsUpdate: row.category !== normalized,
    };
  });
}

export interface CategoryMigrationResult {
  dryRun: boolean;
  audit: CategoryAuditRow[];
  updatedRows: number;
  mappings: Array<{ from: string; to: string; count: number }>;
}

/**
 * Приводит экзотические category в focus_log к ALLOWED_CATEGORIES через normalizeCategory.
 * @param dryRun true — только отчёт, без UPDATE
 */
export async function migrateCategoriesToCanonical(
  dryRun = true,
): Promise<CategoryMigrationResult> {
  const audit = await getDistinctCategoriesWithCounts();
  const toFix = audit.filter((r) => r.needsUpdate);
  const mappings: CategoryMigrationResult["mappings"] = [];
  let updatedRows = 0;

  for (const row of toFix) {
    mappings.push({ from: row.category, to: row.normalized, count: row.count });
    if (!dryRun) {
      await db
        .update(focusLogTable)
        .set({ category: row.normalized })
        .where(eq(focusLogTable.category, row.category));
      updatedRows += row.count;
    } else {
      updatedRows += row.count;
    }
  }

  return { dryRun, audit, updatedRows, mappings };
}

/** Категории в БД, которых нет в ALLOWED_CATEGORIES (до миграции). */
export function isExoticCategory(category: string): boolean {
  return !ALLOWED_CATEGORIES.includes(category as (typeof ALLOWED_CATEGORIES)[number]);
}

/** Топ канонических категорий по числу записей за последние N дней. */
export async function getTopCategoriesFromLogs(limit = 5, daysBack = 30): Promise<string[]> {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceIso = since.toISOString();

  const rows = await db
    .select({
      category: focusLogTable.category,
      count: sql<number>`cast(count(*) as integer)`.as("count"),
    })
    .from(focusLogTable)
    .where(gte(focusLogTable.datetime, sinceIso))
    .groupBy(focusLogTable.category)
    .orderBy(sql`count(*) desc`)
    .limit(limit * 3);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of rows) {
    const norm = normalizeCategory(row.category);
    if (seen.has(norm)) continue;
    seen.add(norm);
    result.push(norm);
    if (result.length >= limit) break;
  }
  return result;
}
