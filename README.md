# Focus Tracker

Локальный мониторинг продуктивности на macOS. Скриншоты → Gemini → оценка фокуса → дашборд.

## Setup

```bash
pnpm install

# Скомпилировать утилиту захвата экрана
swiftc -O -o mac/bin/focus-capture mac/bin/focus-capture.swift \
  -framework Cocoa -framework ScreenCaptureKit

# При первом запуске: дать Screen Recording permission бинарнику mac/bin/focus-capture
# System Settings → Privacy → Screen Recording → "+" → выбрать mac/bin/focus-capture
```

## Запуск

```bash
pnpm -w run dev    # дашборд на http://localhost:5001
```

API ключ настраивается через дашборд: Settings → вставить Gemini key → Test connection → сохранится автоматически.

## Telegram-уведомления (опционально)

Для получения алертов при критических ошибках (API key невалиден, квота закончилась):

1. Создать бота через [@BotFather](https://t.me/botfather), получить `BOT_TOKEN`
2. Узнать свой `CHAT_ID`: написать боту [@userinfobot](https://t.me/userinfobot)
3. Добавить в `.env`:
```bash
TG_BOT_TOKEN=123456:ABC-DEF...
TG_CHAT_ID=123456789
```

Уведомление придёт после 3 провалов анализа подряд (при наличии интернета).

## Автозахват скриншотов

```bash
./scripts/setup-launchagent.sh
```

Это установит LaunchAgent который каждые 2-10 минут делает скрин → анализирует → пишет в БД.

Логи: `data/logs/`, скрины: `data/captures/` (авто-удаляются через 7 дней).

## Ручной тест

```bash
mac/bin/focus-capture /tmp/test.jpg 1280 0.4
pnpm --filter @workspace/scripts run analyze /tmp/test.jpg
```
