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

### Шаг 10: Фиксы из код-ревью

#### 10.1 Streak — не обнулять в начале дня

Файл: `artifacts/api-server/src/routes/focus.ts`, блок подсчёта текущего streak.

**Проблема:** Если сегодня утро и записей ещё нет — `focusedDates.has(today)` = false → streak обнуляется. Пользователь видит streak 0 до первого скрина дня.

**Фикс:**
```typescript
for (let i = 0; i < 90; i++) {
  const d = new Date(today);
  d.setDate(d.getDate() - i);
  const dow = d.getDay();
  if (dow === 0 || dow === 6) continue;
  const dateStr = d.toISOString().slice(0, 10);
  // Сегодня ещё нет данных — пропускаем, не ломаем streak
  if (i === 0 && !byDate.has(dateStr)) continue;
  if (focusedDates.has(dateStr)) {
    streak++;
  } else {
    break;
  }
}
```

---

#### 10.2 POST /api/pause — валидация duration

Файл: `artifacts/api-server/src/routes/focus.ts`, endpoint POST /api/pause.

**Проблема:** Если `duration` не число и не `"evening"` — запишется NaN в pause-файл.

**Фикс:**
```typescript
router.post("/pause", async (req, res) => {
  const { duration } = req.body;

  if (duration !== "evening" && (typeof duration !== "number" || duration <= 0)) {
    return res.status(400).json({ success: false, message: "duration must be positive number or 'evening'" });
  }

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

#### 10.3 sips — одна команда вместо двух проходов

Файл: `mac/capture-if-active.sh`, блок resize + compress.

**Проблема:** Два вызова sips (resize, потом formatOptions) — если второй молча падёт (`|| true`), все скрины будут 1-2 MB навсегда и никто не узнает.

**Фикс — один вызов sips с resize + quality:**
```bash
# Было (два прохода):
# /usr/bin/sips -Z 1280 "${tmp}" --out "${final}"
# /usr/bin/sips -s formatOptions 40 "${final}" --out "${final}.tmp" && mv ...

# Стало (один проход — resize + quality):
/usr/bin/sips -Z 1280 -s formatOptions 40 "${tmp}" --out "${final}" >/dev/null 2>&1

if [[ $? -ne 0 ]]; then
  # fallback: хотя бы просто переместить
  /bin/mv "${tmp}" "${final}"
else
  /bin/rm -f "${tmp}"
fi
```

Преимущества:
- Нет промежуточного файла
- Нет `|| true` который глотает ошибку сжатия
- Если sips упал — fallback на оригинал (не теряем скрин), но можно залогировать

---

#### 10.4 setup-launchagent.sh — не sourсить .env целиком

Файл: `scripts/setup-launchagent.sh`.

**Проблема:** `source .env` выполнит любые команды в файле.

**Фикс:**
```bash
# Было:
# source "$REPO_ROOT/.env"

# Стало:
if [ -f "$REPO_ROOT/.env" ]; then
  GEMINI_API_KEY=$(grep '^GEMINI_API_KEY=' "$REPO_ROOT/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")
  export GEMINI_API_KEY
fi
```

---

#### 10.5 Cleanup — не запускать find на каждом скрине

Файл: `mac/capture-if-active.sh`, строка с `find ... -delete`.

**Проблема:** `find` выполняется каждые 2-10 минут, хотя достаточно раз в день.

**Фикс — запускать cleanup только раз в день:**
```bash
CLEANUP_MARKER="/tmp/focus-track-cleanup-$(date +%Y%m%d)"
if [[ ! -f "${CLEANUP_MARKER}" ]]; then
  find "${out_dir}" -name "*.jpg" -mtime +7 -delete 2>/dev/null || true
  touch "${CLEANUP_MARKER}"
