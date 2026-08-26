/**
 * Чистый парсер дневного блока Garmin из vault-журнала (~/me/journal/activity/<date>.md).
 * Формат файла:
 *
 *   ## Daily (garmin_daily)
 *   ```json
 *   [{"date":"2026-08-25","steps":6503,"sleep_minutes":431,"resting_hr":44, ...}]
 *   ```
 */

export interface GarminDailyRow {
  date: string;
  steps: number | null;
  sleep_minutes: number | null;
  resting_hr: number | null;
}

function toInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/** Достаёт первую запись из блока garmin_daily. null, если блока нет или JSON битый. */
export function parseGarminDaily(markdown: string): GarminDailyRow | null {
  const match = markdown.match(/garmin_daily\)\s*```json\s*([\s\S]*?)```/);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return null;
  }

  const row = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!row || typeof row !== "object") return null;

  const record = row as Record<string, unknown>;
  if (typeof record.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) return null;

  return {
    date: record.date,
    steps: toInt(record.steps),
    sleep_minutes: toInt(record.sleep_minutes),
    resting_hr: toInt(record.resting_hr),
  };
}
