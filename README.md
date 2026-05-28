# Focus Tracker

Локальный мониторинг продуктивности на macOS. Скриншоты → Gemini → оценка фокуса → дашборд.

## Установка

1. Скачайте ZIP на GitHub (**Code → Download ZIP**), распакуйте.
2. Terminal:
   ```bash
   cd ~/Downloads/focus-track-0.0.9
   make focus-great-again
   ```
   Нет `make`? → `bash scripts/bootstrap.sh`

В конце откроются **создание ключа Gemini** и **Settings** в браузере — название проекта и ключа любые, скопируйте ключ и вставьте в API Token (сохранится автоматически). **Test** проверит соединение.

Повторный запуск безопасен — докачает недостающее.

## Что делает установка

- Node + pnpm (через Homebrew **или** в `~/` без прав admin)
- зависимости, база, захват экрана, фоновые сервисы
- свободный порт **5001** (или 5002, 5003… если занят)
- открывает страницу ключа Gemini и `http://localhost:ПОРТ/#settings`

macOS может попросить:
- пароль admin (только Homebrew, можно без него);
- **Command Line Tools** — не нужны для релизного ZIP (v0.0.9+): `focus-capture` уже собран; Homebrew с нуля не ставится;
- **Screen Recording** для `mac/bin/focus-capture`.

**Не используйте `sudo brew`.**

## После установки

```bash
make diagnose
make pause MIN=10
make backup
```

Дашборд: смотрите порт в `.env` (`PORT=...`) или вывод `make diagnose`.

## Секреты

| Что | Где |
|-----|-----|
| Gemini key | дашборд → Settings → `focus-app-settings.json` |
| История | `focus.db` |
| Telegram | `.env` (опционально) |

## Telegram (опционально)

[@BotFather](https://t.me/botfather) → `TG_BOT_TOKEN`, [@userinfobot](https://t.me/userinfobot) → `TG_CHAT_ID` в `.env`.