fi
```

---

### Шаг 11: Settings → сохранение ключа + использование при анализе + модель gemini-2.5-flash

**Текущее состояние:**

1. `POST /api/settings/test` — принимает `{provider, token}`, проверяет соединение, **но не сохраняет** ключ
2. `POST /api/settings` — сохраняет `{provider, token, ...}` в `focus-app-settings.json` — уже работает
3. `analyze-screenshot.ts` — читает `readAppSettings()`, берёт оттуда `provider` и `token` — **уже использует сохранённый ключ**
4. Модель захардкожена `gemini-2.0-flash-exp` в `GeminiProvider` конструкторе

**Что нужно:**

#### 11.1 Settings/test должен сохранять при успехе

Файл: `artifacts/api-server/src/routes/focus.ts`, endpoint `POST /api/settings/test`.

Сейчас test только проверяет соединение. Нужно: если тест прошёл — автоматически сохранять provider + token в settings (чтобы пользователь не жал отдельно "Save").

```typescript
router.post("/settings/test", async (req, res) => {
  const { provider, token } = req.body;
  const tokenStr = token != null ? String(token).trim() : "";
  if (!provider || !tokenStr) {
    return res.status(400).json({ success: false, message: "provider and token are required" });
  }
  const p = String(provider).toLowerCase();
  if (p !== "gemini" && p !== "ollama") {
    return res.status(400).json({ success: false, message: "provider must be gemini or ollama" });
  }
  const result = await testLlmConnection(p as "gemini" | "ollama", tokenStr);

  // Если тест успешен — сохраняем provider и token в settings
  if (result.success) {
    const current = readAppSettings() ?? getDefaultAppSettings();
    writeAppSettings({
      ...current,
      provider: p as "gemini" | "ollama",
      token: tokenStr,
    });
  }

  return res.status(200).json(result);
});
```

---

#### 11.2 Добавить поле `model` в AppSettings

Файл: `lib/db/src/app-settings.ts`.

Добавить поле `model` чтобы можно было менять модель из дашборда:

```typescript
export interface AppSettings {
  provider: "gemini" | "ollama";
  token: string;
  model: string;  // новое: "gemini-2.5-flash" | "gemini-2.0-flash-exp" | "llava:7b" и т.д.
  screenshot_interval: 1 | 2 | 5 | 10;
  idle_threshold: number;
  focused_score_threshold: number;
}
```

Дефолт для gemini: `"gemini-2.5-flash"` (новая дешёвая модель с vision).
Дефолт для ollama: `"llava:7b"`.

В `getDefaultAppSettings()`:
```typescript
model: fromEnv === "ollama" ? "llava:7b" : "gemini-2.5-flash",
```

В `normalizeStoredSettings()` — fallback на дефолт если поле отсутствует (для совместимости со старым JSON).

---

#### 11.3 Передавать model из settings в analyze-screenshot

Файл: `scripts/src/analyze-screenshot.ts`.

```typescript
const stored = readAppSettings();
const MODEL = stored?.model ?? "gemini-2.5-flash";

// ...
const provider =
  PROVIDER === "ollama"
    ? new OllamaProvider(OLLAMA_HOST, MODEL)
    : new GeminiProvider(GEMINI_API_KEY, MODEL);
```

`GeminiProvider` уже принимает `model` вторым аргументом — достаточно передать.

---

#### 11.4 Обновить дефолтную модель

Файл: `lib/llm/src/gemini-provider.ts`, строка 16.

```typescript
// Было:
constructor(apiKey: string, model: string = "gemini-2.0-flash-exp")

// Стало:
constructor(apiKey: string, model: string = "gemini-2.5-flash")
```

---

#### 11.5 Фронт — добавить выбор модели в Settings

Файл: `artifacts/focus-tracker/src/pages/Settings.tsx`.

Добавить dropdown/input для `model`:
- Для gemini: предложить `gemini-2.5-flash` (по умолчанию), `gemini-2.0-flash-exp`
- Для ollama: предложить `llava:7b` (по умолчанию), свободный ввод

---

**Итого flow после реализации:**

```
Пользователь в дашборде:
  1. Выбирает provider (gemini/ollama)
  2. Вводит token (API key / host)
  3. Выбирает модель (gemini-2.5-flash)
  4. Нажимает "Test connection"
     → POST /api/settings/test
     → Тест проходит → автоматически сохраняется в focus-app-settings.json
  5. Следующий analyze-screenshot.ts читает JSON
     → Использует сохранённый provider + token + model
