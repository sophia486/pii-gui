import { describe, expect, it } from "vitest";

import { uiCopy, type AppLanguage } from "./i18n";

const languages = Object.keys(uiCopy) as AppLanguage[];

function collectLeaves(
  value: unknown,
  prefix = "",
): Record<string, string> {
  const leaves: Record<string, string> = {};
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (child !== null && typeof child === "object") {
        Object.assign(leaves, collectLeaves(child, path));
      } else {
        leaves[path] = String(child);
      }
    }
  }
  return leaves;
}

function placeholderSet(value: string): string[] {
  const placeholders: string[] = [];
  for (const match of value.matchAll(/\{([a-zA-Z]+)\}/g)) {
    placeholders.push(match[1]);
  }
  return placeholders.sort();
}

describe("uiCopy", () => {
  const enLeaves = collectLeaves(uiCopy.en);

  it.each(languages)("%s mirrors the en key structure", (language) => {
    const actual = Object.keys(collectLeaves(uiCopy[language])).sort();
    const expected = Object.keys(enLeaves).sort();
    expect(actual).toEqual(expected);
  });

  it("keeps every string non-empty in all languages", () => {
    for (const language of languages) {
      const empty = Object.entries(collectLeaves(uiCopy[language]))
        .filter(([, value]) => value.trim().length === 0)
        .map(([path]) => path);
      expect(empty, `${language} has empty strings`).toEqual([]);
    }
  });

  it("keeps placeholders aligned with en for every key", () => {
    const mismatched: string[] = [];
    for (const language of languages) {
      if (language === "en") continue;
      const leaves = collectLeaves(uiCopy[language]);
      for (const [path, expectedValue] of Object.entries(enLeaves)) {
        if (
          JSON.stringify(placeholderSet(leaves[path])) !==
          JSON.stringify(placeholderSet(expectedValue))
        ) {
          mismatched.push(`${language}:${path}`);
        }
      }
    }
    expect(mismatched).toEqual([]);
  });
});
