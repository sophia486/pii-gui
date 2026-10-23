import { expect, it } from "vitest";
import { filterPii, koreanRegistrationValidation } from "./pii-rules";
function synthetic(prefix: string, foreign = false) {
  const sum = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5].reduce(
    (s, w, i) => s + Number(prefix[i]) * w,
    0,
  );
  return prefix + (((foreign ? 13 : 11) - (sum % 11)) % 10);
}
it.each([
  ["900101123456", false],
  ["000229712346", true],
] as const)("legacy checksums %s", (prefix, foreign) => {
  expect(koreanRegistrationValidation(synthetic(prefix, foreign))).toBe(
    "legacy-checksum",
  );
});
it("does not drop modern randomized serials after a failed legacy checksum", () => {
  expect(koreanRegistrationValidation("900101-1234560")).toBe(
    "possible-modern",
  );
  expect(
    filterPii("주민번호:900101-1234560입니다").matches.some(
      (m) => m.value === "900101-1234560",
    ),
  ).toBe(true);
});
it.each([
  "990229-1234567",
  "000230-3123456",
  "901301-1234567",
  "900101-9234567",
])("rejects malformed date or gender %s", (value) => {
  expect(koreanRegistrationValidation(value)).toBe("invalid");
});
it.each([
  ["900231123456", "checksum-valid 31 February"],
  ["000229123456", "29 February 1900, not a leap year"],
] as const)("rejects impossible calendar dates: %s (%s)", (prefix, _label) => {
  expect(koreanRegistrationValidation(synthetic(prefix))).toBe("invalid");
});
it("accepts 29 February on leap years", () => {
  expect(koreanRegistrationValidation(synthetic("000229323456"))).toBe(
    "legacy-checksum",
  );
});
it("keeps a complete identity span ahead of a shorter phone overlap", () => {
  expect(filterPii("ID: 9001011234560").redactedText).toBe(
    "ID: [ACCOUNT_NUMBER]",
  );
});
