export type Category = string;

export interface AnalysisResult {
  score: number; // 0-10
  category: Category;
  summary: string;
  direction_id?: string | null;
}

export interface LLMProvider {
  analyze(imageBase64: string, prompt?: string): Promise<AnalysisResult>;
}

export function normalizeDirectionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized === "null") return null;
  return normalized;
}
