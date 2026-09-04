const USE_MOCK = false;
const BASE_URL = "";

export type Category = string;

export interface TodayStats {
  focus_score: number;
  category: Category;
  last_screenshot: string;
  minutes_since_update: number;
  hourly_heatmap: Array<{ hour: number; avg_score: number | null; category: Category | null; summary: string | null }>;
  total_focused_minutes: number;
  avg_score: number;
  total_screenshots: number;
  longest_session_min: number;
  deep_work_minutes: number;
  distraction_minutes: number;
  focus_sessions: number;
}

export interface CalendarDay {
  date: string;
  avg_score: number | null;
}

export interface CalendarResponse {
  days: CalendarDay[];
}

export interface HourlyEntry {
  id: string;
  datetime: string;
  category: Category;
  score: number;
  summary: string;
}

export interface LogEntry {
  id: string;
  datetime: string;
  category: Category;
  score: number;
  summary: string;
}

export interface LogsResponse {
  entries: LogEntry[];
  total: number;
}

export interface LogsFilter {
  date?: string;
  date_from?: string;
  date_to?: string;
  category?: Category;
  min_score?: number;
  max_score?: number;
  limit?: number;
  offset?: number;
}

export interface Settings {
  provider: "gemini" | "ollama";
  token: string;
  /** Резервные Gemini-ключи для ротации при лимите/ошибке основного. */
  tokens: string[];
  model: string;
  screenshot_interval: 1 | 2 | 5 | 10;
  idle_threshold: number;
  focused_score_threshold: number;
  prompt: string;
}

export interface SettingsResponse extends Settings {
  allowed_categories: string[];
  default_prompt: string;
}

export interface Status {
  watcher_alive: boolean;
  last_screenshot: string;
}

export type HabitSource = "auto" | "manual";

export interface HabitDefinition {
  id: string;
  label: string;
  auto_fill: boolean;
  category: string | null;
  current_streak: number;
}

export interface HabitCell {
  date: string;
  habit: string;
  done: boolean;
  source: HabitSource;
  updated_at: string;
}

export interface HabitsResponse {
  habits: HabitDefinition[];
  entries: HabitCell[];
}

export interface HabitManualUpdate {
  date: string;
  habit: string;
  done: boolean;
}

export interface HabitDefinitionInput {
  label: string;
  auto_fill: boolean;
  category: string | null;
}

