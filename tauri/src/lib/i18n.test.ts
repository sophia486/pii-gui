import { describe, expect, it } from "vitest";

import { uiCopy, type AppLanguage } from "./i18n";

type LeafMap = Record<string, string>;

function flatten(node: unknown, prefix = ""): LeafMap {
  const leaves: LeafMap = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") {
      Object.assign(leaves, flatten(value, path));
    } else {
      leaves[path] = String(value);
    }
  }
  return leaves;
}

function placeholders(text: string): string[] {
  return (text.match(/\{[^}]+\}/g) ?? []).sort();
}

const en = flatten(uiCopy.en);
const locales: AppLanguage[] = ["ko", "ja"];

describe("locale drift guards", () => {
  it.each(locales)("%s has exactly the same keys as en", (locale) => {
    const other = flatten(uiCopy[locale]);

    expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(locales)(
    "%s keeps the same {placeholder} set in every string",
    (locale) => {
      const other = flatten(uiCopy[locale]);

      for (const key of Object.keys(en)) {
        expect(placeholders(other[key]), `placeholder drift at ${key}`).toEqual(
          placeholders(en[key]),
        );
      }
    },
  );
});
