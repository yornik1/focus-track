/** Таймаут HTTP-запросов при проверке провайдера (мс). */
const FETCH_TIMEOUT_MS = 15_000;

export type LlmSettingsProvider = "gemini" | "ollama";

export type LlmConnectionTestResult = { success: boolean; message: string };

/** Нормализует базовый URL Ollama к origin (GET /api/tags всегда с корня хоста). */
function normalizeOllamaOrigin(raw: string): string {
  const t = raw.trim();
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    u = new URL(`http://${t}`);
  }
  if (!u.hostname) {
    throw new TypeError("invalid ollama url");
  }
  return u.origin;
}

async function testGemini(apiKey: string, signal: AbortSignal): Promise<LlmConnectionTestResult> {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models?" +
    new URLSearchParams({ key: apiKey, pageSize: "1" });
  const res = await fetch(url, { signal, method: "GET" });
  if (res.ok) {
    return { success: true, message: "Connection successful" };
  }
  if (res.status === 401 || res.status === 403) {
    return { success: false, message: "Invalid or forbidden Gemini API key" };
  }
  let detail = "";
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    const m = j.error?.message;
    if (typeof m === "string" && m.length > 0) {
      detail = m.length > 200 ? `${m.slice(0, 200)}…` : m;
    }
  } catch {
    // тело не JSON — оставляем пустое detail
  }
  return {
    success: false,
    message: detail || `Gemini API returned ${res.status}`,
  };
}

async function testOllama(baseInput: string, signal: AbortSignal): Promise<LlmConnectionTestResult> {
  let origin: string;
  try {
    origin = normalizeOllamaOrigin(baseInput);
  } catch {
    return { success: false, message: "Invalid Ollama base URL" };
  }
  const res = await fetch(`${origin}/api/tags`, { signal, method: "GET" });
  if (res.ok) {
    return { success: true, message: "Connection successful" };
  }
  return { success: false, message: `Ollama returned ${res.status}` };
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError")
  );
}

/**
 * Проверяет доступность Gemini (ключ) или Ollama (base URL) без сохранения настроек.
 * Не бросает наружу: сетевые и прочие ошибки превращаются в { success: false }.
 */
export async function testLlmConnection(
  provider: LlmSettingsProvider,
  tokenRaw: string
): Promise<LlmConnectionTestResult> {
  const token = tokenRaw.trim();
  if (!token) {
    return { success: false, message: "provider and token are required" };
  }

  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

  try {
    if (provider === "gemini") {
      return await testGemini(token, signal);
    }
    return await testOllama(token, signal);
  } catch (err) {
    if (isAbortError(err)) {
      return { success: false, message: "Connection timed out" };
    }
    if (err instanceof TypeError) {
      // обычно сбой DNS / сеть недоступна
      return { success: false, message: "Network error: could not reach provider" };
    }
    return { success: false, message: "Connection check failed" };
  }
}
