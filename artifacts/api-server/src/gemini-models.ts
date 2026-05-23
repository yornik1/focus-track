/** Таймаут запроса списка моделей (мс). */
const FETCH_TIMEOUT_MS = 15_000;

const MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** Исключаем модели, не подходящие для generateContent со скриншотами. */
const EXCLUDED_NAME_PARTS = [
  "embedding",
  "embed",
  "imagen",
  "veo",
  "aqa",
  "tts",
  "text-embedding",
  "gemma",
  "learnlm",
  "robotics",
  "nano-banana",
] as const;

export interface GeminiModelOption {
  id: string;
  displayName: string;
}

interface GoogleModelEntry {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

interface GoogleModelsResponse {
  models?: GoogleModelEntry[];
  nextPageToken?: string;
}

function stripModelsPrefix(name: string): string {
  return name.startsWith("models/") ? name.slice("models/".length) : name;
}

function isUsableGeminiModel(entry: GoogleModelEntry): boolean {
  const methods = entry.supportedGenerationMethods;
  if (!methods?.includes("generateContent")) return false;
  const raw = entry.name ?? "";
  const id = stripModelsPrefix(raw).toLowerCase();
  if (!id.startsWith("gemini")) return false;
  return !EXCLUDED_NAME_PARTS.some((part) => id.includes(part));
}

function sortModels(a: GeminiModelOption, b: GeminiModelOption): number {
  return a.id.localeCompare(b.id);
}

/**
 * Список моделей Gemini с generateContent (пагинация Google API).
 */
export async function listGeminiModels(apiKey: string): Promise<GeminiModelOption[]> {
  const key = apiKey.trim();
  if (!key) {
    throw new Error("API key is required");
  }

  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const byId = new Map<string, GeminiModelOption>();
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ key, pageSize: "100" });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${MODELS_URL}?${params}`, { signal, method: "GET" });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error("Invalid or forbidden Gemini API key");
      }
      let detail = `Gemini API returned ${res.status}`;
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        const m = j.error?.message;
        if (typeof m === "string" && m.length > 0) {
          detail = m.length > 200 ? `${m.slice(0, 200)}…` : m;
        }
      } catch {
        // ignore
      }
      throw new Error(detail);
    }

    const body = (await res.json()) as GoogleModelsResponse;
    for (const entry of body.models ?? []) {
      if (!isUsableGeminiModel(entry) || !entry.name) continue;
      const id = stripModelsPrefix(entry.name);
      byId.set(id, {
        id,
        displayName: entry.displayName?.trim() || id,
      });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  return [...byId.values()].sort(sortModels);
}
