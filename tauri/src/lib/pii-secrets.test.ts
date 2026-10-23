import { expect, it } from "vitest";
import { builtInRegexRules } from "./pii-rules";
const rule = builtInRegexRules().find((r) => r.kind === "secret")!;
function matches(value: string) {
  return [...value.matchAll(new RegExp(rule.pattern, "g"))].map((m) => m[0]);
}
it.each([
  "AKIA" + "A".repeat(16),
  "ASIA" + "B".repeat(16),
  ...["ghp_", "gho_", "ghu_", "ghs_", "ghr_"].map((p) => p + "C".repeat(36)),
  "github_pat_" + "a".repeat(82),
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c3ludGhldGlj",
  "sk_live_abcdefg0123456",
])("matches synthetic secret %s", (value) =>
  expect(matches(value)).toEqual([value]),
);
it("masks the whole multiline private key, not only its header", () => {
  const value =
    "-----BEGIN RSA PRIVATE KEY-----\nU1lOVEhFVElD\n-----END RSA PRIVATE KEY-----";
  expect(matches(value)).toEqual([value]);
});
it.each([
  "AKIA123",
  "ghp_short",
  "github_pat_short",
  "abc.def.ghi",
  "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----",
])("keeps non-secret lookalike %s", (value) =>
  expect(matches(value)).toEqual([]),
);
