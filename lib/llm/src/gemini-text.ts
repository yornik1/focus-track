import { GoogleGenerativeAI } from "@google/generative-ai";
import { FALLBACK_MODELS, isAuthError, isRetryableGeminiError, normalizeGeminiModelId } from "./gemini-provider";

/** Предел времени по умолчанию: вызов стоит внутри цикла снимков и не должен его задерживать. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Текстовый вызов Gemini без картинки. Ротация ключей и запасные модели — как в `GeminiProvider.analyze`.
 * `timeoutMs` ограничивает весь вызов целиком, со всеми ключами и моделями.
 */
export async function generateGeminiText(opts: {
  apiKeys: string[];
  model: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<string> {
  const apiKeys = opts.apiKeys.map((k) => k.trim()).filter(Boolean);
  if (apiKeys.length === 0) throw new Error("Gemini API key is not configured");

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = normalizeGeminiModelId(opts.model);
  const modelsToTry = [model, ...FALLBACK_MODELS.filter((m) => m !== model)];
  // Свой AbortController вместо опции `timeout` из SDK: её таймер не снимается и держит процесс после ответа.
  const controller = new AbortController();

  const attempt = async (): Promise<string> => {
    let lastError: unknown;

    // Внешний цикл — ключи (ротация), внутренний — модели (fallback внутри ключа).
    for (const apiKey of apiKeys) {
      const client = new GoogleGenerativeAI(apiKey);

      for (const modelId of modelsToTry) {
        try {
          const result = await client
            .getGenerativeModel({ model: modelId })
            .generateContent(opts.prompt, { signal: controller.signal });
          return result.response.text();
        } catch (err) {
          lastError = err;
          if (controller.signal.aborted) throw err; // время вышло — новых запросов не начинаем
          if (isAuthError(err)) break; // сам ключ негодный → следующий ключ, модели не спасут
          if (!isRetryableGeminiError(err)) throw err; // не временная ошибка и не auth → реальная ошибка
        }
      }
    }

    throw lastError;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Gemini text call timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([attempt(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
