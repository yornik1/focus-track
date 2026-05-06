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

### Шаг 6: Разрешение Screen Recording

Это главный "гемор с макосью":

1. Открыть System Settings → Privacy & Security → Screen Recording
2. Нажать "+" и добавить Terminal.app (или iTerm)
3. После этого `screencapture` будет работать из скриптов запущенных через Terminal

Для LaunchAgent — нужно добавить `/bin/bash` или создать маленький app-wrapper. На macOS 14+ можно также:
- Использовать Accessibility access вместо Screen Recording (для `screencapture`)
- Или запускать loop из Terminal напрямую (без LaunchAgent) как фоновый процесс

---

### Шаг 7 (опционально): Cleanup скриншотов

Добавить в `capture-if-active.sh` после анализа:
```bash
# Удалять скрины старше 7 дней
find "$HOME/Library/Application Support/focus-track/captures" -name "*.jpg" -mtime +7 -delete
```

---

## Порядок для модели-исполнителя

1. **Сначала** — ручной тест (Шаг 5), чтобы убедиться что `analyze-screenshot.ts` вообще работает
2. **Потом** — реализация streak API (Шаг 3)
3. **Потом** — реализация pause (Шаг 4)
4. **Потом** — скрипт setup (Шаг 1)
5. **Последним** — загрузка LaunchAgent и проверка автозапуска

## Критические зависимости

- `GEMINI_API_KEY` должен быть в `.env` — без него анализ не работает
- `pnpm install` должен быть выполнен — зависимости нужны для analyze-screenshot
- Screen Recording permission — без него `screencapture` вернёт чёрный экран
- Node.js 20+ и pnpm — для запуска TypeScript скриптов через tsx