```

---

### Шаг 12: Telegram-уведомления при критических ошибках

**Цель:** Если Gemini перестал отвечать (401/403/5xx подряд) — отправить уведомление в Telegram-канал. НЕ уведомлять при: комп выключен, нет сети (network error), idle.

**Env:**
```
TG_BOT_TOKEN=...
TG_CHAT_ID=...
```

Хранить в `.env` (не в JSON settings — это инфраструктурная штука, не UI-настройка).

**Логика — в `capture-if-active.sh` после анализа:**

```bash
FAIL_COUNTER="${DATA_DIR}/.fail-count"
FAIL_NOTIFY_THRESHOLD=3  # уведомить после 3 провалов подряд

# После analyze:
if [[ $? -ne 0 ]]; then
  # Проверяем что это НЕ сетевая ошибка (curl к google резолвится)
  if curl -s --max-time 5 https://google.com > /dev/null 2>&1; then
    # Сеть есть, значит это реальная ошибка (API key, quota, модель)
    count=$(cat "${FAIL_COUNTER}" 2>/dev/null || echo 0)
    count=$((count + 1))
    echo "${count}" > "${FAIL_COUNTER}"
    
    if [[ "${count}" -eq "${FAIL_NOTIFY_THRESHOLD}" ]]; then
      # Отправить в Telegram
      source "${FOCUS_TRACK_ROOT}/.env" 2>/dev/null
      if [[ -n "${TG_BOT_TOKEN:-}" && -n "${TG_CHAT_ID:-}" ]]; then
        msg="⚠️ Focus Tracker: анализ скринов не работает уже ${count} раз подряд. Проверь API key / квоту."
        curl -s "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
          -d chat_id="${TG_CHAT_ID}" \
          -d text="${msg}" > /dev/null 2>&1
      fi
    fi
  fi
else
  # Успех — сбрасываем счётчик
  rm -f "${FAIL_COUNTER}"
fi
```

**Что считается критической ошибкой:**
- Gemini вернул 401/403 (невалидный ключ)
- Gemini вернул 429 подряд (квота закончилась навсегда, не временный spike)
- Gemini вернул 5xx подряд (сервис лёг)
- Любой exit code != 0 от analyze при наличии сети

**Что НЕ считается ошибкой (не уведомлять):**
- Нет сети (curl к google не проходит) — значит комп в sleep / без WiFi
- Одиночный 503 — нормальный spike, пройдёт
- Idle / пауза — скрин не делался вообще

**Порог:** 3 провала подряд (при интервале 5 мин = 15 минут непрерывных ошибок).

**Дополнительно:** не спамить — после отправки нотификации не слать повторно до reset (успешный анализ).

---

## Порядок для модели-исполнителя

1. **Сначала** — фиксы из ревью (Шаг 10) — быстрые правки, предотвращают баги
2. **Потом** — settings + model (Шаг 11) — чтобы ключ сохранялся и модель была правильная
3. **Потом** — Telegram-уведомления (Шаг 12) — мониторинг здоровья
4. **Потом** — исправить idle-логику в `capture-if-active.sh` (Шаг 7) — сейчас инвертирована
5. **Потом** — сжатие скриншотов (Шаг 6) — скомпилировать Swift-утилиту или настроить sips
6. **Потом** — ручной тест (Шаг 5), чтобы убедиться что цепочка работает
7. **Потом** — реализация streak API (Шаг 3)
8. **Потом** — реализация pause (Шаг 4)
9. **Потом** — скрипт setup (Шаг 1)
10. **Последним** — загрузка LaunchAgent и проверка автозапуска

## Критические зависимости

- `GEMINI_API_KEY` должен быть в `.env` — без него анализ не работает
- `pnpm install` должен быть выполнен — зависимости нужны для analyze-screenshot
- Screen Recording permission — без него `screencapture` вернёт чёрный экран
- Node.js 20+ и pnpm — для запуска TypeScript скриптов через tsx
