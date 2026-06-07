import { describe, expect, it } from "vitest";

import { matchAppShortcut, shortcutLabel, tabShortcutLabel } from "./app-shortcuts";

function keyboardEvent(init: KeyboardEventInit) {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key: "",
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent;
}

describe("app shortcuts", () => {
  it("matches new tab with the primary modifier and n", () => {
    expect(matchAppShortcut(keyboardEvent({ key: "n", ctrlKey: true }))).toBe(
      "new-tab",
    );
    expect(matchAppShortcut(keyboardEvent({ key: "N", metaKey: true }))).toBe(
      "new-tab",
    );
  });

  it("matches close tab with the primary modifier and w", () => {
    expect(matchAppShortcut(keyboardEvent({ key: "w", ctrlKey: true }))).toBe(
      "close-tab",
    );
    expect(matchAppShortcut(keyboardEvent({ key: "W", metaKey: true }))).toBe(
      "close-tab",
    );
  });

  it("matches filter with the primary modifier and enter", () => {
    expect(
      matchAppShortcut(keyboardEvent({ key: "Enter", ctrlKey: true })),
    ).toBe("filter");
  });

  it("matches markdown import with the primary modifier and o", () => {
    expect(matchAppShortcut(keyboardEvent({ key: "o", ctrlKey: true }))).toBe(
      "open-markdown",
    );
  });

  it("matches settings with the primary modifier and comma", () => {
    expect(matchAppShortcut(keyboardEvent({ key: ",", ctrlKey: true }))).toBe(
      "open-settings",
    );
    expect(matchAppShortcut(keyboardEvent({ key: ",", metaKey: true }))).toBe(
      "open-settings",
    );
  });

  it("matches direct tab selection with primary modifier and number", () => {
    expect(matchAppShortcut(keyboardEvent({ key: "1", ctrlKey: true }))).toEqual(
      {
        action: "select-tab",
        tabNumber: 1,
      },
    );
    expect(matchAppShortcut(keyboardEvent({ key: "9", metaKey: true }))).toEqual(
      {
        action: "select-tab",
        tabNumber: 9,
      },
    );
    expect(matchAppShortcut(keyboardEvent({ key: "0", metaKey: true }))).toEqual(
      {
        action: "select-tab",
        tabNumber: 10,
      },
    );
  });

  it("matches previous and next tab bracket shortcuts", () => {
    expect(matchAppShortcut(keyboardEvent({ key: "[", ctrlKey: true }))).toBe(
      "previous-tab",
    );
    expect(matchAppShortcut(keyboardEvent({ key: "]", ctrlKey: true }))).toBe(
      "next-tab",
    );
    expect(
      matchAppShortcut(keyboardEvent({ key: "{", metaKey: true, shiftKey: true })),
    ).toBe("previous-tab");
    expect(
      matchAppShortcut(keyboardEvent({ key: "}", metaKey: true, shiftKey: true })),
    ).toBe("next-tab");
  });

  it("matches mode switch shortcut", () => {
    expect(
      matchAppShortcut(keyboardEvent({ key: "M", ctrlKey: true, shiftKey: true })),
    ).toBe("switch-mode");
  });

  it("ignores repeated, shifted, alt, and unmodified shortcuts", () => {
    expect(
      matchAppShortcut(keyboardEvent({ key: "n", ctrlKey: true, repeat: true })),
    ).toBeUndefined();
    expect(
      matchAppShortcut(keyboardEvent({ key: "n", ctrlKey: true, shiftKey: true })),
    ).toBeUndefined();
    expect(
      matchAppShortcut(keyboardEvent({ key: "n", ctrlKey: true, altKey: true })),
    ).toBeUndefined();
    expect(matchAppShortcut(keyboardEvent({ key: "n" }))).toBeUndefined();
    expect(
      matchAppShortcut(keyboardEvent({ key: "1", ctrlKey: true, shiftKey: true })),
    ).toBeUndefined();
  });

  it("formats shortcut labels for display", () => {
    expect(shortcutLabel("filter")).toMatch(/^(Ctrl|⌘) \+ Enter$/);
    expect(shortcutLabel("previous-tab")).toMatch(/^(Ctrl|⌘) \+ \[$/);
    expect(shortcutLabel("next-tab")).toMatch(/^(Ctrl|⌘) \+ \]$/);
    expect(shortcutLabel("switch-mode")).toMatch(/^(Ctrl|⌘) \+ Shift \+ M$/);
    expect(shortcutLabel("open-settings")).toMatch(/^(Ctrl|⌘) \+ ,$/);
  });

  it("formats direct tab shortcut labels up to the tenth tab", () => {
    expect(tabShortcutLabel(1)).toMatch(/^(Ctrl|⌘) \+ 1$/);
    expect(tabShortcutLabel(10)).toMatch(/^(Ctrl|⌘) \+ 0$/);
    expect(tabShortcutLabel(11)).toBe("");
  });
});
