# CLAUDE.md

## Project Overview

Focus-track — локальный мониторинг продуктивности на macOS. Периодические скриншоты → анализ через LLM → оценка фокуса в SQLite → веб-дашборд.

**Стек:** pnpm workspaces, TypeScript, Express, React, Vite, Tailwind v4, SQLite (Drizzle ORM), Gemini/Ollama.

## Commands

```bash
pnpm install                    # установить зависимости
pnpm -w run dev                 # dev server (API + Vite HMR) на :5001
pnpm run build                  # production build
pnpm run typecheck              # проверка типов всех workspace
npm test                        # тесты (node:test, .mjs файлы)
pnpm --filter @workspace/scripts run analyze <path.jpg>  # ручной анализ скриншота
```

## Code Style

- Язык комментариев: русский
- Minimal changes — не рефакторить работающий код
- Strict TypeScript (no `any`)
- TDD — сначала тест, потом реализация
- Типы-контракты в `lib/db/src/schema` и `lib/llm/src/types`

---

## Architecture — File Map

### Workspace Layout (`pnpm-workspace.yaml`)

```
focus-track/
├── lib/                    # shared библиотеки (внутренние пакеты)
│   ├── db/                 # @workspace/db — SQLite + Drizzle ORM + AppSettings
│   ├── llm/                # @workspace/llm — LLM провайдеры
│   ├── api-spec/           # OpenAPI спека + orval codegen config
│   ├── api-client-react/   # сгенерированный react-query клиент (orval)
│   └── api-zod/            # сгенерированные zod-схемы (orval)
├── artifacts/
│   ├── api-server/         # @workspace/api-server — Express REST API
│   ├── focus-tracker/      # @workspace/focus-tracker — React дашборд
│   └── mockup-sandbox/     # песочница для мокапов (не production)
├── scripts/                # @workspace/scripts — CLI утилиты
├── mac/                    # bash-скрипты + LaunchAgent plist
└── test/                   # интеграционные тесты (.mjs)
```

---

### `lib/db` — Database Layer

| Файл | Назначение |
|------|-----------|
| `src/index.ts` | Инициализация SQLite (better-sqlite3 + Drizzle), CREATE TABLE при старте |
| `src/schema/focus-log.ts` | Drizzle-схема таблицы `focus_log` |
| `src/schema/garmin-daily.ts` | Drizzle-схема `garmin_daily` (шаги/сон из Garmin, наполняет импортёр) |
| `src/schema/anki-daily.ts` | Drizzle-схема `anki_daily` (revlow: reviews/seconds, наполняет импортёр) |
| `src/schema/index.ts` | Re-export схемы |
| `src/app-settings.ts` | JSON-файл `focus-app-settings.json` рядом с БД. CRUD для настроек UI |

**Таблица `focus_log`:**
```
id INTEGER PK AUTOINCREMENT
datetime TEXT (ISO 8601)
timestamp INTEGER (Unix seconds)
category TEXT ("code" | "video" | "social" | "idle")
focus_score REAL (0-10)
summary TEXT (max 200 chars)
```

**Таблицы `garmin_daily` / `anki_daily`** (внешние источники, наполняются импортёрами из `scripts/`, сервер их не парсит):
```
garmin_daily: date TEXT PK, steps INTEGER, sleep_minutes INTEGER, resting_hr INTEGER, source TEXT, updated_at
anki_daily:   date TEXT PK, reviews INTEGER, seconds INTEGER, updated_at
```

**AppSettings** (файл `focus-app-settings.json`, лежит рядом с `focus.db`):
```typescript
{ provider, token, screenshot_interval, idle_threshold, focused_score_threshold }
```

Функции: `readAppSettings()`, `writeAppSettings()`, `getDefaultAppSettings()`, `normalizeSettingsPayload()`.

---

### `lib/llm` — LLM Providers

| Файл | Назначение |
|------|-----------|
| `src/types.ts` | Интерфейс `LLMProvider` + типы `AnalysisResult`, `Category` |
| `src/gemini-provider.ts` | `GeminiProvider` — Google Gemini Flash (модель `gemini-2.0-flash-exp`) |
| `src/ollama-provider.ts` | `OllamaProvider` — локальная Ollama (модель `llava:7b`) |
| `src/index.ts` | Re-export |

**Контракт:**
```typescript
interface LLMProvider {
  analyze(imageBase64: string): Promise<{ score: number; category: Category; summary: string }>
}
```

Промпт внутри провайдера. Ответ парсится из JSON (с поддержкой markdown code blocks).

---

### `artifacts/api-server` — Backend

