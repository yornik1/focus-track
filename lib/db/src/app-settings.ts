import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Настройки UI/захвата, синхронные с дашбордом; `token` для Gemini — ключ, для Ollama — base URL. */
export interface AppSettings {
  provider: "gemini" | "ollama";
  token: string;
  model: string;
  screenshot_interval: 1 | 2 | 5 | 10;
  idle_threshold: number;
  focused_score_threshold: number;
}

const SETTINGS_FILENAME = "focus-app-settings.json";

const ALLOWED_INTERVALS = new Set<AppSettings["screenshot_interval"]>([1, 2, 5, 10]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveProjectRoot(): string {
  if (process.env.FOCUS_TRACK_ROOT) return process.env.FOCUS_TRACK_ROOT;
  // lib/db/src/ → lib/db/ → lib/ → корень проекта
  return path.resolve(__dirname, "../../..");
}

function resolveDbPath(): string {
  return path.resolve(process.env.DATABASE_PATH || path.join(resolveProjectRoot(), "focus.db"));
}

/** Абсолютный путь к JSON с настройками (каталог тот же, что у SQLite). */
export function resolveAppSettingsPath(): string {
  return path.join(path.dirname(resolveDbPath()), SETTINGS_FILENAME);
}

/** Значения по умолчанию, если файла ещё нет (env для провайдера и секрета). */
export function getDefaultAppSettings(): AppSettings {
  const fromEnv = process.env.FOCUS_PROVIDER === "ollama" ? "ollama" : "gemini";
  const token =
    fromEnv === "ollama"
      ? (process.env.OLLAMA_HOST ?? "")
      : (process.env.GEMINI_API_KEY ?? "");
  const model = fromEnv === "ollama" ? "llava:7b" : "gemini-2.5-flash";
  return {
    provider: fromEnv,
    token,
    model,
    screenshot_interval: 2,
    idle_threshold: 60,
    focused_score_threshold: 7,
  };
}

/** Читает сохранённые настройки или `null`, если файла нет / битый JSON. */
export function readAppSettings(): AppSettings | null {
  const filePath = resolveAppSettingsPath();
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeStoredSettings(parsed);
  } catch {
    return null;
  }
}

function normalizeStoredSettings(parsed: unknown): AppSettings | null {
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const o = parsed as Record<string, unknown>;
  const provider = o.provider;
  if (provider !== "gemini" && provider !== "ollama") {
    return null;
  }
  const token = o.token != null ? String(o.token) : "";
  const model = o.model != null ? String(o.model) : (provider === "ollama" ? "llava:7b" : "gemini-2.5-flash");
  const si = Number(o.screenshot_interval);
  const screenshot_interval = ALLOWED_INTERVALS.has(si as AppSettings["screenshot_interval"])
    ? (si as AppSettings["screenshot_interval"])
    : 2;
  const idle_threshold = typeof o.idle_threshold === "number" ? o.idle_threshold : 60;
  const focused_score_threshold =
    typeof o.focused_score_threshold === "number" ? o.focused_score_threshold : 7;
  return {
    provider,
    token,
    model,
    screenshot_interval,
    idle_threshold,
    focused_score_threshold,
  };
}

/** Валидация тела POST /api/settings и нормализация перед записью. */
export function normalizeSettingsPayload(body: unknown): AppSettings {
  if (typeof body !== "object" || body === null) {
    throw new Error("Invalid settings body");
  }
  const b = body as Record<string, unknown>;
  const provider = b.provider;
  if (provider !== "gemini" && provider !== "ollama") {
    throw new Error("provider must be gemini or ollama");
  }
  const token = b.token != null ? String(b.token) : "";
  const model = b.model != null ? String(b.model) : (provider === "ollama" ? "llava:7b" : "gemini-2.5-flash");
  const si = Number(b.screenshot_interval);
  if (!ALLOWED_INTERVALS.has(si as AppSettings["screenshot_interval"])) {
    throw new Error("screenshot_interval must be 1, 2, 5, or 10");
  }
  const idle = Number(b.idle_threshold);
  if (!Number.isFinite(idle) || idle < 30 || idle > 600) {
    throw new Error("idle_threshold must be between 30 and 600");
  }
  const focused = Number(b.focused_score_threshold);
  if (!Number.isFinite(focused) || focused < 1 || focused > 10) {
    throw new Error("focused_score_threshold must be between 1 and 10");
  }
  return {
    provider,
    token,
    model,
    screenshot_interval: si as AppSettings["screenshot_interval"],
    idle_threshold: Math.round(idle),
    focused_score_threshold: Math.round(focused),
  };
}

/** Атомарная запись JSON настроек. */
export function writeAppSettings(settings: AppSettings): void {
  const filePath = resolveAppSettingsPath();
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}
