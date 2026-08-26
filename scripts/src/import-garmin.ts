#!/usr/bin/env node
/**
 * Импорт дневных сводок Garmin из vault-журналов в focus.db (таблица garmin_daily).
 * Сервер Garmin не читает — это делает импортёр (граница repo/vault из памяти проекта).
 *
 *   pnpm --filter @workspace/scripts run import:garmin [--days 120]
 *
 * Каталог журналов: $GARMIN_JOURNAL_DIR (по умолчанию ~/me/journal/activity).
 */
import "dotenv/config";
import { readFileSync, readdirSync, existsSync } from "fs";
import os from "os";
import path from "path";
import { sql } from "drizzle-orm";
import { db, garminDailyTable } from "@workspace/db";
import { parseGarminDaily } from "./lib/garmin-parse";

function parseDays(argv: string[]): number {
  const idx = argv.indexOf("--days");
  if (idx >= 0 && argv[idx + 1]) {
    const n = Number(argv[idx + 1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 120;
}

function cutoffDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function main() {
  const days = parseDays(process.argv.slice(2));
  const dir = process.env.GARMIN_JOURNAL_DIR || path.join(os.homedir(), "me", "journal", "activity");

  if (!existsSync(dir)) {
    console.error(`[import-garmin] каталог не найден: ${dir}`);
    process.exit(1);
  }

  const cutoff = cutoffDate(days);
  const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f) && f.slice(0, 10) >= cutoff);

  let imported = 0;
  let skipped = 0;
  for (const file of files) {
    const row = parseGarminDaily(readFileSync(path.join(dir, file), "utf8"));
    if (!row) {
      skipped++;
      continue;
    }
    db.insert(garminDailyTable)
      .values({
        date: row.date,
        steps: row.steps,
        sleep_minutes: row.sleep_minutes,
        resting_hr: row.resting_hr,
        updated_at: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      })
      .onConflictDoUpdate({
        target: garminDailyTable.date,
        set: {
          steps: row.steps,
          sleep_minutes: row.sleep_minutes,
          resting_hr: row.resting_hr,
          updated_at: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        },
      })
      .run();
    imported++;
  }

  console.log(`[import-garmin] импортировано ${imported}, пропущено ${skipped} (окно ${days} дн., ${dir})`);
}

main();
