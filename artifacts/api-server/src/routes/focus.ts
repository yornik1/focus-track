import { Router } from "express";
import { db, focusLogTable } from "@workspace/db";
import { eq, gte, lte, and, sql, desc } from "drizzle-orm";

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

  res.json({
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
    conditions.push(lte(focusLogTable.timestamp, new Date(date_to as string).getTime() / 1000));
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

// GET /api/settings
router.get("/settings", async (req, res) => {
  // TODO: читать из конфига или env
  res.json({
    provider: "gemini",
    token: "",
    screenshot_interval: 2,
    idle_threshold: 60,
    focused_score_threshold: 7,
  });
});

// POST /api/settings
router.post("/settings", async (req, res) => {
  // TODO: сохранять в конфиг, обновлять plist, перезагружать LaunchAgent
  res.json({ success: true });
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
