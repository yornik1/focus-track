import { Router, type Response } from "express";
import {
  db,
  focusLogTable,
  readAppSettings,
  getDefaultAppSettings,
  writeAppSettings,
  normalizeSettingsPayload,
  DEFAULT_PROMPT,
  ALLOWED_CATEGORIES,
  isProductiveCategory,
  summarizeDailyFocus,
  computeFocusSessions,
  nextFocusTarget,
  medianActiveBest,
  FOCUS_FLOOR_MINUTES,
  focusWorkspaceEnabled,
} from "@workspace/db";
import { eq, gte, lte, and, sql, desc } from "drizzle-orm";
import { testLlmConnection } from "../llm-connection-test";
import { listGeminiModels } from "../gemini-models";
import * as fs from "fs";
import * as path from "path";

const router = Router();

function localDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// GET /api/stats/today
router.get("/stats/today", async (req, res) => {
  const now = new Date();
  const settings = readAppSettings() ?? getDefaultAppSettings();
  const interval = settings.screenshot_interval ?? 2;
  const threshold = settings.focused_score_threshold;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
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
      longest_session_min: 0,
      deep_work_minutes: 0,
      distraction_minutes: 0,
      focus_sessions: 0,
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

  // Аналитика focus-сессий за сегодня
  const points = logs.map((log) => ({
    timestamp: log.timestamp,
    category: log.category,
    focus_score: log.focus_score,
  }));
  const { best_session_min, deep_work_minutes } = summarizeDailyFocus(points, { interval, threshold });
  const sessions = computeFocusSessions(points, { interval, threshold });
  const focus_sessions = sessions.filter((s) => s.minutes >= FOCUS_FLOOR_MINUTES).length;
  const focusedMinutes = logs.filter((log) => log.focus_score >= threshold).length * interval;
  const distraction_minutes = logs.filter((log) => !isProductiveCategory(log.category)).length * interval;

  return res.json({
    focus_score: latest.focus_score,
    category: latest.category,
    last_screenshot: latest.datetime,
    minutes_since_update: minutesSinceUpdate,
    hourly_heatmap,
    total_focused_minutes: focusedMinutes,
    avg_score: Math.round(avgScore * 10) / 10,
    total_screenshots: logs.length,
    longest_session_min: best_session_min,
    deep_work_minutes,
    distraction_minutes,
    focus_sessions,
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
    const date = localDateStr(new Date(log.timestamp * 1000));
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
      ...(focusWorkspaceEnabled() ? { direction_id: log.direction_id } : {}),
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
  const interval = settings.screenshot_interval ?? 2;
  const threshold = settings.focused_score_threshold;
  const opts = { interval, threshold };

  // Все записи за последние 90 дней
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const rows = await db
    .select()
    .from(focusLogTable)
    .where(gte(focusLogTable.timestamp, Math.floor(since.getTime() / 1000)));

  // Группировка точек по ЛОКАЛЬНОЙ дате из timestamp (чинит TZ-баг datetime UTC)
  const pointsByDate = new Map<string, { timestamp: number; category: string; focus_score: number }[]>();
  const scoresByDate = new Map<string, number[]>();
  for (const row of rows) {
    const date = localDateStr(new Date(row.timestamp * 1000));
    if (!pointsByDate.has(date)) pointsByDate.set(date, []);
    pointsByDate.get(date)!.push({ timestamp: row.timestamp, category: row.category, focus_score: row.focus_score });
    if (!scoresByDate.has(date)) scoresByDate.set(date, []);
    scoresByDate.get(date)!.push(row.focus_score);
  }

  // Кэш дневных сводок (best_session_min / deep_work_minutes / by_category)
  const summaryCache = new Map<string, ReturnType<typeof summarizeDailyFocus>>();
  function daySummary(dateStr: string) {
    let s = summaryCache.get(dateStr);
    if (!s) {
      s = summarizeDailyFocus(pointsByDate.get(dateStr) ?? [], opts);
      summaryCache.set(dateStr, s);
    }
    return s;
  }
  const floorMet = (dateStr: string) => daySummary(dateStr).best_session_min >= FOCUS_FLOOR_MINUTES;

  const today = new Date();
  const todayStr = localDateStr(today);

  // Адаптивная цель: от ТИПИЧНОГО блока (медиана активных дней) за прошлые 14 дней
  const prevBest: number[] = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    prevBest.push(daySummary(localDateStr(d)).best_session_min);
  }
  const target_minutes = nextFocusTarget(medianActiveBest(prevBest));

  // Текущий soft-стрик: подряд дни с floor_met; сегодня in-progress не ломает
  let streak = 0;
  for (let i = 0; i < 90; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = localDateStr(d);
    if (i === 0) {
      if (floorMet(ds)) streak++;
      continue;
    }
    if (floorMet(ds)) streak++;
    else break;
  }

  // Best streak: макс. серия календарных дней подряд с floor_met
  const metDates = [...pointsByDate.keys()].filter((d) => floorMet(d)).sort();
  let best_streak = 0;
  let run = 0;
  let prevDate: Date | null = null;
  for (const ds of metDates) {
    const d = new Date(ds);
    if (prevDate === null) {
      run = 1;
    } else {
      const expected = new Date(prevDate);
      expected.setDate(expected.getDate() + 1);
      run = d.getTime() === expected.getTime() ? run + 1 : 1;
    }
    best_streak = Math.max(best_streak, run);
    prevDate = d;
  }

  // Личный рекорд за окно
  let personal_best_min = 0;
  for (const ds of pointsByDate.keys()) {
    personal_best_min = Math.max(personal_best_min, daySummary(ds).best_session_min);
  }

  const todaySummary = daySummary(todayStr);
  const today_best_session_min = todaySummary.best_session_min;
  const today_deep_work_minutes = todaySummary.deep_work_minutes;
  const today_floor_met = today_best_session_min >= FOCUS_FLOOR_MINUTES;
  const today_target_met = today_best_session_min >= target_minutes;

  // last7days
  const last7days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = localDateStr(d);
    const s = daySummary(ds);
    const scores = scoresByDate.get(ds);
    const avg = scores ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    last7days.push({
      date: ds,
      is_weekend: d.getDay() === 0 || d.getDay() === 6,
      best_session_min: s.best_session_min,
      deep_work_minutes: s.deep_work_minutes,
      floor_met: s.best_session_min >= FOCUS_FLOOR_MINUTES,
      target_met: s.best_session_min >= target_minutes,
      avg_score: avg !== null ? Math.round(avg * 10) / 10 : null,
      by_category: s.by_category,
    });
  }

  res.json({
    streak,
    best_streak,
    floor_minutes: FOCUS_FLOOR_MINUTES,
    target_minutes,
    today_best_session_min,
    today_deep_work_minutes,
    today_floor_met,
    today_target_met,
    personal_best_min,
    last7days,
  });
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

function settingsResponse() {
  const stored = readAppSettings() ?? getDefaultAppSettings();
  return {
    ...stored,
    allowed_categories: [...ALLOWED_CATEGORIES],
    default_prompt: DEFAULT_PROMPT,
  };
}

// GET /api/settings/gemini-models?token=...
router.get("/settings/gemini-models", async (req, res) => {
  const fromQuery = req.query.token != null ? String(req.query.token).trim() : "";
  return handleGeminiModelsList(fromQuery, res);
});

// POST /api/settings/gemini-models — token в body (предпочтительно для фронта)
router.post("/settings/gemini-models", async (req, res) => {
  const fromBody =
    req.body && typeof req.body === "object" && req.body.token != null
      ? String(req.body.token).trim()
      : "";
  return handleGeminiModelsList(fromBody, res);
});

async function handleGeminiModelsList(tokenFromClient: string, res: Response) {
  const stored = readAppSettings();
  const token =
    tokenFromClient ||
    (stored?.provider === "gemini" ? stored.token.trim() : "");

  if (!token) {
    return res.status(400).json({ success: false, message: "Gemini API token is required" });
  }

  try {
    const models = await listGeminiModels(token);
    return res.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list models";
    return res.status(502).json({ success: false, message });
  }
}

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
    const modelStr = model != null ? String(model).trim() : (p === "ollama" ? "llava:7b" : "gemini-3.5-flash-lite");
    writeAppSettings({
      ...current,
      provider: p as "gemini" | "ollama",
      token: tokenStr,
      model: modelStr,
    });
  }

  return res.status(200).json(result);
});

// GET /api/settings
router.get("/settings", (req, res) => {
  res.json(settingsResponse());
});

// POST /api/settings
router.post("/settings", (req, res) => {
  try {
    const settings = normalizeSettingsPayload(req.body);
    writeAppSettings(settings);
    res.json({
      ...settings,
      allowed_categories: [...ALLOWED_CATEGORIES],
      default_prompt: DEFAULT_PROMPT,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid settings";
    res.status(400).json({ success: false, message });
  }
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
