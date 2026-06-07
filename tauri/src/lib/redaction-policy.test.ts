import { describe, expect, it } from "vitest";

import {
  applyCustomRules,
  createMatchSelection,
  createInputTextSegments,
  createRedactedTextSegments,
  createRestoredTextSegments,
  deterministicIndexId,
  formatRedactedText,
  mergePiiMatches,
  replacementLabel,
  restorePiiText,
  type PiiMatch,
} from "./redaction-policy";

const matches: PiiMatch[] = [
  {
    id: "email-7-0",
    kind: "Email",
    value: "a@example.com",
    start: 7,
    end: 20,
  },
  {
    id: "phone-26-0",
    kind: "Phone",
    value: "123-456-7890",
    start: 26,
    end: 38,
  },
];

describe("redaction policy", () => {
  it("formats selected matches with numeric indexes by text position", () => {
    const output = formatRedactedText({
      input: "Email: a@example.com Tel: 123-456-7890",
      matches,
      selection: createMatchSelection(matches),
      indexFormat: "number",
    });

    expect(output).toBe("Email: [EMAIL:1] Tel: [PHONE:2]");
  });

  it("formats selected matches with deterministic alphanumeric ids", () => {
    expect(replacementLabel("Email", 1, "id")).toBe(
      `[EMAIL:${deterministicIndexId(1)}]`,
    );
    expect(deterministicIndexId(1)).toMatch(/^[a-z0-9]{6}$/);
  });

  it("excludes deselected matches from redaction output", () => {
    const output = formatRedactedText({
      input: "Email: a@example.com Tel: 123-456-7890",
      matches,
      selection: { "email-7-0": true, "phone-26-0": false },
      indexFormat: "none",
    });

    expect(output).toBe("Email: [EMAIL] Tel: 123-456-7890");
  });

  it("restores indexed PII labels from filtered text", () => {
    const output = restorePiiText({
      input: "Email: [EMAIL:1] Tel: [PHONE:2]",
      matches,
      selection: createMatchSelection(matches),
      indexFormat: "number",
    });

    expect(output).toBe("Email: a@example.com Tel: 123-456-7890");
  });

  it("restores repeated unindexed labels in text order", () => {
    const emailMatches: PiiMatch[] = [
      matches[0],
      {
        id: "email-40-0",
        kind: "Email",
        value: "b@example.com",
        start: 40,
        end: 53,
      },
    ];

    const output = restorePiiText({
      input: "Send [EMAIL], then copy [EMAIL].",
      matches: emailMatches,
      selection: createMatchSelection(emailMatches),
      indexFormat: "none",
    });

    expect(output).toBe("Send a@example.com, then copy b@example.com.");
  });

  it("restores replacement values literally", () => {
    const output = restorePiiText({
      input: "Secret: [SECRET]",
      matches: [
        {
          id: "secret-8-0",
          kind: "Secret",
          value: "sk_$&value",
          start: 8,
          end: 17,
        },
      ],
      selection: { "secret-8-0": true },
      indexFormat: "none",
    });

    expect(output).toBe("Secret: sk_$&value");
  });

  it("adds exact and regex custom rule matches", () => {
    const customMatches = applyCustomRules("Code ABC-123 and secret-token", [
      {
        id: "rule-1",
        name: "Token",
        mode: "exact",
        pattern: "secret-token",
      },
      {
        id: "rule-2",
        name: "Code",
        mode: "regex",
        pattern: "ABC-\\d+",
      },
    ]);

    expect(customMatches.map((match) => match.value)).toEqual([
      "ABC-123",
      "secret-token",
    ]);
  });

  it("preserves overlapping matches for highlight rendering", () => {
    expect(
      mergePiiMatches([
        { ...matches[0], id: "overlap", start: 9, end: 20 },
        matches[0],
      ]),
    ).toHaveLength(2);
  });

  it("groups overlapping input segments with every active match", () => {
    const segments = createInputTextSegments("Token ABC-123", [
      {
        id: "token-6-0",
        kind: "Token",
        value: "ABC-123",
        start: 6,
        end: 13,
      },
      {
        id: "code-6-0",
        kind: "Code",
        value: "ABC",
        start: 6,
        end: 9,
      },
    ]);

    expect(
      segments.find((segment) => segment.text === "ABC")?.matches,
    ).toHaveLength(2);
  });

  it("creates highlighted replacement segments for output text", () => {
    const segments = createRedactedTextSegments({
      input: "Email: a@example.com Tel: 123-456-7890",
      matches,
      selection: createMatchSelection(matches),
      indexFormat: "none",
    });

    expect(segments.map((segment) => segment.text).join("")).toBe(
      "Email: [EMAIL] Tel: [PHONE]",
    );
    expect(segments.filter((segment) => segment.matches.length > 0)).toHaveLength(
      2,
    );
  });

  it("segments restore input around replacement tokens", () => {
    const segments = createRestoredTextSegments({
      input: "Email: [EMAIL:1] Tel: [PHONE:2]",
      matches,
      selection: createMatchSelection(matches),
      indexFormat: "number",
      emit: "tokens",
    });

    expect(segments.map((segment) => segment.text).join("")).toBe(
      "Email: [EMAIL:1] Tel: [PHONE:2]",
    );
    expect(
      segments
        .filter((segment) => segment.matches.length > 0)
        .map((segment) => segment.text),
    ).toEqual(["[EMAIL:1]", "[PHONE:2]"]);
  });

  it("segments restored output to mirror restorePiiText", () => {
    const input = "Email: [EMAIL:1] Tel: [PHONE:2]";
    const selection = createMatchSelection(matches);
    const segments = createRestoredTextSegments({
      input,
      matches,
      selection,
      indexFormat: "number",
      emit: "values",
    });

    expect(segments.map((segment) => segment.text).join("")).toBe(
      restorePiiText({ input, matches, selection, indexFormat: "number" }),
    );
    expect(
      segments
        .filter((segment) => segment.matches.length > 0)
        .map((segment) => segment.text),
    ).toEqual(["a@example.com", "123-456-7890"]);
  });

  it("maps repeated identical tokens to matches in order", () => {
    const input = "First [EMAIL] then [EMAIL]";
    const emails: PiiMatch[] = [
      { id: "e-0", kind: "Email", value: "a@example.com", start: 0, end: 13 },
      { id: "e-1", kind: "Email", value: "b@example.com", start: 20, end: 33 },
    ];
    const selection = createMatchSelection(emails);
    const segments = createRestoredTextSegments({
      input,
      matches: emails,
      selection,
      indexFormat: "none",
      emit: "values",
    });

    expect(segments.map((segment) => segment.text).join("")).toBe(
      restorePiiText({ input, matches: emails, selection, indexFormat: "none" }),
    );
    expect(
      segments
        .filter((segment) => segment.matches.length > 0)
        .map((segment) => segment.text),
    ).toEqual(["a@example.com", "b@example.com"]);
  });

  it("skips deselected and missing tokens when segmenting restore text", () => {
    const segments = createRestoredTextSegments({
      input: "Email: a@example.com Tel: [PHONE:1]",
      matches,
      selection: { "email-7-0": false },
      indexFormat: "number",
      emit: "tokens",
    });

    expect(segments.map((segment) => segment.text).join("")).toBe(
      "Email: a@example.com Tel: [PHONE:1]",
    );
    expect(
      segments.filter((segment) => segment.matches.length > 0),
    ).toHaveLength(1);
  });
});
