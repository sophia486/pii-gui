import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("drops falsy values", () => {
    expect(cn("foo", false, null, undefined, "", "bar")).toBe("foo bar");
  });

  it("supports conditional object syntax", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });

  it("lets the later Tailwind utility win a conflict", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("keeps non-conflicting utilities from both sides", () => {
    // tailwind-merge does not guarantee output order, so compare normalized.
    expect(cn("p-2 font-bold", "p-4").split(" ").sort()).toEqual([
      "font-bold",
      "p-4",
    ]);
  });

  it("flattens nested arrays", () => {
    expect(cn(["a", ["b", "c"]], "d")).toBe("a b c d");
  });
});
