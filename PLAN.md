# План дореализации Focus Tracker

## Текущее состояние

Что ГОТОВО:
- ✅ Bash-скрипты захвата (`mac/capture-if-active.sh`, `mac/capture-random-loop.sh`)
- ✅ LaunchAgent plist-файлы (но с путями-заглушками)
- ✅ LLM-адаптеры (Gemini + Ollama) в `lib/llm`
- ✅ SQLite схема + Drizzle ORM в `lib/db`
- ✅ Скрипт анализа `scripts/src/analyze-screenshot.ts`
- ✅ REST API (`artifacts/api-server`) — основные эндпоинты работают
- ✅ React-фронт (`artifacts/focus-tracker`) — 5 страниц, моки отключены (`USE_MOCK = false`)

Что НЕ ГОТОВО / сломано:
- ❌ LaunchAgent не настроен (пути `/path/to/focus-track`)
- ❌ `GET /api/stats/streak` — возвращает заглушку `{streak: 0, ...}`
- ❌ `POST /api/pause` — заглушка, не управляет реальным watcher
- ❌ Нет скрипта установки, который пропишет реальные пути
- ❌ Нет cleanup старых скриншотов
- ❌ Интеграционный тест (полный цикл) не проведён

---

## Шаги реализации (по порядку)

### Шаг 1: Скрипт установки LaunchAgent

Создать `scripts/setup-launchagent.sh`:

```bash
#!/bin/bash
# Прописывает реальные пути и устанавливает LaunchAgent

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$REPO_ROOT/mac/com.focus-track.screenshot.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.focus-track.screenshot.plist"

# Читаем GEMINI_API_KEY из .env если есть
if [ -f "$REPO_ROOT/.env" ]; then
  source "$REPO_ROOT/.env"
fi

# Генерируем plist с реальными путями
sed \
  -e "s|/path/to/focus-track|$REPO_ROOT|g" \
  -e "s|<string></string><!-- GEMINI_API_KEY -->|<string>${GEMINI_API_KEY:-}</string>|" \
  "$PLIST_SRC" > "$PLIST_DST"

# Выгружаем старый если был
launchctl unload "$PLIST_DST" 2>/dev/null

# Загружаем
launchctl load "$PLIST_DST"

echo "✓ LaunchAgent установлен: $PLIST_DST"
echo "  Логи: /tmp/focus-track-screenshot.out.log"
echo "  Ошибки: /tmp/focus-track-screenshot.err.log"
```

**Важно:** перед запуском пользователь должен:
1. Дать разрешение Screen Recording для Terminal/iTerm в System Settings → Privacy → Screen Recording
2. Иметь `GEMINI_API_KEY` в `.env` или установить Ollama

---

### Шаг 2: Исправить plist — сделать подстановку путей проще

В файле `mac/com.focus-track.screenshot.plist` заменить пустую строку для GEMINI_API_KEY на маркер:
```xml
<key>GEMINI_API_KEY</key>
<string></string>
```
Оставить как есть — скрипт setup заменит `/path/to/focus-track` на реальный путь.

---

### Шаг 3: Реализовать `GET /api/stats/streak`

Файл: `artifacts/api-server/src/routes/focus.ts`, строка ~190.

Логика:
1. Получить все уникальные даты из `focus_log` где `focus_score >= focused_score_threshold` (из settings, по умолчанию 6)
2. Считать текущий streak: от сегодня назад, сколько подряд дней есть записи
3. Считать best_streak: максимальная последовательность подряд дней
4. last7days: для каждого из 7 последних дней — avg_score или null, is_weekend

```typescript
router.get("/stats/streak", async (req, res) => {
  const settings = readAppSettings() ?? getDefaultAppSettings();
  const threshold = settings.focused_score_threshold ?? 6;
  
  // Все записи за последние 90 дней
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const rows = await db.select()
    .from(focusLogTable)
    .where(gte(focusLogTable.timestamp, Math.floor(since.getTime() / 1000)));
  
  // Группируем по датам, считаем avg
  const byDate = new Map<string, number[]>();
  for (const row of rows) {
    const date = row.datetime.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(row.focus_score);
  }
  
  // "Фокусный день" = avg_score >= threshold
  const focusedDates = new Set<string>();
  for (const [date, scores] of byDate) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg >= threshold) focusedDates.add(date);
  }
  
  // Текущий streak
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 90; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // пропускаем выходные
    const dateStr = d.toISOString().slice(0, 10);
    if (focusedDates.has(dateStr)) {
      streak++;
    } else {
      break;
    }
  }
  
  // Best streak (аналогично но по всем данным)
  const sortedDates = [...focusedDates].sort();
  let bestStreak = 0;
  let currentRun = 0;
  // ...подсчёт лучшего streak по рабочим дням...
  
  // last7days
  const last7days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const scores = byDate.get(dateStr);
    const avg = scores ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    last7days.push({
      date: dateStr,
      avg_score: avg ? Math.round(avg * 10) / 10 : null,
      is_weekend: d.getDay() === 0 || d.getDay() === 6,
    });
  }
  
  res.json({ streak, best_streak: bestStreak, last7days });
});
```

