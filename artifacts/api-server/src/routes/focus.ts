import { Router } from "express";
import {
  db,
  focusLogTable,
  readAppSettings,
  getDefaultAppSettings,
  writeAppSettings,
  normalizeSettingsPayload,
} from "@workspace/db";
import { eq, gte, lte, and, sql, desc } from "drizzle-orm";
import { testLlmConnection } from "../llm-connection-test";
import * as fs from "fs";
import * as path from "path";

const router = Router();

// GET /api/stats/today
router.get("/stats/today", async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  const todayStart = new Date(today).getTime() / 1000;
  const todayEnd = todayStart + 86400;

  const logs = await db
    .select()
    .from(focusLogTable)
    .where(and(gte(focusLogTable.timestamp, todayStart), lte(focusLogTable.timestamp, todayEnd)))
    .orderBy(desc(focusLogTable.timestamp));

  if (logs.length === 0) {
    return res.json({
      focus_score: 0,
      category: "idle",
      last_screenshot: new Date().toISOString(),
      minutes_since_update: 0,
      hourly_heatmap: Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        avg_score: null,
        category: null,
        summary: null,
      })),
      total_focused_minutes: 0,
      avg_score: 0,
      total_screenshots: 0,
    });
  }

  const latest = logs[0];
  const minutesSinceUpdate = Math.floor((Date.now() - latest.timestamp * 1000) / 60000);

  // Группировка по часам
  const hourlyMap = new Map<number, { scores: number[]; categories: string[]; summaries: string[] }>();
  for (const log of logs) {
    const hour = new Date(log.timestamp * 1000).getHours();
    if (!hourlyMap.has(hour)) {
      hourlyMap.set(hour, { scores: [], categories: [], summaries: [] });
    }
    const entry = hourlyMap.get(hour)!;
    entry.scores.push(log.focus_score);
    entry.categories.push(log.category);
    entry.summaries.push(log.summary);
  }

  const hourly_heatmap = Array.from({ length: 24 }, (_, hour) => {
    const data = hourlyMap.get(hour);
    if (!data || data.scores.length === 0) {
      return { hour, avg_score: null, category: null, summary: null };
    }
    const avg_score = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
    const category = data.categories[data.categories.length - 1]; // последняя категория
    const summary = data.summaries[data.summaries.length - 1];
    return { hour, avg_score: Math.round(avg_score * 10) / 10, category, summary };
  });

  const totalScore = logs.reduce((sum, log) => sum + log.focus_score, 0);
  const avgScore = totalScore / logs.length;
  const focusedMinutes = logs.filter((log) => log.focus_score >= 7).length * 2; // примерно 2 мин на скрин

  return res.json({
    focus_score: latest.focus_score,
    category: latest.category,
    last_screenshot: latest.datetime,
    minutes_since_update: minutesSinceUpdate,
    hourly_heatmap,
    total_focused_minutes: focusedMinutes,
    avg_score: Math.round(avgScore * 10) / 10,
    total_screenshots: logs.length,
  });
});

