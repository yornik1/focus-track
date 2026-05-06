const USE_MOCK = true;
const BASE_URL = "http://localhost:3456";

export type Category = "code" | "video" | "social" | "idle";

export interface TodayStats {
  focus_score: number;
  category: Category;
  last_screenshot: string;
  minutes_since_update: number;
  hourly_heatmap: Array<{ hour: number; avg_score: number | null; category: Category | null; summary: string | null }>;
  total_focused_minutes: number;
  avg_score: number;
  total_screenshots: number;
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
}

export interface Settings {
  provider: "gemini" | "ollama";
  token: string;
  screenshot_interval: 1 | 2 | 5 | 10;
  idle_threshold: number;
  focused_score_threshold: number;
}

export interface Status {
  watcher_alive: boolean;
  last_screenshot: string;
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
};

const MOCK_SETTINGS: Settings = {
  provider: "gemini",
  token: "AIza••••••••••••••••",
  screenshot_interval: 2,
  idle_threshold: 120,
  focused_score_threshold: 6,
};

const MOCK_STATUS: Status = {
  watcher_alive: true,
  last_screenshot: "2025-05-06T15:28:00",
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

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
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
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 7);
  const params = new URLSearchParams({
    date_from: weekStart,
    date_to: end.toISOString().slice(0, 10),
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

export async function getSettings(): Promise<Settings> {
  if (USE_MOCK) return { ...MOCK_SETTINGS };
  return apiFetch<Settings>("/api/settings");
}

export async function saveSettings(data: Settings): Promise<Settings> {
  if (USE_MOCK) {
    Object.assign(MOCK_SETTINGS, data);
    return { ...MOCK_SETTINGS };
  }
  return apiFetch<Settings>("/api/settings", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function testSettings(provider: string, token: string): Promise<{ success: boolean; message: string }> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 800));
    return { success: true, message: "Connection successful — model responded in 312ms" };
  }
  return apiFetch<{ success: boolean; message: string }>("/api/settings/test", {
    method: "POST",
    body: JSON.stringify({ provider, token }),
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
