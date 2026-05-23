#!/usr/bin/env node
/**
 * Аудит и миграция category в focus_log → канонический список ALLOWED_CATEGORIES.
 *
 *   pnpm --filter @workspace/scripts run categories:migrate        # dry-run
 *   pnpm --filter @workspace/scripts run categories:migrate -- --apply
 */
import "dotenv/config";
import {
  getDistinctCategoriesWithCounts,
  migrateCategoriesToCanonical,
} from "@workspace/db";

const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  const audit = await getDistinctCategoriesWithCounts();

  console.log("Distinct categories in focus_log:\n");
  console.log("category".padEnd(24) + "count".padStart(8) + "  → normalized");
  console.log("-".repeat(56));

  for (const row of audit) {
    const arrow = row.needsUpdate ? "→" : " ";
    const mark = row.needsUpdate ? "*" : " ";
    console.log(
      `${mark}${row.category.padEnd(23)}${String(row.count).padStart(8)}  ${arrow} ${row.normalized}`,
    );
  }

  const exotic = audit.filter((r) => r.needsUpdate);
  console.log(`\n* — нужна миграция (${exotic.length} видов, ${exotic.reduce((s, r) => s + r.count, 0)} записей)`);

  if (exotic.length === 0) {
    console.log("\nВсе категории уже канонические.");
    return;
  }

  const result = await migrateCategoriesToCanonical(!apply);

  if (apply) {
    console.log(`\nОбновлено записей: ${result.updatedRows}`);
    for (const m of result.mappings) {
      console.log(`  ${m.from} → ${m.to} (${m.count})`);
    }
    const after = await getDistinctCategoriesWithCounts();
    const stillExotic = after.filter((r) => r.needsUpdate);
    if (stillExotic.length > 0) {
      console.warn("\nОстались неприведённые категории:", stillExotic.map((r) => r.category).join(", "));
    } else {
      console.log("\nПосле миграции все категории из allowed-списка.");
    }
  } else {
    console.log("\nDry-run. Чтобы записать в БД:");
    console.log("  pnpm --filter @workspace/scripts run categories:migrate -- --apply");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
