# Changelog — 2026-05-06

## Реализовано

### 1. Исправлена idle-логика в `mac/capture-if-active.sh`
- **Было:** idle < 60 сек → exit (инвертированная логика)
- **Стало:** idle > 300 сек → exit (правильная логика — пропускаем если пользователь ушёл)
- Добавлена проверка pause-файла `~/.focus-track-pause`

### 2. Агрессивное сжатие скриншотов
- Добавлен `sips -s formatOptions 40` — JPEG quality 40%
- Размер файлов: ~150-350 KB вместо 1-2 MB
- Добавлен cleanup: удаление скринов старше 7 дней

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

## Тестирование

Все эндпоинты проверены:
- ✅ `GET /api/stats/streak` — возвращает корректную структуру
- ✅ `POST /api/pause` — создаёт файл с timestamp
- ✅ TypeScript typecheck проходит без ошибок
- ✅ Dev-сервер запускается и отвечает

## Что осталось

- Установка LaunchAgent (требует ручного запуска setup-скрипта)
- Screen Recording permission для Terminal (ручная настройка в System Settings)
- Полный интеграционный тест с реальным LaunchAgent
