export * from "./focus";
export * from "./weekly";

/** Категории с цветами в календаре — единый whitelist для LLM и UI. */
export const ALLOWED_CATEGORIES = [
  "code",
  "research",
  "design",
  "writing",
  "video",
  "social",
  "gaming",
  "news",
  "communication",
] as const;

export type AllowedCategory = (typeof ALLOWED_CATEGORIES)[number];

/** Категории, которые считаются продуктивным временем в недельной статистике. */
export const PRODUCTIVE_CATEGORIES = [
  "code",
  "research",
  "design",
  "writing",
  "communication",
] as const;

export type ProductiveCategory = (typeof PRODUCTIVE_CATEGORIES)[number];

const PRODUCTIVE_SET = new Set<string>(PRODUCTIVE_CATEGORIES);

export function isProductiveCategory(category: string): boolean {
  return PRODUCTIVE_SET.has(category);
}

/** Минимум продуктивных минут за день, чтобы день шёл в streak. */
export const PRODUCTIVE_DAY_MINUTES = 30;

export const DEFAULT_CATEGORY_FALLBACK: AllowedCategory = "code";

const ALLOWED_SET = new Set<string>(ALLOWED_CATEGORIES);

/** Синонимы → каноническая категория. */
export const CATEGORY_ALIASES: Record<string, AllowedCategory> = {
  development: "code",
  engineering: "code",
  programming: "code",
  maintenance: "code",
  devops: "code",
  debugging: "code",
  coding: "code",
  planning: "research",
  career: "research",
  learning: "research",
  reading: "research",
  documentation: "research",
  docs: "research",
  meeting: "communication",
  meetings: "communication",
  slack: "communication",
  email: "communication",
  chat: "communication",
  messaging: "communication",
  youtube: "video",
  tutorial: "video",
  stream: "video",
  streaming: "video",
  twitter: "social",
  x: "social",
  facebook: "social",
  instagram: "social",
  reddit: "social",
  hacker: "news",
  hackernews: "news",
  hn: "news",
  articles: "news",
  shopping: "social",
  browse: "social",
  browsing: "social",
  game: "gaming",
  games: "gaming",
  idle: "social",
  entertainment: "social",
  figma: "design",
  sketch: "design",
  ui: "design",
  ux: "design",
  blog: "writing",
  editing: "writing",
};

/**
 * Приводит ответ LLM к одной из ALLOWED_CATEGORIES.
 */
export function normalizeCategory(
  raw: string,
  allowed: readonly string[] = ALLOWED_CATEGORIES,
): string {
  const key = raw.toLowerCase().trim().replace(/\s+/g, "_").slice(0, 30);
  if (!key) return DEFAULT_CATEGORY_FALLBACK;

  const allowedSet = new Set(allowed);
  if (allowedSet.has(key)) return key;

  const alias = CATEGORY_ALIASES[key];
  if (alias && allowedSet.has(alias)) return alias;

  for (const cat of allowed) {
    if (key.includes(cat) || cat.includes(key)) return cat;
  }

  return DEFAULT_CATEGORY_FALLBACK;
}

/** Блок правил категорий для промпта анализа скриншота. */
export function buildCategoryPromptSection(frequentFromDb?: string[]): string {
  const list = ALLOWED_CATEGORIES.join(", ");
  const lines = [
    "Category rules:",
    `- category: MUST be exactly one of: ${list}`,
    "- Never use other words (no development, engineering, maintenance, planning, career, shopping, etc.)",
    "- If unsure, pick the closest allowed category",
    "- Mappings: IDE/terminal/git/PR/deploy → code; papers/search/docs → research; Figma/UI mockups → design; blog/docs authoring → writing; YouTube/tutorials → video; social feeds/messengers → social or communication; games → gaming; news sites → news",
  ];

  if (frequentFromDb && frequentFromDb.length > 0) {
    const recent = frequentFromDb
      .map((c) => normalizeCategory(c))
      .filter((c, i, arr) => arr.indexOf(c) === i)
      .slice(0, 5);
    if (recent.length > 0) {
      lines.push(`- You often use these categories: ${recent.join(", ")} — still pick only from the allowed list above`);
    }
  }

  return lines.join("\n");
}

/** Собирает полный промпт: базовый текст + правила категорий (+ частые из БД). */
export function buildAnalysisPrompt(basePrompt: string, frequentFromDb?: string[]): string {
  const base = basePrompt.trim();
  const section = buildCategoryPromptSection(frequentFromDb);
  if (base.includes("Category rules:")) return base;
  return `${base}\n\n${section}`;
}
