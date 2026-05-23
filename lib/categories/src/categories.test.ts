import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_CATEGORIES,
  normalizeCategory,
  buildCategoryPromptSection,
  buildAnalysisPrompt,
} from "./index";

test("normalizeCategory: development → code", () => {
  assert.equal(normalizeCategory("development"), "code");
  assert.equal(normalizeCategory("Engineering"), "code");
  assert.equal(normalizeCategory("maintenance"), "code");
});

test("normalizeCategory: allowed проходит как есть", () => {
  assert.equal(normalizeCategory("research"), "research");
  assert.equal(normalizeCategory("COMMUNICATION"), "communication");
});

test("normalizeCategory: неизвестное → fallback code", () => {
  assert.equal(normalizeCategory("quantum_flux"), "code");
  assert.equal(normalizeCategory(""), "code");
});

test("buildCategoryPromptSection содержит закрытый список", () => {
  const section = buildCategoryPromptSection();
  for (const cat of ALLOWED_CATEGORIES) {
    assert.ok(section.includes(cat), `missing ${cat}`);
  }
  assert.ok(section.includes("Never use other words"));
});

test("buildAnalysisPrompt не дублирует Category rules", () => {
  const base = "Analyze.\n\nCategory rules:\n- category: code";
  assert.equal(buildAnalysisPrompt(base), base);
});

test("buildCategoryPromptSection: частые из БД", () => {
  const section = buildCategoryPromptSection(["code", "development", "code"]);
  assert.ok(section.includes("You often use"));
  assert.ok(section.includes("code"));
});
