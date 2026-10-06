# Changelog — 2026-10-06

## Сообщения по цели: вопрос дня, итог недели, серия с заморозками

### Дашборд
- Вкладка Week убрана из меню (`App.tsx`); страница и `GET /api/stats/weekly` остались, вернуть — одна строка в `TABS`.

### Сообщения в Telegram
- Включаются файлом `focus-goal.json` рядом с базой; без него ничего не делается.
- `mac/goal-report-send.sh` вызывается из цикла снимков, `scripts/src/goal-report.ts` решает, что слать; метка в `data/markers/` ставится только после ответа Telegram.
- Вопрос дня для английского вслух — каждый день после 14:00, когда пользователь не занят делом и привычка ещё не отмечена: ситуация с выбором, вопрос, первая фраза и фраза для ИИ-собеседника. Составляет Gemini по описаниям снимков за 48 часов (экран — только намёк на тему); запасной список — `speaking-topics.txt`.
- Итог недели: непустые дни (будни и выходные), дни с английским, часы за экраном и работы, три занятия не по работе, подсказка про планку.
- Серия непустых дней с заморозками (`lib/categories/src/streak.ts`): заморозка за 5 дней подряд, не больше 2; утром после пустого дня — сообщение о заморозке или обрыве.

### Прочее
- `lib/llm`: `generateGeminiText()` — текстовый вызов с ротацией ключей и общим пределом времени; у пакета включены типы node.
- `lib/db`: `readGoalSettings()`; `focus-goal.json` и `speaking-topics.txt` — вне git, в бэкапе и восстановлении.
- Запрос к ИИ для разбора снимков (хранится в настройках, не в коде) рекомендуется без «придумай свою категорию»: незнакомая категория записывается как `code`.

---

# Changelog — 2026-06-15

## Аналитика фокуса и стрик переделаны на Deep Work

### Метрика Deep Work и непрерывные сессии
- Чистые хелперы в `@workspace/categories` (`lib/categories/src/focus.ts`): `computeFocusSessions`, `summarizeDailyFocus`, `nextFocusTarget`, `medianActiveBest` (+ юнит-тесты).
- Deep Work = категории `code/research/design/writing` со `score ≥ focused_score_threshold`; communication из зачёта убран.
- Непрерывная сессия = подряд идущие качественные скрины с зазором ≤ `max(6, interval×2.5)` мин (idle/смена активности рвут блок).

### `GET /api/stats/streak` — новый смысл
- Soft-стрик: держится при одном непрерывном блоке ≥ 15 мин (floor); считаются все 7 дней (раньше — только будни).
- Адаптивная дневная цель `target_minutes` от медианы типичного блока за 14 дней (+ступень 5 мин), пол 15, потолок 180 — мягкий рост без погони за пиком.
- Ответ: `floor_minutes`, `target_minutes`, `today_best_session_min`, `today_floor_met`, `today_target_met`, `personal_best_min`, `last7days[].{best_session_min, deep_work_minutes, floor_met, target_met, by_category}`.

### `GET /api/stats/today`
- Добавлены `longest_session_min`, `deep_work_minutes`, `distraction_minutes`, `focus_sessions`.
- Починен баг порога: `total_focused_minutes` считается по `focused_score_threshold` (было хардкод `≥7` при подписи `≥6`).

### Прочее
- Границы суток в стрике — по локальному времени из `timestamp` (раньше UTC из `datetime`).
- `Today.tsx`: кольцо прогресса (лучшая сессия vs цель), 🔥-стрик со статусом, недельная полоса с линией цели; карточка «Focused Time» → «Deep Work»; поля устойчивы к отсутствию.

---

# Changelog — 2026-05-06

## Реализовано

### 1. Исправлена idle-логика в `mac/capture-if-active.sh`
- **Было:** idle < 60 сек → exit (инвертированная логика)
- **Стало:** idle > 300 сек → exit (правильная логика — пропускаем если пользователь ушёл)
- Добавлена проверка pause-файла `~/.focus-track-pause`

### 2. Агрессивное сжатие скриншотов
- Добавлен `sips -s formatOptions 40` — JPEG quality 40%
- Размер файлов: ~150-350 KB вместо 1-2 MB
- Добавлен cleanup: удаление скринов старше 7 дней (раз в день)

### 3. Реализован `GET /api/stats/streak`
- Подсчёт текущего streak (только рабочие дни)
- Подсчёт лучшего streak за 90 дней
- `last7days` с avg_score и is_weekend флагом
- Порог "фокусного дня" из settings (по умолчанию 6)

### 4. Реализован `POST /api/pause`
- Пауза на N минут: `{"duration": 30}`
- Пауза до вечера: `{"duration": "evening"}`
- Записывает timestamp в `~/.focus-track-pause`
- `capture-if-active.sh` проверяет файл перед захватом

### 5. Создан `scripts/setup-launchagent.sh`
- Подставляет реальные пути в plist
- Читает GEMINI_API_KEY из .env
- Устанавливает LaunchAgent через launchctl
- Проверяет наличие API ключа

### 6. Исправлены TypeScript ошибки
- Упрощена схема `focus-log.ts` (убран z.infer)
- Добавлены явные type assertions для enum
- Добавлены explicit return в async handlers

### 7. Документация
- Создан README.md с quick start
- Обновлён CLAUDE.md (убраны STUB статусы)
- Добавлена информация о новых фичах

### 8. Фиксы из код-ревью (Step 10)
- **10.1** Streak не обнуляется если сегодня ещё нет данных (утром)
- **10.2** Валидация duration в POST /api/pause (отклоняет негативные числа и невалидные строки)
- **10.3** sips использует tmp-файл вместо in-place перезаписи
- **10.4** setup-launchagent.sh безопасно читает .env через grep (не source)
- **10.5** Cleanup запускается раз в день через marker-файл

### 9. Settings + выбор модели (Step 11)
- **11.1** POST /api/settings/test автоматически сохраняет provider/token/model при успешном тесте
- **11.2** Добавлено поле `model` в AppSettings с дефолтами (gemini-2.5-flash, llava:7b)
- **11.3** analyze-screenshot.ts передаёт model из settings в провайдеры
- **11.4** Дефолтная модель Gemini изменена на gemini-2.5-flash (вместо gemini-2.0-flash-exp)
- **11.5** Frontend поддержка выбора модели (TODO — требует обновления UI)

## Тестирование

Все эндпоинты проверены:
- ✅ `GET /api/stats/streak` — возвращает корректную структуру
- ✅ `POST /api/pause` — валидация работает, создаёт файл с timestamp
- ✅ `GET /api/settings` — возвращает model: "gemini-2.5-flash"
- ✅ TypeScript typecheck проходит без ошибок
- ✅ Dev-сервер запускается и отвечает

## Что осталось

- **11.5** Добавить UI для выбора модели в Settings (dropdown/input)
- Установка LaunchAgent (требует ручного запуска setup-скрипта)
- Screen Recording permission для Terminal (ручная настройка в System Settings)
- Полный интеграционный тест с реальным LaunchAgent
