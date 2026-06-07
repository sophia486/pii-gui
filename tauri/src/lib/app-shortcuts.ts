export type AppShortcutAction =
  | "close-tab"
  | "new-tab"
  | "filter"
  | "open-markdown"
  | "open-settings"
  | "previous-tab"
  | "next-tab"
  | "switch-mode";

export type MatchedAppShortcut =
  | AppShortcutAction
  | {
      action: "select-tab";
      tabNumber: number;
    };

export type AppShortcutDefinition = {
  action: AppShortcutAction;
  keys: string[];
};

export const appShortcutDefinitions = [
  {
    action: "new-tab",
    keys: ["modifier", "N"],
  },
  {
    action: "filter",
    keys: ["modifier", "Enter"],
  },
  {
    action: "open-markdown",
    keys: ["modifier", "O"],
  },
  {
    action: "open-settings",
    keys: ["modifier", ","],
  },
  {
    action: "previous-tab",
    keys: ["modifier", "["],
  },
  {
    action: "next-tab",
    keys: ["modifier", "]"],
  },
  {
    action: "switch-mode",
    keys: ["modifier", "Shift", "M"],
  },
] satisfies AppShortcutDefinition[];

export function matchAppShortcut(event: KeyboardEvent): MatchedAppShortcut | undefined {
  if (event.defaultPrevented || event.repeat) return undefined;
  if (event.altKey) return undefined;
  if (!event.metaKey && !event.ctrlKey) return undefined;

  const key = event.key.toLowerCase();

  if (key === "[" || key === "{") return "previous-tab";
  if (key === "]" || key === "}") return "next-tab";
  if (event.shiftKey && key === "m") return "switch-mode";

  if (event.shiftKey) return undefined;

  if (/^[1-9]$/.test(key)) {
    return {
      action: "select-tab",
      tabNumber: Number(key),
    };
  }

  if (key === "0") {
    return {
      action: "select-tab",
      tabNumber: 10,
    };
  }

  if (key === "n") return "new-tab";
  if (key === "w") return "close-tab";
  if (key === "enter") return "filter";
  if (key === "o") return "open-markdown";
  if (key === ",") return "open-settings";

  return undefined;
}

export function shortcutLabel(action: AppShortcutAction) {
  const definition = appShortcutDefinitions.find((item) => item.action === action);
  if (!definition) return "";

  return definition.keys
    .map((key) => (key === "modifier" ? shortcutModifierKey() : key))
    .join(" + ");
}

export function tabShortcutLabel(tabNumber: number) {
  if (!Number.isInteger(tabNumber) || tabNumber < 1 || tabNumber > 10) {
    return "";
  }

  const shortcutNumber = tabNumber === 10 ? "0" : String(tabNumber);
  return [shortcutModifierKey(), shortcutNumber].join(" + ");
}

function shortcutModifierKey() {
  return isApplePlatform() ? "⌘" : "Ctrl";
}

function isApplePlatform() {
  if (typeof navigator === "undefined") return false;

  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();

  return platform.includes("mac") || userAgent.includes("mac os");
}