// GET /api/stats/calendar?month=2024-05
router.get("/stats/calendar", async (req, res) => {
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const [year, monthNum] = month.split("-").map(Number);
  const startDate = new Date(year, monthNum - 1, 1);
  const endDate = new Date(year, monthNum, 0);

  const startTs = startDate.getTime() / 1000;
  const endTs = endDate.getTime() / 1000 + 86400;

  const logs = await db
    .select()
    .from(focusLogTable)
    .where(and(gte(focusLogTable.timestamp, startTs), lte(focusLogTable.timestamp, endTs)));

  const dayMap = new Map<string, number[]>();
  for (const log of logs) {
    const date = new Date(log.timestamp * 1000).toISOString().split("T")[0];
    if (!dayMap.has(date)) {
      dayMap.set(date, []);
    }
    dayMap.get(date)!.push(log.focus_score);
  }

  const days = [];
  for (let d = 1; d <= endDate.getDate(); d++) {
    const date = `${year}-${String(monthNum).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const scores = dayMap.get(date);
    const avg_score = scores ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    days.push({ date, avg_score: avg_score ? Math.round(avg_score * 10) / 10 : null });
  }

  res.json({ days });
});

// GET /api/logs?date=2024-05-06&category=code&limit=50&offset=0
router.get("/logs", async (req, res) => {
  const { date, date_from, date_to, category, min_score, max_score, limit = "50", offset = "0" } = req.query;

  let query = db.select().from(focusLogTable);

  const conditions = [];
  if (date) {
    const dayStart = new Date(date as string).getTime() / 1000;
    const dayEnd = dayStart + 86400;
    conditions.push(and(gte(focusLogTable.timestamp, dayStart), lte(focusLogTable.timestamp, dayEnd)));
  }
  if (date_from) {
    conditions.push(gte(focusLogTable.timestamp, new Date(date_from as string).getTime() / 1000));
  }
  if (date_to) {
    conditions.push(lte(focusLogTable.timestamp, new Date(date_to as string).getTime() / 1000 + 86400));
  }
  if (category) {
    conditions.push(eq(focusLogTable.category, category as string));
  }
  if (min_score) {
    conditions.push(gte(focusLogTable.focus_score, Number(min_score)));
  }
  if (max_score) {
    conditions.push(lte(focusLogTable.focus_score, Number(max_score)));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  const logs = await query.orderBy(desc(focusLogTable.timestamp)).limit(Number(limit)).offset(Number(offset));

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(focusLogTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  res.json({
    entries: logs.map((log) => ({
      id: String(log.id),
      datetime: log.datetime,
      category: log.category,
      score: log.focus_score,
      summary: log.summary,
    })),
    total: Number(total[0]?.count || 0),
  });
});

// PATCH /api/logs/:id
router.patch("/logs/:id", async (req, res) => {
  const { id } = req.params;
  const { category, score, summary } = req.body;

  const updates: any = {};
  if (category) updates.category = category;
  if (score !== undefined) updates.focus_score = score;
  if (summary) updates.summary = summary;

  await db.update(focusLogTable).set(updates).where(eq(focusLogTable.id, Number(id)));

  res.json({ success: true });
});

// GET /api/stats/streak
router.get("/stats/streak", async (req, res) => {
  const settings = readAppSettings() ?? getDefaultAppSettings();
  const threshold = settings.focused_score_threshold ?? 6;

  // Все записи за последние 90 дней
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const rows = await db
    .select()
    .from(focusLogTable)
    .where(gte(focusLogTable.timestamp, Math.floor(since.getTime() / 1000)));

  // Группируем по датам, считаем avg
  const byDate = new Map<string, number[]>();
  for (const row of rows) {
    const date = row.datetime.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(row.focus_score);
  }

  // "Фокусный день" = avg_score >= threshold
  const focusedDates = new Set<string>();
  for (const [date, scores] of byDate) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg >= threshold) focusedDates.add(date);
  }

  // Текущий streak (только рабочие дни)
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 90; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // пропускаем выходные
    const dateStr = d.toISOString().slice(0, 10);
    // Сегодня ещё нет данных — пропускаем, не ломаем streak
    if (i === 0 && !byDate.has(dateStr)) continue;
    if (focusedDates.has(dateStr)) {
      streak++;
    } else {
      break;
    }
  }

  // Best streak (максимальная последовательность рабочих дней)
  const allDates = Array.from(byDate.keys()).sort();
  let bestStreak = 0;
  let currentRun = 0;
  let prevDate: Date | null = null;

  for (const dateStr of allDates) {
    const d = new Date(dateStr);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // пропускаем выходные

    if (!focusedDates.has(dateStr)) {
      currentRun = 0;
      prevDate = null;
      continue;
    }

    if (prevDate === null) {
      currentRun = 1;
    } else {
      // Проверяем что это следующий рабочий день
      let expectedDate = new Date(prevDate);
      expectedDate.setDate(expectedDate.getDate() + 1);
      // Пропускаем выходные
      while (expectedDate.getDay() === 0 || expectedDate.getDay() === 6) {
        expectedDate.setDate(expectedDate.getDate() + 1);
      }
      if (d.getTime() === expectedDate.getTime()) {
        currentRun++;
      } else {
        currentRun = 1;
      }
    }

    bestStreak = Math.max(bestStreak, currentRun);
    prevDate = d;
  }

  // last7days
  const last7days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const scores = byDate.get(dateStr);
    const avg = scores ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    last7days.push({
      date: dateStr,
      avg_score: avg ? Math.round(avg * 10) / 10 : null,
      is_weekend: d.getDay() === 0 || d.getDay() === 6,
    });
  }

  res.json({ streak, best_streak: bestStreak, last7days });
});

// DELETE /api/logs/:id
router.delete("/logs/:id", async (req, res) => {
  const { id } = req.params;
  await db.delete(focusLogTable).where(eq(focusLogTable.id, Number(id)));
  res.json({ success: true });
});

// POST /api/pause
router.post("/pause", async (req, res) => {
  const { duration } = req.body;

  if (duration !== "evening" && (typeof duration !== "number" || duration <= 0)) {
    return res.status(400).json({ success: false, message: "duration must be positive number or 'evening'" });
  }

  let pauseUntil: number;
  if (duration === "evening") {
    const end = new Date();
    end.setHours(23, 59, 59);
    pauseUntil = Math.floor(end.getTime() / 1000);
  } else {
    pauseUntil = Math.floor(Date.now() / 1000) + duration * 60;
  }

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const pauseFile = path.join(dataDir, "pause");
  fs.writeFileSync(pauseFile, String(pauseUntil));

  return res.json({
    success: true,
    paused_until: new Date(pauseUntil * 1000).toISOString(),
  });
});

// GET /api/settings
router.get("/settings", (req, res) => {
  const stored = readAppSettings();
  res.json(stored ?? getDefaultAppSettings());
});

// POST /api/settings
router.post("/settings", (req, res) => {
  try {
    const settings = normalizeSettingsPayload(req.body);
    writeAppSettings(settings);
    res.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid settings";
    res.status(400).json({ success: false, message });
  }
});

// POST /api/settings/test
router.post("/settings/test", async (req, res) => {
  const { provider, token, model } = req.body;
  const tokenStr = token != null ? String(token).trim() : "";
  if (!provider || !tokenStr) {
    return res.status(400).json({ success: false, message: "provider and token are required" });
  }
  const p = String(provider).toLowerCase();
  if (p !== "gemini" && p !== "ollama") {
    return res.status(400).json({ success: false, message: "provider must be gemini or ollama" });
  }
  const result = await testLlmConnection(p as "gemini" | "ollama", tokenStr);

  // Если тест успешен — сохраняем provider, token и model в settings
  if (result.success) {
    const current = readAppSettings() ?? getDefaultAppSettings();
    const modelStr = model != null ? String(model).trim() : (p === "ollama" ? "llava:7b" : "gemini-2.5-flash");
    writeAppSettings({
      ...current,
      provider: p as "gemini" | "ollama",
      token: tokenStr,
      model: modelStr,
    });
  }

  return res.status(200).json(result);
});

// GET /api/status
router.get("/status", async (req, res) => {
  const latest = await db.select().from(focusLogTable).orderBy(desc(focusLogTable.timestamp)).limit(1);

  res.json({
    watcher_alive: latest.length > 0 && Date.now() - latest[0].timestamp * 1000 < 600000, // < 10 мин
    last_screenshot: latest[0]?.datetime || new Date().toISOString(),
  });
});

export default router;
