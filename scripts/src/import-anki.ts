#!/usr/bin/env node
/**
 * Импорт дневной активности Anki (revlog) в focus.db (таблица anki_daily).
 *
 *   pnpm --filter @workspace/scripts run import:anki [--days 120]
 *
 * Живую коллекцию НИКОГДА не трогаем — Anki держит её открытой (-wal/-shm),
 * чтение извне рвёт базу. Работаем по копии в tmp (правило из skill `anki`).
 * Путь к коллекции: $ANKI_COLLECTION (по умолчанию стандартный macOS-путь).
 */
import "dotenv/config";
import { copyFileSync, existsSync, rmSync } from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { db, ankiDailyTable } from "@workspace/db";
import { aggregateRevlog, type RevlogRow } from "./lib/anki-aggregate";

function parseDays(argv: string[]): number {
  const idx = argv.indexOf("--days");
  if (idx >= 0 && argv[idx + 1]) {
    const n = Number(argv[idx + 1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 120;
}

function defaultCollectionPath(): string {
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Anki2",
    "User 1",
    "collection.anki2",
  );
}

function main() {
  const days = parseDays(process.argv.slice(2));
  const src = process.env.ANKI_COLLECTION || defaultCollectionPath();

  if (!existsSync(src)) {
    console.error(`[import-anki] коллекция не найдена: ${src}`);
    process.exit(1);
  }

  const tmp = path.join(os.tmpdir(), `focus-anki-${process.pid}.anki2`);
  copyFileSync(src, tmp);

  let rows: RevlogRow[];
  try {
    // revlog не ссылается на таблицы с коллацией unicase, поэтому читается напрямую.
    const con = new Database(tmp, { readonly: true, fileMustExist: true });
    const cutoffMs = Date.now() - days * 86_400_000;
    rows = con.prepare("SELECT id, time FROM revlog WHERE id >= ?").all(cutoffMs) as RevlogRow[];
    con.close();
  } finally {
    rmSync(tmp, { force: true });
  }

  const byDate = aggregateRevlog(rows);

  let imported = 0;
  for (const [date, { reviews, seconds }] of byDate) {
    db.insert(ankiDailyTable)
      .values({ date, reviews, seconds, updated_at: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` })
      .onConflictDoUpdate({
        target: ankiDailyTable.date,
        set: { reviews, seconds, updated_at: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` },
      })
      .run();
    imported++;
  }

  console.log(`[import-anki] импортировано дней: ${imported} (окно ${days} дн.)`);
}

main();
