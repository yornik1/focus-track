# AGENTS.md

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
| `src/schema/habits.ts` | Drizzle-схемы habit-grid: клетки, определения и аудит |
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

**Habit-grid (не связан с `focus_log`):**

- `habits`: состояние клетки, composite PK `(date, habit)`, `done`, `source`, `updated_at`. Дата — `YYYY-MM-DD` по `Europe/Kiev`.
- `habit_definitions`: конфигурация активностей (`id`, `label`, `auto_fill`, `category`, `sort_order`, `active`, timestamps).
- `habit_events`: append-only аудит фактических INSERT/UPDATE клетки со старым/новым состоянием и actor.
- Ручное состояние имеет абсолютный приоритет: `manual -> auto` блокируется SQLite-trigger даже при прямом SQL. Ручное снятие auto-клетки сохраняется как `done=0, source=manual` и также защищено.
- Заблокированный auto-запрос и полный no-op не создают audit event и не меняют `updated_at`.
- Удаление определения — мягкое (`active=0`): активность исчезает из сетки, но клетки и аудит сохраняются. ID определения после создания не меняется.

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
| `src/routes/focus.ts` | Эндпоинты stats, logs, settings, status, pause |
| `src/routes/habits.ts` | Habit-grid, приоритеты клеток, аудит и CRUD определений |
| `src/routes/health.ts` | `GET /api/health` |
| `src/llm-connection-test.ts` | Проверка соединения с Gemini/Ollama (POST /api/settings/test) |
| `src/lib/logger.ts` | Pino logger |

**API Endpoints (все в `routes/focus.ts`):**

| Endpoint | Статус | Описание |
|----------|--------|----------|
| `GET /api/stats/today` | DONE | Статистика дня + hourly heatmap |
| `GET /api/stats/calendar?month=YYYY-MM` | DONE | Avg score по дням месяца |
| `GET /api/stats/streak` | DONE | Текущий streak, лучший streak, last7days (только рабочие дни) |
| `GET /api/logs` | DONE | Фильтрация: date, date_from, date_to, category, min/max_score |
| `PATCH /api/logs/:id` | DONE | Обновить category/score/summary |
| `DELETE /api/logs/:id` | DONE | Удалить запись |
| `GET /api/settings` | DONE | Читает AppSettings JSON |
| `POST /api/settings` | DONE | Пишет AppSettings JSON |
| `POST /api/settings/test` | DONE | Проверка подключения к LLM |
| `GET /api/status` | DONE | `watcher_alive` = была запись за последние 10 мин |
| `POST /api/pause` | DONE | Пауза на N минут или до вечера (файл ~/.focus-track-pause) |

**Habit endpoints (`routes/habits.ts`):**

| Endpoint | Описание |
|----------|----------|
| `GET /api/habits?from=YYYY-MM-DD&to=YYYY-MM-DD` | Активные определения, клетки диапазона и streak по полной истории |
| `POST /api/habits` | Upsert клетки; default `source=manual`, auto никогда не перетирает manual |
| `GET /api/habits/history?from=...&to=...&habit=...` | Audit events по убыванию времени |
| `POST /api/habit-definitions` | Создать активность; ID автоматически slugify из label, коллизии получают `_2`, `_3` |
| `PATCH /api/habit-definitions/order` | Сохранить полный новый порядок активных привычек |
| `PATCH /api/habit-definitions/:id` | Изменить label, category и auto_fill; ID стабилен |
| `DELETE /api/habit-definitions/:id` | Архивировать активность без удаления истории |

Стартовые определения: `meditation`, `english_drill`, `walk` (auto), `node_learning` (auto). Внешние агенты могут заполнять auto-клетки через API или SQL; Garmin/focus_log сервер не интерпретирует.

**Кто заполняет auto-клетки (с 2026-07-21).** Наполнитель живёт вне репозитория —
`~/me/bin/habits-autofill.py`, детерминированный скрипт без LLM. Запускается вечерним
кроном пинателя (`~/me/bin/agent-cron.sh evening-review`, LaunchAgent
`com.mich.pinatel-evening-review`, 21:00 + ретрай 22:30) до LLM-цепочки и независимо от
её успеха: цепочка ложится на лимитах, клетки должны проставиться всё равно.

