import { describe, expect, it } from "vitest";

import { builtInRegexRules, piiTaxonomy } from "./pii-rules";

function testRule(rule: { regex: RegExp }, text: string): boolean {
  // The shared rules carry the g flag; a reused regex keeps lastIndex and a
  // second .test() can skip a match, so test through a fresh RegExp.
  return new RegExp(rule.regex.source, rule.regex.flags).test(text);
}

describe("built-in PII regex rules", () => {
  it("every rule kind is part of the shared taxonomy", () => {
    for (const rule of builtInRegexRules()) {
      expect(piiTaxonomy).toContain(rule.kind);
    }
  });

  it("every pattern compiles as a JavaScript RegExp", () => {
    for (const rule of builtInRegexRules()) {
      expect(rule.regex).toBeInstanceOf(RegExp);
    }
  });

  it("detects the canonical example for each kind", () => {
    const examples: Record<string, string> = {
      private_email: "reach me at ada@example.com today",
      private_phone: "call +1 (123) 456-7890 anytime",
      private_url: "see https://example.com/case for details",
      private_date: "shipped on 2026-07-15",
      secret: "token sk_live_abcdefg0123456 leaked",
    };

    const rules = builtInRegexRules();
    for (const [kind, text] of Object.entries(examples)) {
      const rule = rules.find((candidate) => candidate.kind === kind);
      expect(rule, `rule for ${kind}`).toBeDefined();
      expect(testRule(rule!, text), `${kind} should match ${text}`).toBe(true);
    }
  });

  it("does not flag plain prose or ISO dates as phone numbers", () => {
    const phone = builtInRegexRules().find(
      (rule) => rule.kind === "private_phone",
    )!;

    expect(testRule(phone, "Call me maybe")).toBe(false);
    expect(testRule(phone, "shipped on 2026-10-19")).toBe(false);
  });
});