export interface HabitDefinitionRecord extends HabitDefinitionInput {
  id: string;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

function randScore(): number {
  return Math.round(Math.random() * 10 * 10) / 10;
}

const MOCK_SUMMARIES: Record<Category, string[]> = {
  code: [
    "Writing TypeScript interfaces for auth module",
    "Debugging async race condition in useEffect",
    "Reviewing PR comments for API refactor",
    "Implementing pagination in database queries",
    "Setting up unit tests for validation logic",
    "Refactoring route handlers to use middleware",
  ],
  video: [
    "Watching conference talk on distributed systems",
    "Reviewing recorded team standup",
    "Following along with React tutorial",
    "Watching deployment walkthrough",
  ],
  social: [
    "Reading Slack messages from team",
    "Checking Twitter/X developer feed",
    "Browsing Hacker News",
    "Reviewing GitHub notifications",
  ],
  idle: [
    "No activity detected",
    "Screen locked or idle",
    "Away from keyboard",
  ],
};

function mockEntry(id: string, datetime: string, category: Category, score: number): LogEntry {
  const summaries = MOCK_SUMMARIES[category];
  return {
    id,
    datetime,
    category,
    score,
    summary: summaries[Math.floor(Math.random() * summaries.length)],
  };
}

function buildMockLogs(): LogEntry[] {
  const entries: LogEntry[] = [];
  let id = 1;
  const base = new Date("2025-05-06");
  for (let daysAgo = 13; daysAgo >= 0; daysAgo--) {
    const d = new Date(base);
    d.setDate(d.getDate() - daysAgo);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const dateStr = d.toISOString().slice(0, 10);
    const startHour = 8 + Math.floor(Math.random() * 2);
    const endHour = daysAgo === 0 ? 15 : 17 + Math.floor(Math.random() * 2);
    for (let hour = startHour; hour <= endHour; hour++) {
      const count = Math.floor(Math.random() * 4) + 2;
      for (let m = 0; m < count; m++) {
        const minutes = Math.floor((60 / count) * m + Math.random() * 5);
        const dt = `${dateStr}T${String(hour).padStart(2, "0")}:${String(Math.min(minutes, 59)).padStart(2, "0")}:00`;
        const cats: Category[] = ["code", "code", "code", "video", "social", "idle"];
        const cat = cats[Math.floor(Math.random() * cats.length)];
        const score =
          cat === "code" ? 6 + Math.random() * 4 :
          cat === "video" ? 3 + Math.random() * 4 :
          cat === "social" ? 1 + Math.random() * 4 :
          Math.random() * 2;
        entries.push(mockEntry(String(id++), dt, cat, Math.round(score * 10) / 10));
      }
    }
  }
  return entries.reverse();
}

const MOCK_LOGS = buildMockLogs();

const MOCK_TODAY: TodayStats = {
  focus_score: 7.8,
  category: "code",
  last_screenshot: "2025-05-06T15:28:00",
  minutes_since_update: 2,
  hourly_heatmap: Array.from({ length: 24 }, (_, hour) => {
    if (hour < 8 || hour > 15) return { hour, avg_score: null, category: null, summary: null };
    const data: Record<number, { avg_score: number; category: Category; summary: string }> = {
      8:  { avg_score: 6.2, category: "code",   summary: "Started the day reviewing open PRs and triaging GitHub issues from overnight." },
      9:  { avg_score: 7.4, category: "code",   summary: "Deep work on TypeScript refactor — extracting shared validation logic into a reusable lib module." },
      10: { avg_score: 8.1, category: "code",   summary: "Implementing pagination and cursor-based queries for the logs API. High focus, minimal interruptions." },
      11: { avg_score: 7.9, category: "code",   summary: "Writing unit tests for the new route handlers and fixing an edge case in the score threshold filter." },
      12: { avg_score: 3.2, category: "social",  summary: "Lunch break — browsing Hacker News and catching up on Slack threads from the team." },
      13: { avg_score: 5.8, category: "video",  summary: "Watching a conference talk on distributed tracing and observability patterns in microservices." },
      14: { avg_score: 8.4, category: "code",   summary: "Building the Calendar week view — positioning segments on a time grid, grouping screenshot entries into continuous blocks." },
      15: { avg_score: 7.8, category: "code",   summary: "Polishing the heatmap tooltip and adding summary text to each hourly cell. Wrapping up for the day." },
    };
    const h = data[hour];
    return { hour, avg_score: h.avg_score, category: h.category, summary: h.summary };
  }),
  total_focused_minutes: 248,
  avg_score: 7.1,
  total_screenshots: 62,
  longest_session_min: 64,
  deep_work_minutes: 248,
  distraction_minutes: 26,
  focus_sessions: 3,
};

const MOCK_SETTINGS: SettingsResponse = {
  provider: "gemini",
  token: "AIza••••••••••••••••",
  tokens: [],
  model: "gemini-flash-lite-latest",
  screenshot_interval: 2,
  idle_threshold: 120,
  focused_score_threshold: 6,
  prompt: "",
  allowed_categories: [
    "code",
    "research",
    "design",
    "writing",
    "video",
    "social",
    "gaming",
    "news",
    "communication",
  ],
  default_prompt: "",
};

const MOCK_STATUS: Status = {
  watcher_alive: true,
  last_screenshot: "2025-05-06T15:28:00",
};

const MOCK_HABITS: HabitsResponse = {
  habits: [
    { id: "meditation", label: "Meditation", auto_fill: false, category: null, current_streak: 4 },
    { id: "english_drill", label: "English drill", auto_fill: false, category: null, current_streak: 2 },
    { id: "walk", label: "Walk", auto_fill: true, category: null, current_streak: 8 },
    { id: "node_learning", label: "Node learning", auto_fill: true, category: null, current_streak: 1 },
  ],
  entries: [],
};

function buildCalendarMock(month: string): CalendarResponse {
  const [year, m] = month.split("-").map(Number);
  const daysInMonth = new Date(year, m, 0).getDate();
  const days: CalendarDay[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayOfWeek = new Date(date).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isFuture = new Date(date) > new Date("2025-05-06");
    if (isFuture || isWeekend) {
      days.push({ date, avg_score: null });
    } else {
      const base = 5 + Math.random() * 4;
      days.push({ date, avg_score: Math.round(base * 10) / 10 });
    }
  }
  return { days };
}

async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    if (text.trimStart().startsWith("<")) {
      throw new Error("Server returned HTML instead of JSON — restart dev server (pnpm dev)");
    }
    throw new Error(`Invalid server response: ${text.slice(0, 120)}`);
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    let message: string | undefined;
    try {
      const body = JSON.parse(text) as { message?: unknown };
      if (typeof body.message === "string") message = body.message;
    } catch {}
    if (message) throw new Error(message);
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return readJsonResponse<T>(res);
}