---

### Шаг 4: Реализовать `POST /api/pause`

Файл: `artifacts/api-server/src/routes/focus.ts`, строка ~207.

Простой подход — записывать время паузы в файл, bash-скрипт проверяет его:

1. API записывает файл `~/.focus-track-pause` с timestamp окончания паузы
2. В `capture-if-active.sh` добавить проверку в начале:
```bash
PAUSE_FILE="$HOME/.focus-track-pause"
if [ -f "$PAUSE_FILE" ]; then
  PAUSE_UNTIL=$(cat "$PAUSE_FILE")
  NOW=$(date +%s)
  if [ "$NOW" -lt "$PAUSE_UNTIL" ]; then
    exit 0  # на паузе
  else
    rm -f "$PAUSE_FILE"
  fi
fi
```

3. API endpoint:
```typescript
router.post("/pause", async (req, res) => {
  const { duration } = req.body; // минуты или "evening"
  let pauseUntil: number;
  if (duration === "evening") {
    const end = new Date();
    end.setHours(23, 59, 59);
    pauseUntil = Math.floor(end.getTime() / 1000);
  } else {
    pauseUntil = Math.floor(Date.now() / 1000) + duration * 60;
  }
  const pauseFile = path.join(os.homedir(), ".focus-track-pause");
  fs.writeFileSync(pauseFile, String(pauseUntil));
  res.json({ success: true, paused_until: new Date(pauseUntil * 1000).toISOString() });
});
```

---

### Шаг 5: Ручной тест полного цикла

Без LaunchAgent, просто проверить что цепочка работает:

```bash
cd /Users/mich/PycharmProjects/focus-track

# 1. Сделать скриншот вручную
screencapture -x -t jpg /tmp/test-focus.jpg

# 2. Запустить анализ
pnpm --filter @workspace/scripts run analyze /tmp/test-focus.jpg

# 3. Проверить БД
sqlite3 focus.db "SELECT * FROM focus_log ORDER BY id DESC LIMIT 5;"

# 4. Проверить API
curl http://localhost:5001/api/stats/today | jq .

# 5. Открыть дашборд
open http://localhost:5001
```

Если шаг 2 работает — скриншотинг через LaunchAgent тоже будет работать.

---

### Шаг 6: Агрессивное сжатие скриншотов (килобайты вместо мегабайтов)

**Цель:** LLM-анализ не требует высокого разрешения — 768px и quality 0.5-0.6 достаточно. Это экономит трафик к API и уменьшает latency.

**Референс:** `~/focus-tracker/bin/focus-capture.swift` — Swift-утилита через ScreenCaptureKit, рендерит сразу в нужный размер.

**Ключевое решение:** 1280px + quality 0.4 (~150-350 KB). Нужно именно 1280, не 768 — LLM должна различать контент (мемы vs статья в Telegram, Reddit vs документация в браузере), а не просто приложение.

**Два варианта:**

#### Вариант A: Скомпилировать Swift-утилиту (рекомендуется)

Скопировать `focus-capture.swift` в `mac/bin/`, поменять параметры и скомпилировать:
```bash
swiftc -O -o mac/bin/focus-capture mac/bin/focus-capture.swift \
  -framework Cocoa -framework ScreenCaptureKit
```

В Swift-коде изменить:
- `maxWidth` по умолчанию: `768` → `1280`
- `compressionFactor`: `0.6` → `0.4`

Использование в `capture-if-active.sh`:
```bash
CAPTURE_BIN="${FOCUS_TRACK_ROOT}/mac/bin/focus-capture"
"$CAPTURE_BIN" "$tmp" "1280"
```

