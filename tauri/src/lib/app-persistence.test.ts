import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeDatabase } from "./test-support/fake-sqlite";

const fake = createFakeDatabase();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: async () => fake },
}));

import {
  initAppPersistence,
  persistCustomRules,
  persistTabs,
  type PersistedTab,
} from "./app-persistence";

function tab(id: string, title: string): PersistedTab {
  return {
    id,
    title,
    documentKind: "text",
    input: `input ${id}`,
    output: "",
    matches: [],
    matchSelection: {},
    indexFormat: "none",
    mode: "text-to-pii",
    restoreInput: "",
    restoreOutput: "",
  };
}

describe("app persistence", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    fake.tables.clear();
    fake.statements.length = 0;
  });

  it("seeds tabs and rules on the first run", async () => {
    const snapshot = await initAppPersistence({
      seedTabs: [tab("a", "A")],
      seedCustomRules: [
        { id: "r1", name: "account", mode: "regex", pattern: "ACME-\\d+" },
      ],
    });

    expect(snapshot?.tabs.map((stored) => stored.id)).toEqual(["a"]);
    expect(snapshot?.customRules).toHaveLength(1);
  });

  it("restores the tabs an earlier run saved", async () => {
    await persistTabs([tab("a", "A"), tab("b", "B")]);

    const snapshot = await initAppPersistence({
      seedTabs: [],
      seedCustomRules: [],
    });

    expect(snapshot?.tabs.map((stored) => stored.title)).toEqual(["A", "B"]);
    expect(snapshot?.tabs[1].input).toBe("input b");
  });

  it("updates rows in place, never clearing the table", async () => {
    await persistTabs([tab("a", "A")]);
    await persistTabs([tab("a", "A renamed")]);

    expect(fake.statements).not.toContain("DELETE FROM tabs");
    expect(
      fake.statements.some((statement) =>
        statement.includes("ON CONFLICT(id) DO UPDATE"),
      ),
    ).toBe(true);
    expect(fake.tables.get("tabs")?.map((row) => row.title)).toEqual([
      "A renamed",
    ]);
  });

  it("drops rows for tabs that are gone", async () => {
    await persistTabs([tab("a", "A"), tab("b", "B")]);
    await persistTabs([tab("b", "B")]);

    expect(fake.tables.get("tabs")?.map((row) => row.id)).toEqual(["b"]);
  });

  it("keeps closed tabs separately", async () => {
    await persistTabs([tab("a", "A")], [tab("c", "C")]);

    const snapshot = await initAppPersistence({
      seedTabs: [],
      seedCustomRules: [],
    });

    expect(snapshot?.tabs.map((stored) => stored.id)).toEqual(["a"]);
    expect(snapshot?.closedTabs.map((stored) => stored.id)).toEqual(["c"]);
  });

  it("persists custom rules", async () => {
    await persistCustomRules([
      { id: "r1", name: "account", mode: "exact", pattern: "ACME" },
    ]);

    expect(fake.tables.get("custom_rules")).toHaveLength(1);
  });
});