export interface StreakData {
  streak: number;
  best_streak: number;
  floor_minutes: number;
  target_minutes: number;
  today_best_session_min: number;
  today_deep_work_minutes: number;
  today_floor_met: boolean;
  today_target_met: boolean;
  personal_best_min: number;
  last7days: Array<{
    date: string;
    is_weekend: boolean;
    best_session_min: number;
    deep_work_minutes: number;
    floor_met: boolean;
    target_met: boolean;
    avg_score: number | null;
    by_category: Record<string, number>;
  }>;
}

const MOCK_STREAK: StreakData = {
  streak: 4,
  best_streak: 9,
  floor_minutes: 15,
  target_minutes: 45,
  today_best_session_min: 38,
  today_deep_work_minutes: 96,
  today_floor_met: true,
  today_target_met: false,
  personal_best_min: 72,
  last7days: [
    { date: "2025-04-30", is_weekend: false, best_session_min: 28, deep_work_minutes: 90, floor_met: true, target_met: false, avg_score: 5.2, by_category: { code: 60, research: 30 } },
    { date: "2025-05-01", is_weekend: false, best_session_min: 52, deep_work_minutes: 210, floor_met: true, target_met: true, avg_score: 7.1, by_category: { code: 150, research: 60 } },
    { date: "2025-05-02", is_weekend: false, best_session_min: 40, deep_work_minutes: 175, floor_met: true, target_met: false, avg_score: 6.5, by_category: { code: 100, writing: 75 } },
    { date: "2025-05-03", is_weekend: true, best_session_min: 0, deep_work_minutes: 0, floor_met: false, target_met: false, avg_score: null, by_category: {} },
    { date: "2025-05-04", is_weekend: true, best_session_min: 18, deep_work_minutes: 36, floor_met: true, target_met: false, avg_score: 6.0, by_category: { code: 36 } },
    { date: "2025-05-05", is_weekend: false, best_session_min: 46, deep_work_minutes: 188, floor_met: true, target_met: true, avg_score: 7.2, by_category: { code: 128, research: 60 } },
    { date: "2025-05-06", is_weekend: false, best_session_min: 38, deep_work_minutes: 96, floor_met: true, target_met: false, avg_score: 7.8, by_category: { code: 70, design: 26 } },
  ],
};

export async function getStreak(): Promise<StreakData> {
  if (USE_MOCK) return { ...MOCK_STREAK };
  return apiFetch<StreakData>("/api/stats/streak");
}

export async function getTodayStats(): Promise<TodayStats> {
  if (USE_MOCK) return { ...MOCK_TODAY };
  return apiFetch<TodayStats>("/api/stats/today");
}

export async function getCalendar(month: string): Promise<CalendarResponse> {
  if (USE_MOCK) return buildCalendarMock(month);
  return apiFetch<CalendarResponse>(`/api/stats/calendar?month=${month}`);
}

export async function getWeekLogs(weekStart: string): Promise<LogEntry[]> {
  if (USE_MOCK) {
    const start = new Date(weekStart);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    return MOCK_LOGS.filter((e) => {
      const d = e.datetime.slice(0, 10);
      return d >= startStr && d < endStr;
    });
  }
  const end = new Date(weekStart + "T00:00:00");
  end.setDate(end.getDate() + 6); // воскресенье (последний день недели)
  const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  const params = new URLSearchParams({
    date_from: weekStart,
    date_to: endStr,
    limit: "5000",
  });
  const res = await apiFetch<LogsResponse>(`/api/logs?${params}`);
  return res.entries;
}

