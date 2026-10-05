import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSettings,
  saveSettings,
  testSettings,
  getStatus,
  fetchGeminiModels,
  type Settings,
  type SettingsResponse,
} from "@/api";

const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_KEYS_URL = "https://aistudio.google.com/api-keys";

/** Резервные ключи для отправки на сервер: trim, без пустых и дублей. */
function cleanTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokens) {
    const t = raw.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function StatusDot({ alive }: { alive: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${alive ? "bg-green-400" : "bg-red-400"}`} />
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: currentSettings } = useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const { data: status } = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: 15_000,
  });

  const [form, setForm] = useState<Settings>({
    provider: "gemini",
    token: "",
    tokens: [],
    model: DEFAULT_GEMINI_MODEL,
    screenshot_interval: 2,
    idle_threshold: 120,
    focused_score_threshold: 6,
    prompt: "",
  });
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [tokenSaving, setTokenSaving] = useState(false);
  const [backupTests, setBackupTests] = useState<Record<number, { success: boolean; message: string }>>({});
  const [backupTestingIdx, setBackupTestingIdx] = useState<number | null>(null);
  const settingsHydrated = useRef(false);
  const tokenSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (currentSettings && !settingsHydrated.current) {
      const { allowed_categories: _a, default_prompt: _d, ...settings } = currentSettings;
      setForm(settings);
      settingsHydrated.current = true;
    }
  }, [currentSettings]);

  const saveMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(["settings"], data);
      queryClient.invalidateQueries({ queryKey: ["gemini-models"] });
      const { allowed_categories: _a, default_prompt: _d, ...settings } = data;
      setForm(settings);
      setSaved(true);
      setTokenSaving(false);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: () => setTokenSaving(false),
  });

  const testMutation = useMutation({
    mutationFn: () => testSettings(form.provider, form.token, form.model),
    onSuccess: (result) => {
      setTestResult(result);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: () => setTestResult({ success: false, message: "Connection failed. Check provider and token." }),
  });

  // Автосохранение ключей (основной + резервные) при вводе (debounce)
  const tokensSig = form.tokens.map((t) => t.trim()).join(" ");
  useEffect(() => {
    if (!settingsHydrated.current || !currentSettings) return;
    const trimmed = form.token.trim();
    const trimmedTokens = cleanTokens(form.tokens);
    const savedTokens = cleanTokens(currentSettings.tokens ?? []);
    const changed =
      trimmed !== currentSettings.token.trim() ||
      trimmedTokens.join(" ") !== savedTokens.join(" ");
    if (!changed) return;

    setTokenSaving(true);
    if (tokenSaveTimer.current) clearTimeout(tokenSaveTimer.current);
    tokenSaveTimer.current = setTimeout(() => {
      saveMutation.mutate({ ...form, token: trimmed, tokens: trimmedTokens });
    }, 800);

    return () => {
      if (tokenSaveTimer.current) clearTimeout(tokenSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ключи: token + резервные
  }, [form.token, tokensSig, currentSettings?.token]);

  const tokenDirty =
    !!currentSettings && form.token.trim() !== currentSettings.token.trim();
  const tokensDirty =
    !!currentSettings &&
    cleanTokens(form.tokens).join(" ") !== cleanTokens(currentSettings.tokens ?? []).join(" ");

  const geminiModelsQuery = useQuery({
    queryKey: ["gemini-models", tokenDirty ? form.token : "saved"],
    queryFn: () => fetchGeminiModels(tokenDirty ? form.token : undefined),
    enabled:
      form.provider === "gemini" &&
      !!currentSettings &&
      (tokenDirty ? form.token.trim().length > 0 : currentSettings.token.trim().length > 0),
    staleTime: 5 * 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  });

  const geminiModelOptions = geminiModelsQuery.data ?? [];
  const geminiSelectOptions =
    form.model && !geminiModelOptions.some((m) => m.id === form.model)
      ? [{ id: form.model, displayName: form.model }, ...geminiModelOptions]
      : geminiModelOptions;

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const updateBackupToken = (index: number, value: string) => {
    setForm((f) => ({ ...f, tokens: f.tokens.map((t, i) => (i === index ? value : t)) }));
    // Изменили ключ — прежний результат теста для этой строки больше не актуален.
    setBackupTests((r) => {
      const n = { ...r };
      delete n[index];
      return n;
    });
  };
  const addBackupToken = () => setForm((f) => ({ ...f, tokens: [...f.tokens, ""] }));
  const removeBackupToken = (index: number) => {
    setForm((f) => ({ ...f, tokens: f.tokens.filter((_, i) => i !== index) }));
    setBackupTests({}); // индексы сдвигаются — сбрасываем результаты тестов
  };

  // Проверка резервного ключа без сохранения: список моделей (throw на невалидном ключе).
  const testBackupKey = async (index: number) => {
    const key = form.tokens[index]?.trim();
    if (!key) return;
    setBackupTestingIdx(index);
    setBackupTests((r) => {
      const n = { ...r };
      delete n[index];
      return n;
    });
    try {
      await fetchGeminiModels(key);
      setBackupTests((r) => ({ ...r, [index]: { success: true, message: "Ключ рабочий" } }));
    } catch (e) {
      setBackupTests((r) => ({
        ...r,
        [index]: { success: false, message: e instanceof Error ? e.message : "Ключ не прошёл проверку" },
      }));
    } finally {
      setBackupTestingIdx(null);
    }
  };

  const handleTest = () => {
    setTestResult(null);
    saveMutation.mutate(form, {
      onSuccess: () => testMutation.mutate(),
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <button
          onClick={() => saveMutation.mutate(form)}
          disabled={saveMutation.isPending}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            saved
              ? "bg-green-500/15 text-green-300 border border-green-500/20"
              : "bg-primary text-primary-foreground hover:opacity-90"
          }`}
        >
          {saveMutation.isPending ? "Saving…" : saved ? "Saved" : "Save Settings"}
        </button>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">System Status</h2>

        {status ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Watcher process</span>
              <div className="flex items-center gap-2">
                <StatusDot alive={status.watcher_alive} />
                <span className={`text-sm font-medium ${status.watcher_alive ? "text-green-400" : "text-red-400"}`}>
                  {status.watcher_alive ? "Running" : "Stopped"}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Last screenshot</span>
              <span className="text-sm font-medium text-foreground tabular-nums">
                {new Date(status.last_screenshot).toLocaleString([], {
                  month: "short", day: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Fetching status…</div>
        )}
      </div>

      <div className="bg-card border border-card-border rounded-xl p-5 space-y-5">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI Provider</h2>

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">Provider</label>
          <div className="flex gap-2 mt-1">
            {(["gemini", "ollama"] as const).map((p) => (
              <button
                key={p}
                onClick={() => {
                  update("provider", p);
                  if (p === "gemini" && form.model.includes("llava")) {
                    update("model", DEFAULT_GEMINI_MODEL);
                  } else if (p === "ollama" && form.model.includes("gemini")) {
                    update("model", "llava:7b");
                  }
                }}
                className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                  form.provider === p
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">
            {form.provider === "gemini" ? "API Token" : "Ollama Base URL"}
          </label>
          {form.provider === "gemini" && (
            <p className="text-xs text-muted-foreground">
              Создайте ключ на{" "}
              <a
                href={GEMINI_KEYS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                aistudio.google.com/api-keys
              </a>
              . Название проекта и ключа — любые. Скопируйте ключ и вставьте сюда — сохранится автоматически.
            </p>
          )}
          <div className="flex gap-2 mt-1">
            <input
              type={form.provider === "gemini" ? "password" : "text"}
              value={form.token}
              onChange={(e) => update("token", e.target.value)}
              placeholder={form.provider === "gemini" ? "AIza…" : "http://localhost:11434"}
              className="flex-1 bg-background border border-input rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono placeholder:font-sans placeholder:text-muted-foreground/60"
            />
            <button
              onClick={handleTest}
              disabled={testMutation.isPending || saveMutation.isPending || !form.token}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium border border-border hover:bg-accent transition-colors disabled:opacity-50"
            >
              {testMutation.isPending || saveMutation.isPending ? "Testing…" : "Test"}
            </button>
          </div>
          {tokenSaving && !saveMutation.isPending && (
            <p className="text-xs text-muted-foreground mt-1">Сохранение ключа…</p>
          )}
          {tokenDirty && !tokenSaving && !saveMutation.isPending && (
            <p className="text-xs text-amber-300/90 mt-1">Ключ изменён — сохранится через секунду</p>
          )}
          {testResult && (
            <div
              className={`mt-2 px-3 py-2 rounded-md text-xs flex items-center gap-2 ${
                testResult.success
                  ? "bg-green-500/10 text-green-300 border border-green-500/20"
                  : "bg-red-500/10 text-red-300 border border-red-500/20"
              }`}
            >
              <span>{testResult.success ? "✓" : "✗"}</span>
              {testResult.message}
            </div>
          )}
        </div>

        {form.provider === "gemini" && (
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Резервные ключи (ротация)</label>
            <p className="text-xs text-muted-foreground">
              Если основной ключ упрётся в лимит или ошибку — анализ уйдёт на резервные по порядку.
              Каждый ключ можно проверить кнопкой; сохраняются автоматически. Список моделей — по основному ключу.
            </p>
            {form.tokens.length > 0 && (
              <div className="space-y-2 mt-1">
                {form.tokens.map((t, i) => {
                  const res = backupTests[i];
                  const testing = backupTestingIdx === i;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex gap-2 items-center">
                        <span className="text-xs text-muted-foreground w-5 tabular-nums text-right">{i + 2}.</span>
                        <input
                          type="password"
                          value={t}
                          onChange={(e) => updateBackupToken(i, e.target.value)}
                          placeholder="AIza…"
                          className="flex-1 bg-background border border-input rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono placeholder:font-sans placeholder:text-muted-foreground/60"
                        />
                        <button
                          onClick={() => testBackupKey(i)}
                          disabled={testing || !t.trim()}
                          className="px-3 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium border border-border hover:bg-accent transition-colors disabled:opacity-50"
                        >
                          {testing ? "Testing…" : "Test"}
                        </button>
                        <button
                          onClick={() => removeBackupToken(i)}
                          className="px-3 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium border border-border hover:bg-accent hover:text-red-300 transition-colors"
                          aria-label="Remove key"
                        >
                          ✕
                        </button>
                      </div>
                      {res && (
                        <p className={`text-xs pl-7 ${res.success ? "text-green-300" : "text-red-300"}`}>
                          {res.success ? "✓" : "✗"} {res.message}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex items-center gap-3">
              <button onClick={addBackupToken} className="text-xs text-primary hover:underline">
                + Добавить резервный ключ
              </button>
              {tokensDirty ? (
                <span className="text-xs text-amber-300/90">
                  {tokenSaving ? "Сохранение…" : "Изменено — сохранится через секунду"}
                </span>
              ) : saved && form.tokens.length > 0 ? (
                <span className="text-xs text-green-300/90">Сохранено ✓</span>
              ) : null}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">Model</label>
          {form.provider === "gemini" ? (
            <>
              <select
                value={form.model}
                onChange={(e) => update("model", e.target.value)}
                disabled={!form.token.trim()}
                className="mt-1 w-full bg-background border border-input rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono disabled:opacity-50"
              >
                {!form.token.trim() ? (
                  <option value={form.model}>Введите API token</option>
                ) : geminiSelectOptions.length === 0 ? (
                  <option value={form.model}>{form.model}</option>
                ) : (
                  geminiSelectOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName !== m.id ? `${m.displayName} (${m.id})` : m.id}
                    </option>
                  ))
                )}
              </select>
              {geminiModelsQuery.isFetching && (
                <p className="text-xs text-muted-foreground mt-1">Загрузка моделей…</p>
              )}
              {geminiModelsQuery.isError && (
                <p className="text-xs text-red-300/90 mt-1">
                  Не удалось загрузить список:{" "}
                  {geminiModelsQuery.error instanceof Error
                    ? geminiModelsQuery.error.message
                    : "ошибка API"}
                </p>
              )}
            </>
          ) : (
            <input
              type="text"
              value={form.model}
              onChange={(e) => update("model", e.target.value)}
              placeholder="llava:7b"
              className="mt-1 w-full bg-background border border-input rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono placeholder:font-sans placeholder:text-muted-foreground/60"
            />
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {form.provider === "gemini"
              ? "Список с Google API (модели с generateContent). Сохранённая модель остаётся в списке, даже если API её не вернул."
              : "Локальный Ollama (не используется по умолчанию)"}
          </p>
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Analysis Prompt</h2>
        <textarea
          value={form.prompt}
          onChange={(e) => update("prompt", e.target.value)}
          rows={6}
          placeholder="Leave empty for default prompt"
          className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono resize-y placeholder:font-sans placeholder:text-muted-foreground/60"
        />
        <p className="text-xs text-muted-foreground">
          Промпт уходит в LLM с каждым скриншотом. Ответ — JSON: score, category, summary. Категория только из списка ниже.
        </p>
        {currentSettings?.allowed_categories?.length ? (
          <p className="text-xs text-muted-foreground">
            Допустимые категории: {currentSettings.allowed_categories.join(", ")}
          </p>
        ) : null}
        {currentSettings?.default_prompt && (
          <button
            type="button"
            onClick={() => update("prompt", currentSettings.default_prompt)}
            className="text-xs text-primary hover:underline"
          >
            Сбросить промпт по умолчанию
          </button>
        )}
      </div>

      <div className="bg-card border border-card-border rounded-xl p-5 space-y-5">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Capture</h2>

        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Screenshot Interval</label>
          <div className="flex gap-2 mt-1">
            {([1, 2, 5, 10] as const).map((v) => (
              <button
                key={v}
                onClick={() => update("screenshot_interval", v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                  form.screenshot_interval === v
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {v}m
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <label className="text-sm text-muted-foreground">Idle Threshold</label>
            <span className="text-sm font-medium text-foreground tabular-nums">{form.idle_threshold}s</span>
          </div>
          <input
            type="range"
            min="30" max="600" step="30"
            value={form.idle_threshold}
            onChange={(e) => update("idle_threshold", parseInt(e.target.value))}
            className="w-full accent-primary h-1.5 rounded-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>30s</span>
            <span>10min</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <label className="text-sm text-muted-foreground">Focused Score Threshold</label>
            <span className="text-sm font-medium text-foreground tabular-nums">{form.focused_score_threshold} / 10</span>
          </div>
          <input
            type="range"
            min="1" max="10" step="1"
            value={form.focused_score_threshold}
            onChange={(e) => update("focused_score_threshold", parseInt(e.target.value))}
            className="w-full accent-primary h-1.5 rounded-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>1</span>
            <span>10</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Screens with score ≥ {form.focused_score_threshold} count as Deep Work and feed your focus sessions, daily goal and streak.
          </p>
        </div>
      </div>
    </div>
  );
}
