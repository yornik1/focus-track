# Focus Tracker

Локальный мониторинг продуктивности на macOS. Скриншоты → Gemini → оценка фокуса → дашборд.

## Быстрый старт

Нужны: macOS, git, интернет.

```bash
git clone <url-репозитория> focus-track
cd focus-track
make focus-great-again
```

Откройте http://localhost:5001 → **Settings** → вставьте Gemini API key → **Test connection**.

## Что делает `make focus-great-again`

1. Проверяет macOS и git
2. Устанавливает Node 20 и pnpm (через Homebrew, если нужно)
3. Ставит зависимости проекта
4. Создаёт базу данных
5. Компилирует утилиту захвата экрана (`mac/bin/focus-capture`)
6. Открывает настройки Screen Recording (если разрешение ещё не дано)
7. Запускает фоновые сервисы (LaunchAgents)

При первом запуске macOS может спросить пароль для установки Homebrew — это нормально.

## Screen Recording

После установки добавьте бинарник в список разрешённых:

**System Settings → Privacy & Security → Screen Recording → +**

Выберите файл `mac/bin/focus-capture` внутри папки проекта.

Проверка: `make diagnose`

## Настройки и секреты

| Что | Где |
|-----|-----|
| Gemini API key, модель, промпт | `focus-app-settings.json` (через дашборд Settings) |
| История фокуса | `focus.db` |
| Telegram (опционально) | `.env` — `TG_BOT_TOKEN`, `TG_CHAT_ID` |

Эти файлы **не попадают в git**. Перед переустановкой: `make backup`.

## Полезные команды

```bash
make help          # все команды
make dev           # дашборд вручную (без LaunchAgent)
make diagnose      # проверка системы
make pause MIN=10  # пауза 10 минут
make resume        # снять паузу
make stop-today    # стоп до 9:00 завтра
make backup        # бэкап settings + db + .env
make restore DIR=~/focus-track-backup/2026-05-23-120000
```

## Telegram-уведомления (опционально)

При 3 провалах анализа подряд (невалидный ключ, квота и т.п.):

1. Создайте бота через [@BotFather](https://t.me/botfather)
2. Узнайте `CHAT_ID` через [@userinfobot](https://t.me/userinfobot)
3. Добавьте в `.env`:
   ```
   TG_BOT_TOKEN=123456:ABC...
   TG_CHAT_ID=123456789
   ```

## Логи и данные

- Логи: `data/logs/`
- Скриншоты: `data/captures/` (удаляются через 7 дней)
- Дашборд: http://localhost:5001

## Ручной тест

```bash
mac/bin/focus-capture /tmp/test.jpg 1280 0.4
pnpm --filter @workspace/scripts run analyze /tmp/test.jpg
```

## Требования

- macOS (ScreenCaptureKit, LaunchAgents)
- Node ≥ 20, pnpm
- Xcode Command Line Tools (`xcode-select --install`) — для git и swiftc