export async function getHourlyEntries(date: string, hour: number): Promise<HourlyEntry[]> {
  if (USE_MOCK) {
    const prefix = `${date}T${String(hour).padStart(2, "0")}`;
    return MOCK_LOGS
      .filter((e) => e.datetime.startsWith(prefix))
      .map((e) => ({ ...e }));
  }
  return apiFetch<HourlyEntry[]>(`/api/logs?date=${date}&hour=${hour}`);
}

export async function getLogs(filter: LogsFilter = {}): Promise<LogsResponse> {
  if (USE_MOCK) {
    let entries = [...MOCK_LOGS];
    if (filter.date) entries = entries.filter((e) => e.datetime.startsWith(filter.date!));
    if (filter.date_from) entries = entries.filter((e) => e.datetime >= filter.date_from!);
    if (filter.date_to) entries = entries.filter((e) => e.datetime <= filter.date_to! + "T23:59:59");
    if (filter.category) entries = entries.filter((e) => e.category === filter.category);
    if (filter.min_score !== undefined) entries = entries.filter((e) => e.score >= filter.min_score!);
    if (filter.max_score !== undefined) entries = entries.filter((e) => e.score <= filter.max_score!);
    return { entries, total: entries.length };
  }
  const params = new URLSearchParams();
  if (filter.date) params.set("date", filter.date);
  if (filter.date_from) params.set("date_from", filter.date_from);
  if (filter.date_to) params.set("date_to", filter.date_to);
  if (filter.category) params.set("category", filter.category);
  if (filter.min_score !== undefined) params.set("min_score", String(filter.min_score));
  if (filter.max_score !== undefined) params.set("max_score", String(filter.max_score));
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  if (filter.offset !== undefined) params.set("offset", String(filter.offset));
  return apiFetch<LogsResponse>(`/api/logs?${params}`);
}

export async function patchLog(id: string, data: Partial<Pick<LogEntry, "score" | "category">>): Promise<LogEntry> {
  if (USE_MOCK) {
    const entry = MOCK_LOGS.find((e) => e.id === id);
    if (!entry) throw new Error("Entry not found");
    Object.assign(entry, data);
    return { ...entry };
  }
  return apiFetch<LogEntry>(`/api/logs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteLog(id: string): Promise<void> {
  if (USE_MOCK) {
    const idx = MOCK_LOGS.findIndex((e) => e.id === id);
    if (idx !== -1) MOCK_LOGS.splice(idx, 1);
    return;
  }
  await apiFetch<void>(`/api/logs/${id}`, { method: "DELETE" });
}

export async function getSettings(): Promise<SettingsResponse> {
  if (USE_MOCK) return { ...MOCK_SETTINGS };
  return apiFetch<SettingsResponse>("/api/settings");
}

export async function saveSettings(data: Settings): Promise<SettingsResponse> {
  if (USE_MOCK) {
    Object.assign(MOCK_SETTINGS, data);
    return { ...MOCK_SETTINGS };
  }
  return apiFetch<SettingsResponse>("/api/settings", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export interface GeminiModelOption {
  id: string;
  displayName: string;
}

export async function fetchGeminiModels(token?: string): Promise<GeminiModelOption[]> {
  if (USE_MOCK) {
    return [
      { id: "gemini-flash-lite-latest", displayName: "Gemini Flash Lite (latest)" },
      { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
      { id: "gemini-2.0-flash-exp", displayName: "Gemini 2.0 Flash Experimental" },
    ];
  }
  const trimmed = token?.trim() ?? "";
  const res = await fetch(`${BASE_URL}/api/settings/gemini-models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(trimmed ? { token: trimmed } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await readJsonResponse<{ models?: GeminiModelOption[]; message?: string; success?: boolean }>(res);
  if (!res.ok) {
    throw new Error(data.message ?? `API error: ${res.status}`);
  }
  return data.models ?? [];
}

export async function testSettings(provider: string, token: string, model: string): Promise<{ success: boolean; message: string }> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 800));
    return { success: true, message: "Connection successful — model responded in 312ms" };
  }
  return apiFetch<{ success: boolean; message: string }>("/api/settings/test", {
    method: "POST",
    body: JSON.stringify({ provider, token, model }),
  });
}