Преимущества:
- Скрин сразу в нужном разрешении (не делает full-res → resize)
- Один проход — capture + resize + compress
- ScreenCaptureKit (не `screencapture`) — меньше проблем с permissions на macOS 14+

#### Вариант B: sips (если Swift не хочется)

Заменить в `capture-if-active.sh`:
```bash
# Было: sips -Z 1280 (без пережатия quality)
# Стало: sips -Z 1280 + quality 40%
/usr/bin/sips -Z 1280 "${tmp}" --out "${final}" >/dev/null 2>&1
/usr/bin/sips -s formatOptions 40 "${final}" --out "${final}" >/dev/null 2>&1
```

Результат ~200-400 KB. Два прохода, чуть больше файл, но работает без компиляции.

---

### Шаг 7: Idle-трекинг и подавление скринов при простое

**Текущая проблема:** `capture-if-active.sh` проверяет idle < 60 сек и **пропускает активных** пользователей (логика инвертирована — `exit 0` когда idle МЕНЬШЕ порога, т.е. пользователь НЕДАВНО был активен).

**Правильная логика (как в `~/focus-tracker-capture.sh`):**
- Если idle > 300 сек → пользователь ушёл → НЕ делать скрин
- Если idle < 300 сек → пользователь за компом → делать скрин

Исправить `capture-if-active.sh`:
```bash
# Порог простоя: если idle БОЛЬШЕ этого — пропускаем
: "${FOCUS_TRACK_IDLE_SEC:=300}"

idle_line=$(/usr/sbin/ioreg -c IOHIDSystem -r -k HIDIdleTime 2>/dev/null | /usr/bin/grep HIDIdleTime | /usr/bin/head -1 || true)
idle_ns="${idle_line##*= }"
idle_ns="${idle_ns//[^0-9]/}"
if [[ -n "${idle_ns}" ]]; then
  idle_s=$((idle_ns / 1000000000))
  if [[ "${idle_s}" -gt "${FOCUS_TRACK_IDLE_SEC}" ]]; then
    echo "$(date): Idle ${idle_s}s > ${FOCUS_TRACK_IDLE_SEC}s, пропускаю" >> /tmp/focus-track.log
    exit 0
  fi
fi
```

**Дополнительно — учёт idle в БД:**

Опционально записывать `category: "idle"` когда пользователь вернулся после длительного простоя:
- В `capture-random-loop.sh` отслеживать предыдущее состояние idle
- Если прошлый тик был idle, а текущий — активен, записать в БД запись `{category: "idle", score: 0, summary: "Простой X минут"}`
- Это даст полную картину на дашборде (видно когда юзер уходил)

---

### Шаг 8: Разрешение Screen Recording

Это главный "гемор с макосью":

1. Открыть System Settings → Privacy & Security → Screen Recording
2. Нажать "+" и добавить Terminal.app (или iTerm)
3. После этого `screencapture` будет работать из скриптов запущенных через Terminal

Для LaunchAgent — нужно добавить `/bin/bash` или создать маленький app-wrapper. На macOS 14+ можно также:
- Использовать Accessibility access вместо Screen Recording (для `screencapture`)
- Или запускать loop из Terminal напрямую (без LaunchAgent) как фоновый процесс

---

### Шаг 9 (опционально): Cleanup скриншотов

Добавить в `capture-if-active.sh` после анализа:
```bash
# Удалять скрины старше 7 дней
find "$HOME/Library/Application Support/focus-track/captures" -name "*.jpg" -mtime +7 -delete
```

---

## Порядок для модели-исполнителя

1. **Сначала** — исправить idle-логику в `capture-if-active.sh` (Шаг 7) — сейчас она инвертирована
2. **Потом** — сжатие скриншотов (Шаг 6) — скомпилировать Swift-утилиту или настроить sips
3. **Потом** — ручной тест (Шаг 5), чтобы убедиться что цепочка работает с новым сжатием
4. **Потом** — реализация streak API (Шаг 3)
5. **Потом** — реализация pause (Шаг 4)
6. **Потом** — скрипт setup (Шаг 1)
7. **Последним** — загрузка LaunchAgent и проверка автозапуска

## Критические зависимости

- `GEMINI_API_KEY` должен быть в `.env` — без него анализ не работает
- `pnpm install` должен быть выполнен — зависимости нужны для analyze-screenshot
- Screen Recording permission — без него `screencapture` вернёт чёрный экран
- Node.js 20+ и pnpm — для запуска TypeScript скриптов через tsx
