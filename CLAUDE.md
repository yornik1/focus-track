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
| `GET /api/stats/today` | DONE | Статистика дня + hourly heatmap |
| `GET /api/stats/calendar?month=YYYY-MM` | DONE | Avg score по дням месяца |
| `GET /api/stats/streak` | **STUB** | Возвращает `{streak:0, best_streak:0, last7days:[]}` |
| `GET /api/logs` | DONE | Фильтрация: date, date_from, date_to, category, min/max_score |
| `PATCH /api/logs/:id` | DONE | Обновить category/score/summary |
| `DELETE /api/logs/:id` | DONE | Удалить запись |
| `GET /api/settings` | DONE | Читает AppSettings JSON |
| `POST /api/settings` | DONE | Пишет AppSettings JSON |
| `POST /api/settings/test` | DONE | Проверка подключения к LLM |
| `GET /api/status` | DONE | `watcher_alive` = была запись за последние 10 мин |
| `POST /api/pause` | **STUB** | Заглушка, не управляет реальным watcher |

---

### `artifacts/focus-tracker` — Frontend

| Файл | Назначение |
|------|-----------|
| `src/App.tsx` | Layout + навигация по табам (react state, без роутера) |
| `src/api.ts` | HTTP клиент (fetch). Есть `USE_MOCK` флаг (сейчас `false`). Содержит mock-данные для offline разработки |
| `src/pages/Today.tsx` | Главная: текущий score, heatmap по часам, streak |
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

**Вызов:** `pnpm --filter @workspace/scripts run analyze <path-to-jpeg>`

Логика: читает AppSettings из JSON (если есть), иначе env vars. Создаёт провайдера, анализирует, пишет в БД, выводит JSON в stdout.

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
  1. ioreg HIDIdleTime — если idle < 60 сек → exit (пользователь неактивен)
  2. screencapture -x -t jpg → /tmp/
  3. sips -Z 1280 → ~/Library/Application Support/focus-track/captures/YYYYMMDD-HHMMSS.jpg
  4. pnpm --filter @workspace/scripts run analyze <path> → INSERT в БД
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

- `GET /api/stats/streak` — заглушка, нет реальной логики подсчёта
- `POST /api/pause` — заглушка, не влияет на реальный watcher
- LaunchAgent plist содержит placeholder `/path/to/focus-track`
- Нет cleanup старых скриншотов (растёт ~/Library/Application Support/focus-track/captures/)
- `capture-if-active.sh` не проверяет файл паузы

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
