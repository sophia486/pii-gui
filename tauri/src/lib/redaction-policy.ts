export type PiiKind = string;

export type PiiMatch = {
  id: string;
  kind: PiiKind;
  value: string;
  start: number;
  end: number;
};

export type PiiIndexFormat = "none" | "number" | "id";

export type PiiWorkflowMode = "text-to-pii" | "pii-to-text";

export type PiiCustomRule = {
  id: string;
  name: string;
  mode: "exact" | "regex";
  pattern: string;
};

export type PiiMatchSelection = Record<string, boolean>;

export type PiiTextSegment = {
  text: string;
  matches: PiiMatch[];
};

export function applyCustomRules(input: string, rules: PiiCustomRule[]) {
  const matches: PiiMatch[] = [];

  for (const rule of rules) {
    if (!rule.pattern) continue;

    if (rule.mode === "exact") {
      matches.push(...exactMatches(input, rule));
      continue;
    }

    matches.push(...regexMatches(input, rule));
  }

  return matches.sort(compareMatches);
}

export function mergePiiMatches(matches: PiiMatch[]) {
  return [...matches].sort(compareMatches);
}

export function createMatchSelection(
  matches: PiiMatch[],
  previousSelection: PiiMatchSelection = {},
) {
  return matches.reduce<PiiMatchSelection>((selection, match) => {
    selection[match.id] = previousSelection[match.id] ?? true;
    return selection;
  }, {});
}

export function selectedPiiMatches(
  matches: PiiMatch[],
  selection: PiiMatchSelection,
) {
  return matches
    .filter((match) => selection[match.id] !== false)
    .sort(compareMatches);
}

export function formatRedactedText({
  input,
  matches,
  selection,
  indexFormat,
}: {
  input: string;
  matches: PiiMatch[];
  selection: PiiMatchSelection;
  indexFormat: PiiIndexFormat;
}) {
  return createRedactedTextSegments({
    input,
    matches,
    selection,
    indexFormat,
  })
    .map((segment) => segment.text)
    .join("");
}

export function restorePiiText({
  input,
  matches,
  selection,
  indexFormat,
}: {
  input: string;
  matches: PiiMatch[];
  selection: PiiMatchSelection;
  indexFormat: PiiIndexFormat;
}) {
  let output = input;

  selectedPiiMatches(matches, selection).forEach((match, index) => {
    output = output.replace(
      replacementLabel(match.kind, index + 1, indexFormat),
      () => match.value,
    );
  });

  return output;
}

export function createRedactedTextSegments({
  input,
  matches,
  selection,
  indexFormat,
}: {
  input: string;
  matches: PiiMatch[];
  selection: PiiMatchSelection;
  indexFormat: PiiIndexFormat;
}): PiiTextSegment[] {
  const selectedMatches = selectedPiiMatches(matches, selection);
  const segments: PiiTextSegment[] = [];
  let cursor = 0;

  selectedMatches.forEach((match, index) => {
    if (match.start < cursor) return;

    const plainText = input.slice(cursor, match.start);
    if (plainText) {
      segments.push({ text: plainText, matches: [] });
    }

    segments.push({
      text: replacementLabel(match.kind, index + 1, indexFormat),
      matches: [match],
    });
    cursor = match.end;
  });

  const trailingText = input.slice(cursor);
  if (trailingText) {
    segments.push({ text: trailingText, matches: [] });
  }

  return segments;
}

export function createRestoredTextSegments({
  input,
  matches,
  selection,
  indexFormat,
  emit,
}: {
  /** Restore-side input: redacted text containing replacement tokens. */
  input: string;
  matches: PiiMatch[];
  selection: PiiMatchSelection;
  indexFormat: PiiIndexFormat;
  /** "tokens" segments the input as-is; "values" emits the restored text. */
  emit: "tokens" | "values";
}): PiiTextSegment[] {
  // Locate each selected match's token with the same first-occurrence
  // semantics restorePiiText uses to replace them.
  const located: Array<{ start: number; end: number; match: PiiMatch }> = [];
  const searchOffsets = new Map<string, number>();

  selectedPiiMatches(matches, selection).forEach((match, index) => {
    const token = replacementLabel(match.kind, index + 1, indexFormat);
    const start = input.indexOf(token, searchOffsets.get(token) ?? 0);
    if (start === -1) return;

    searchOffsets.set(token, start + token.length);
    located.push({ start, end: start + token.length, match });
  });

  located.sort((left, right) => left.start - right.start);

  const segments: PiiTextSegment[] = [];
  let cursor = 0;

  located.forEach(({ start, end, match }) => {
    if (start < cursor) return;

    const plainText = input.slice(cursor, start);
    if (plainText) {
      segments.push({ text: plainText, matches: [] });
    }

    segments.push({
      text: emit === "values" ? match.value : input.slice(start, end),
      matches: [match],
    });
    cursor = end;
  });

  const trailingText = input.slice(cursor);
  if (trailingText) {
    segments.push({ text: trailingText, matches: [] });
  }

  return segments;
}

export function createInputTextSegments(
  input: string,
  matches: PiiMatch[],
): PiiTextSegment[] {
  const validMatches = matches
    .filter((match) => match.start >= 0 && match.end > match.start)
    .filter((match) => match.start < input.length && match.end <= input.length)
    .sort(compareMatches);

  if (validMatches.length === 0) {
    return input ? [{ text: input, matches: [] }] : [];
  }

  const boundaries = new Set<number>([0, input.length]);
  for (const match of validMatches) {
    boundaries.add(match.start);
    boundaries.add(match.end);
  }

  return [...boundaries]
    .sort((a, b) => a - b)
    .flatMap((start, index, sortedBoundaries) => {
      const end = sortedBoundaries[index + 1];
      if (end === undefined || start === end) return [];

      const text = input.slice(start, end);
      if (!text) return [];

      return {
        text,
        matches: validMatches.filter(
          (match) => match.start <= start && match.end >= end,
        ),
      };
    });
}

export function replacementLabel(
  kind: PiiKind,
  index: number,
  indexFormat: PiiIndexFormat,
) {
  const label = kind.toUpperCase();
  if (indexFormat === "number") return `[${label}:${index}]`;
  if (indexFormat === "id") return `[${label}:${deterministicIndexId(index)}]`;

  return `[${label}]`;
}

export function deterministicIndexId(index: number) {
  const hashed = Math.imul(index, 2_654_435_761) >>> 0;
  return hashed.toString(36).padStart(6, "0").slice(0, 6);
}

function exactMatches(input: string, rule: PiiCustomRule) {
  const matches: PiiMatch[] = [];
  let offset = 0;

  while (offset < input.length) {
    const start = input.indexOf(rule.pattern, offset);
    if (start === -1) break;

    matches.push(customMatch(rule, rule.pattern, start, matches.length));
    offset = start + rule.pattern.length;
  }

  return matches;
}

function regexMatches(input: string, rule: PiiCustomRule) {
  try {
    const regex = new RegExp(rule.pattern, "gi");
    return Array.from(input.matchAll(regex), (match, index) =>
      customMatch(rule, match[0], match.index ?? index, index),
    ).filter((match) => match.value.length > 0);
  } catch {
    return [];
  }
}

function customMatch(
  rule: PiiCustomRule,
  value: string,
  start: number,
  index: number,
): PiiMatch {
  return {
    id: `custom-${rule.id}-${start}-${index}`,
    kind: rule.name.trim() || "Custom",
    value,
    start,
    end: start + value.length,
  };
}

function compareMatches(a: PiiMatch, b: PiiMatch) {
  return a.start - b.start || a.end - b.end || a.id.localeCompare(b.id);
}
