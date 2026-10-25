# PII GUI

A local-first PII detection and redaction desktop app: users load documents, review detected personal data, and export redacted results.

## Language

**Custom rule**: A user-defined pattern that marks text as PII. Either an exact string match (`exact`) or a regular expression (`regex`).
_Avoid_: user filter, custom filter, filter

**Default rule**: The built-in rule (a UUID pattern) provided to users who have not yet customized their rule list.
_Avoid_: seed rule

**Rule match**: A piece of text flagged by applying a custom rule; its label (`kind`) is the matched rule's name at scan time.
_Avoid_: custom match