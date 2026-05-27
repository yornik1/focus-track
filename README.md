# Focus Tracker

Локальный мониторинг продуктивности на macOS. Скриншоты → Gemini → оценка фокуса → дашборд.

## Установка

### Два пользователя на одном Mac (mich + claw)

macOS **закрывает домашние папки** между пользователями: `/Users/mich/Downloads` для `claw` не существует. ZIP лежит там, куда у второго юзера **нет прав на чтение** — Finder и Archive Utility не смогут его распаковать, отсюда «нет доступа к разархивации». Это системная изоляция, не баг архива.

**Что делать:**

1. **claw скачивает сам** — войти под `claw`, GitHub → Download ZIP → свой `~/Downloads`, распаковать как обычно.
2. **Через общую папку** — mich кладёт ZIP туда, где оба имеют доступ:
   ```bash
   cp ~/Downloads/focus-track-*.zip /Users/Shared/
   ```
   Под `claw`: Finder → **Macintosh HD → Users → Shared** → двойной клик по ZIP.  
   Или Terminal:
   ```bash
   cd /Users/Shared && unzip -o focus-track-*.zip && mv focus-track-* ~/focus-track
   ```

У каждого пользователя — **своя** копия в `~/focus-track`, свой порт, свои ключи.

### Обычная установка

1. Скачайте ZIP на GitHub (**Code → Download ZIP**), распакуйте.
2. Terminal:
   ```bash
   cd ~/Downloads/focus-track-0.0.7
   make focus-great-again
   ```
   Нет `make`? → `bash scripts/bootstrap.sh`

В конце откроется браузер на **Settings** — создайте ключ на [aistudio.google.com/api-keys](https://aistudio.google.com/api-keys) (название проекта и ключа — любые), скопируйте и вставьте в поле API Token. Ключ сохранится автоматически; **Test** проверит соединение.

Повторный запуск безопасен — докачает недостающее.

## Что делает установка

- Node + pnpm (через Homebrew **или** в `~/` без прав admin)
- зависимости, база, захват экрана, фоновые сервисы
- свободный порт **5001** (или 5002, 5003… если занят)
- открывает `http://localhost:ПОРТ/#settings`

macOS может попросить:
- пароль admin (только Homebrew, можно без него);
- **Command Line Tools** — только если в ZIP нет `mac/bin/focus-capture` (в релизах он уже есть);
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
