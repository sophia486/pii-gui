# Custom rule ids stay stable across edits

A rule keeps its `id` when edited. Match ids embed `custom-${rule.id}-…` and persistence keys rows by rule id, so regenerating ids on save would orphan saved matches and churn the table for no benefit. Considered generating a new id per save; rejected because it breaks existing references.