export async function pause(duration: number | "evening"): Promise<void> {
  if (USE_MOCK) return;
  await apiFetch<void>("/api/pause", {
    method: "POST",
    body: JSON.stringify({ duration }),
  });
}

export async function getStatus(): Promise<Status> {
  if (USE_MOCK) return { ...MOCK_STATUS };
  return apiFetch<Status>("/api/status");
}

// --- Weekly Mirror ---------------------------------------------------------

export type CategoryKind = "productive" | "neutral" | "distracting";

export interface WeeklyMetric {
  value: number;
  delta_pct: number | null;
  source?: "garmin";
}

export interface WeeklyByDay {
  date: string;
  dow: string;
  effort_h: number;
  active_h: number;
  focus_pct: number;
  focus_score: number | null;
  anki_reviews: number;
  steps: number | null;
  sleep_h: number | null;
}

export interface WeeklyCategory {
  category: string;
  hours: number;
  kind: CategoryKind;
}

export interface WeeklyDailyPoint {
  date: string;
  effort_h: number;
  sleep_h: number | null;
  steps: number | null;
  anki_reviews: number;
}

export interface WeeklyStats {
  week: { start: string; end: string; label: string; is_current: boolean; is_partial: boolean; elapsed_days: number };
  cards: {
    effort_h_per_day: WeeklyMetric;
    effort_total_h: WeeklyMetric;
    active_h: WeeklyMetric;
    focus_leak_h: WeeklyMetric;
    focus_pct: WeeklyMetric;
    focus_score: WeeklyMetric;
    anki_reviews: WeeklyMetric;
    anki_minutes: WeeklyMetric;
    steps_per_day: WeeklyMetric;
    sleep_avg_h: WeeklyMetric;
  };
  weekly_effort_history: { week_start: string; effort_h_per_day: number; is_current: boolean }[];
  by_day: WeeklyByDay[];
  categories: WeeklyCategory[];
  daily_series: WeeklyDailyPoint[];
  coverage: { days_with_data: number };
}

export async function getWeeklyStats(start?: string): Promise<WeeklyStats> {
  const query = start ? `?start=${encodeURIComponent(start)}` : "";
  return apiFetch<WeeklyStats>(`/api/stats/weekly${query}`);
}

export async function getHabits(from: string, to: string): Promise<HabitsResponse> {
  if (USE_MOCK) {
    return {
      habits: MOCK_HABITS.habits.map((habit) => ({ ...habit })),
      entries: MOCK_HABITS.entries
        .filter((entry) => entry.date >= from && entry.date <= to)
        .map((entry) => ({ ...entry })),
    };
  }
  const params = new URLSearchParams({ from, to });
  return apiFetch<HabitsResponse>(`/api/habits?${params}`);
}

export async function updateHabitManual(data: HabitManualUpdate): Promise<HabitCell> {
  if (USE_MOCK) {
    const cell: HabitCell = {
      ...data,
      source: "manual",
      updated_at: new Date().toISOString(),
    };
    const index = MOCK_HABITS.entries.findIndex((entry) => entry.date === data.date && entry.habit === data.habit);
    if (index === -1) {
      MOCK_HABITS.entries.push(cell);
    } else {
      MOCK_HABITS.entries[index] = cell;
    }
    return { ...cell };
  }
  return apiFetch<HabitCell>("/api/habits", {
    method: "POST",
    body: JSON.stringify({ ...data, source: "manual" }),
  });
}

export async function createHabitDefinition(data: HabitDefinitionInput): Promise<HabitDefinitionRecord> {
  return apiFetch<HabitDefinitionRecord>("/api/habit-definitions", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateHabitDefinition(
  id: string,
  data: HabitDefinitionInput,
): Promise<HabitDefinitionRecord> {
  return apiFetch<HabitDefinitionRecord>(`/api/habit-definitions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function reorderHabitDefinitions(ids: string[]): Promise<HabitDefinitionRecord[]> {
  return apiFetch<HabitDefinitionRecord[]>("/api/habit-definitions/order", {
    method: "PATCH",
    body: JSON.stringify({ ids }),
  });
}

export async function archiveHabitDefinition(id: string): Promise<HabitDefinitionRecord> {
  return apiFetch<HabitDefinitionRecord>(`/api/habit-definitions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