| Файл | Назначение |
|------|-----------|
| `src/dev.ts` | Dev entrypoint — Express + Vite middleware (единый порт 5001) |
| `src/index.ts` | Production entrypoint |
| `src/app.ts` | Express app: CORS, JSON body, pino logger, маунт `/api` router |
| `src/routes/index.ts` | Комбинирует sub-routers |
| `src/routes/focus.ts` | **ВСЕ бизнес-эндпоинты** (stats, logs, settings, status, pause) |
| `src/routes/health.ts` | `GET /api/health` |
| `src/llm-connection-test.ts` | Проверка соединения с Gemini/Ollama (POST /api/settings/test) |
| `src/lib/logger.ts` | Pino logger |

**API Endpoints (все в `routes/focus.ts`):**

| Endpoint | Статус | Описание |
|----------|--------|----------|
| `GET /api/stats/today` | DONE | Статистика дня: score, deep_work_minutes, longest_session_min, focus_sessions, distraction_minutes, hourly heatmap |
| `GET /api/stats/calendar?month=YYYY-MM` | DONE | Avg score по дням месяца |
| `GET /api/stats/streak` | DONE | Deep Work стрик (floor 15 мин/день, все дни), адаптивная цель `target_minutes`, `best_streak`, `personal_best_min`, last7days с `best_session_min`/`floor_met`/`target_met` |
| `GET /api/stats/weekly?start=YYYY-MM-DD` | DONE | «Зеркало недели»: cards с WoW-дельтами (усилие/активное/**focus_leak**=active−effort/фокус/score/Anki/Garmin шаги+сон), by_day, categories, weekly_effort_history (14 нед), sleep↔effort scatter + Пирсон, daily_series (для интерактивного скаттера day/lag/week). По умолчанию — последняя **завершённая** неделя; для незавершённой `is_partial`/`elapsed_days`, дельты по сопоставимому отрезку. Роутер `routes/weekly.ts` |
| `GET /api/logs` | DONE | Фильтрация: date, date_from, date_to, category, min/max_score |
| `PATCH /api/logs/:id` | DONE | Обновить category/score/summary |
| `DELETE /api/logs/:id` | DONE | Удалить запись |
| `GET /api/settings` | DONE | Читает AppSettings JSON |
| `POST /api/settings` | DONE | Пишет AppSettings JSON |
| `POST /api/settings/test` | DONE | Проверка подключения к LLM |
| `GET /api/status` | DONE | `watcher_alive` = была запись за последние 10 мин |
| `POST /api/pause` | DONE | Пауза на N минут или до вечера (файл ~/.focus-track-pause) |

---

### `artifacts/focus-tracker` — Frontend

| Файл | Назначение |
|------|-----------|
| `src/App.tsx` | Layout + навигация по табам (react state, без роутера) |
| `src/api.ts` | HTTP клиент (fetch). Есть `USE_MOCK` флаг (сейчас `false`). Содержит mock-данные для offline разработки |
| `src/pages/Today.tsx` | Главная: текущий score, heatmap по часам, streak |
| `src/pages/Week.tsx` | «Weekly Mirror»: недельная сводка (focus + Anki + Garmin), recharts бар+scatter |
| `src/pages/Calendar.tsx` | Месячный календарь с цветами по avg score |
| `src/pages/Database.tsx` | Таблица логов с фильтрами |
| `src/pages/Settings.tsx` | Provider, token, intervals, test connection, pause |
| `src/pages/not-found.tsx` | 404 |
| `src/components/ui/` | shadcn/ui компоненты (не трогать без необходимости) |
| `src/hooks/` | `use-mobile`, `use-toast` |

**UI-библиотека:** shadcn/ui (Radix + Tailwind). Компоненты в `components/ui/` — сгенерированы, не менять вручную.

**React Query:** `@tanstack/react-query` для кэширования API-вызовов. `staleTime: 30s`.

---

### `scripts/` — CLI Tools

| Файл | Назначение |
|------|-----------|
| `src/analyze-screenshot.ts` | Главный скрипт: читает JPEG → base64 → LLM → INSERT в focus_log |
| `src/import-garmin.ts` | Импорт `garmin_daily` из vault-журналов (`$GARMIN_JOURNAL_DIR`, по умолч. `~/me/journal/activity`) |
| `src/import-anki.ts` | Импорт `anki_daily` из revlog (КОПИЯ коллекции в tmp; `$ANKI_COLLECTION` override) |
| `src/lib/garmin-parse.ts`, `src/lib/anki-aggregate.ts` | Чистые парсеры/свёртки (юнит-тесты) |

**Вызов:** `pnpm --filter @workspace/scripts run analyze <path-to-jpeg>`

Логика: читает AppSettings из JSON (если есть), иначе env vars. Создаёт провайдера, анализирует, пишет в БД, выводит JSON в stdout.

**Импортёры внешних данных** (для «Weekly Mirror»), идемпотентный upsert, окно `--days N` (по умолч. 120):

```bash
pnpm --filter @workspace/scripts run import:garmin    # Garmin шаги/сон → garmin_daily
pnpm --filter @workspace/scripts run import:anki      # Anki revlog → anki_daily
pnpm --filter @workspace/scripts run import:external  # оба сразу
```

Гонять по вечернему крону рядом с `habits-autofill` (граница repo/vault: сервер внешние источники не читает, наполняют импортёры).

---

### `mac/` — macOS Screenshot System

| Файл | Назначение |
|------|-----------|
| `capture-random-loop.sh` | Бесконечный цикл: sleep (120-600 sec random) → capture-if-active |
| `capture-if-active.sh` | Проверка idle (ioreg) → screencapture → sips resize → analyze |
| `com.focus-track.screenshot.plist` | LaunchAgent для capture loop |
| `com.focus-track.api-server.plist` | LaunchAgent для API сервера |

**Capture flow:**
```
LaunchAgent → capture-random-loop.sh → [sleep random] → capture-if-active.sh
  1. Проверка паузы: если ~/.focus-track-pause существует и время не истекло → exit
  2. ioreg HIDIdleTime — если idle > 300 сек → exit (пользователь ушёл)
  3. screencapture -x -t jpg → /tmp/
  4. sips -Z 1280 + quality 40% → ~/Library/Application Support/focus-track/captures/YYYYMMDD-HHMMSS.jpg (~150-350 KB)
  5. pnpm --filter @workspace/scripts run analyze <path> → INSERT в БД
  6. Cleanup: удаление скринов старше 7 дней
```

**ВАЖНО:** Скриншотинг — это ОТДЕЛЬНЫЙ процесс (bash через LaunchAgent). Node.js НЕ делает скриншоты. Node.js только анализирует готовый JPEG.

**macOS permissions:** Terminal/iTerm нужен доступ Screen Recording (System Settings → Privacy).

**Текущий статус:** plist содержит placeholder-пути `/path/to/focus-track` — нужен setup-скрипт для подстановки.

---

### `lib/api-spec/` — OpenAPI + Codegen

- `openapi.yaml` — OpenAPI 3 спецификация
- `orval.config.ts` — генерирует react-query клиент в `lib/api-client-react` и zod-схемы в `lib/api-zod`

---

## Data Flow (полный цикл)

```
[macOS LaunchAgent]
    ↓
capture-random-loop.sh (infinite loop, random 120-600s sleep)
    ↓
capture-if-active.sh
    ↓ (screencapture → JPEG file)
scripts/analyze-screenshot.ts
    ↓ (read JPEG → base64 → LLM provider → AnalysisResult)
INSERT into focus_log (SQLite)
    ↓
Express API (GET /api/stats/today etc.)
    ↓
React Dashboard (fetch → render)
```

---

## Settings Persistence

Два уровня:
1. **Environment vars** (в plist / .env) — пути, пороги, провайдер по умолчанию
2. **JSON файл** (`focus-app-settings.json` рядом с focus.db) — UI-настройки, перезаписываются из дашборда

`analyze-screenshot.ts` читает сначала JSON (если есть), потом fallback на env.

---

## Known Issues / TODO

- LaunchAgent plist содержит placeholder `/path/to/focus-track` — используйте `scripts/setup-launchagent.sh` для установки
- Нет Swift-утилиты для capture (используется screencapture + sips с quality 40%)
- macOS Screen Recording permission требуется для Terminal/iTerm

---

## Environment Variables

| Var | Default | Используется |
|-----|---------|-------------|
| `DATABASE_PATH` | `./focus.db` | lib/db, scripts |
| `PORT` | `5001` | api-server |
| `FOCUS_PROVIDER` | `gemini` | scripts, lib/db (default settings) |
| `GEMINI_API_KEY` | — | scripts, api-server (test), plist |
| `OLLAMA_HOST` | `http://localhost:11434` | scripts, api-server (test) |
| `FOCUS_TRACK_ROOT` | auto-detect | mac scripts |
| `FOCUS_TRACK_IDLE_SEC` | `60` | capture-if-active.sh |
| `FOCUS_TRACK_TICK_MIN_SEC` | `120` | capture-random-loop.sh |
| `FOCUS_TRACK_TICK_MAX_SEC` | `600` | capture-random-loop.sh |
