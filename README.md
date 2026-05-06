# Focus Tracker

Локальный мониторинг продуктивности на macOS. Периодические скриншоты → анализ через LLM → оценка фокуса → веб-дашборд.

## Быстрый старт

### 1. Установка зависимостей

```bash
pnpm install
```

### 2. Настройка API ключа

Создайте `.env` в корне проекта:

```bash
GEMINI_API_KEY=your-api-key-here
```

Или используйте Ollama локально:

```bash
FOCUS_PROVIDER=ollama
OLLAMA_HOST=http://localhost:11434
```

### 3. Запуск dev-сервера

```bash
pnpm -w run dev
```

Откройте http://localhost:5001 — дашборд готов.

### 4. Установка автоматического захвата (опционально)

```bash
chmod +x scripts/setup-launchagent.sh
./scripts/setup-launchagent.sh
```

**Важно:** Дайте разрешение Screen Recording для Terminal/iTerm:
- System Settings → Privacy & Security → Screen Recording → добавьте Terminal.app

## Ручной тест

Без LaunchAgent, просто проверить что всё работает:

```bash
# 1. Сделать скриншот
screencapture -x -t jpg /tmp/test.jpg

# 2. Анализ
pnpm --filter @workspace/scripts run analyze /tmp/test.jpg

# 3. Проверить БД
sqlite3 focus.db "SELECT * FROM focus_log ORDER BY id DESC LIMIT 5;"

# 4. Проверить API
curl http://localhost:5001/api/stats/today | jq .
```

## Команды

```bash
pnpm install                    # установить зависимости
pnpm -w run dev                 # dev server (API + Vite HMR) на :5001
pnpm run build                  # production build
pnpm run typecheck              # проверка типов
npm test                        # тесты
```

## Архитектура

- **Backend:** Express + SQLite (Drizzle ORM)
- **Frontend:** React + Vite + Tailwind v4
- **LLM:** Gemini 2.0 Flash или Ollama (llava:7b)
- **Capture:** bash + screencapture + sips (macOS)

Подробности в [CLAUDE.md](./CLAUDE.md).

## Структура

```
focus-track/
├── lib/                    # shared библиотеки
│   ├── db/                 # SQLite + Drizzle ORM
│   └── llm/                # LLM провайдеры
├── artifacts/
│   ├── api-server/         # Express REST API
│   └── focus-tracker/      # React дашборд
├── scripts/                # CLI утилиты
└── mac/                    # bash-скрипты + LaunchAgent
```

## Настройки

Настройки хранятся в `focus-app-settings.json` (рядом с `focus.db`):

- `provider`: "gemini" или "ollama"
- `token`: API ключ или Ollama host
- `screenshot_interval`: интервал захвата (сек)
- `idle_threshold`: порог простоя (сек)
- `focused_score_threshold`: порог "фокусного дня" (0-10)

Редактируются через Settings в дашборде.
