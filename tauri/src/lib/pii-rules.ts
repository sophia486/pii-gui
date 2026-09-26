// Single source of truth for the built-in detection rules. The Rust backend
// reads the same file at compile time (shared/pii-rules.json), so a rule or a
// kind name can no longer drift between the two implementations.
import rulesFile from "../../shared/pii-rules.json";

export type PiiRegexRule = {
  /** Privacy-taxonomy kind reported for a match, e.g. `private_email`. */
  kind: string;
  /** Prefix of the generated match id, e.g. `private-email`. */
  matchIdPrefix: string;
  /** Text that replaces a match in the regex backend's redacted output. */
  replacement: string;
  /** JavaScript-compatible regular expression source. */
  pattern: string;
  /** Whether the rule matches case-insensitively. */
  ignoreCase: boolean;
};

export type PiiRules = {
  taxonomy: string[];
  regexRules: PiiRegexRule[];
};

const rules = rulesFile as PiiRules;

/** The privacy taxonomy, in the order the BIOES label sets are built from it. */
export const piiTaxonomy = rules.taxonomy;

/** The built-in regex rules, shared with the Rust regex backend. */
export const piiRegexRules = rules.regexRules;

/** A fresh RegExp per rule; a global regex carries match state in `lastIndex`. */
export function builtInRegexRules() {
  return piiRegexRules.map((rule) => ({
    ...rule,
    regex: new RegExp(rule.pattern, rule.ignoreCase ? "gi" : "g"),
  }));
}