| Активность | Правило | Источник |
|------------|---------|----------|
| `walk` 🚶 | `steps >= 8000` | `~/me/journal/activity/<date>.md` (Garmin, кладётся в 20:50) |
| `node_learning` 🟩 | `>= 30` мин `category='code'` **или** закрытый дрилл | `focus_log` + `~/PycharmProjects/drills/PROGRESS.md` |

Контракт со стороны сервера — менять только синхронно со скриптом:
- Пишутся **только положительные** клетки. Нет строки = «нет данных», не «не сделано».
- `manual` неприкосновенен: скрипт опирается и на `WHERE habits.source <> 'manual'`,
  и на триггер `habits_protect_manual_before_update`. Снятая руками auto-клетка остаётся снятой.
- `habit_events` append-only; повторный прогон не трогает `updated_at` и не плодит события.
- `auto_fill=0` в UI — это и есть выключатель: скрипт молчит по такой активности.
- Окно 7 дней лечит поздний досинк Garmin (в 21:00 сегодняшний код ещё не весь набран —
  добирается ретраем в 22:30 и следующим вечером).
- Минуты кода = сумма разрывов между семплами с потолком 10 мин, а не «семплы × интервал»:
  интервал съёмки плавает 44с..10мин.
- Дни — `Europe/Kiev` через `zoneinfo`, не смещением `+3` (сломается на переходе на зимнее).

Пороги и расписание правятся на стороне vault, не здесь. Прогнать руками:
`python3 ~/me/bin/habits-autofill.py --days 7 [--dry-run]`.

---

### `artifacts/focus-tracker` — Frontend

| Файл | Назначение |
|------|-----------|
| `src/App.tsx` | Layout + навигация по табам (react state, без роутера) |
| `src/api.ts` | HTTP клиент (fetch). Есть `USE_MOCK` флаг (сейчас `false`). Содержит mock-данные для offline разработки |
| `src/pages/Today.tsx` | Главная: текущий score, heatmap по часам, streak |
| `src/pages/Habits.tsx` | 4-недельная сетка, панель «сегодня» и CRUD активностей |
| `src/lib/habit-grid.ts` | Расчёт календарных недель/дат по Europe/Kiev и optimistic helpers |
| `src/pages/Calendar.tsx` | Месячный календарь с цветами по avg score |
| `src/pages/Database.tsx` | Таблица логов с фильтрами |
| `src/pages/Settings.tsx` | Provider, token, intervals, test connection, pause |
| `src/pages/not-found.tsx` | 404 |
| `src/components/ui/` | shadcn/ui компоненты (не трогать без необходимости) |
| `src/hooks/` | `use-mobile`, `use-toast` |

**UI-библиотека:** shadcn/ui (Radix + Tailwind). Компоненты в `components/ui/` — сгенерированы, не менять вручную.

**React Query:** `@tanstack/react-query` для кэширования API-вызовов. `staleTime: 30s`.

**Habits UI:** вторая вкладка после Today и прямой путь `/habits`. Показывает текущую календарную неделю Пн–Вс и три предыдущие; будущие дни текущей недели disabled. Клик по клетке всегда пишет `source=manual` с optimistic update/rollback. Список берётся только из `habit_definitions`. CRUD-кнопки намеренно компактные: только иконки `+`, edit и delete с `aria-label`/tooltip; не возвращать текстовые подписи в строку. ID — внутренний стабильный ключ: сервер генерирует его из label, в форме его нет. Порядок меняется drag-and-drop за grip или стрелками ↑/↓ на сфокусированном grip; `sort_order` сохраняется через API с optimistic rollback.

**Панель «сегодня» (вверху `/habits`):** над сеткой — карточка `TodaySummary`: прогресс «сделано N из M за сегодня», `best streak`, и список ещё не отмеченных на сегодня привычек как chip-кнопки (клик = отметить `done` за сегодня через ту же mutation, что и клетки). Manual-привычки подсвечены янтарным (нужно сделать руками), auto — циановым (заполнит вечерний крон). В строках привычек к стрику добавлены 🔥, счётчик `done/визуальные дни` и метки «keep alive today» / «done today». Годится как домашняя страница браузера (Firefox → Home and startup → Custom Homepage → `http://127.0.0.1:5001/habits`).

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
