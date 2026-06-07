# AGENTS.md

This file guides coding agents (Claude Code, Codex, etc.) working in this
repository. It applies to the repo root and all child directories unless a
deeper `AGENTS.md` overrides it. `CLAUDE.md` is a symlink to this file.

## Repository Layout

- `tauri/` — **the main app**: a PII redaction desktop app (Tauri 2 + React 19 + TypeScript + Vite + Tailwind 4)

## Working Rules

- Work autonomously on clear, reversible local tasks.
- Prefer existing app patterns over new abstractions.
- Keep diffs small and focused on the requested behavior.
- Never revert user changes or unrelated dirty work.
- Do not commit secrets, `.env` files, app data, SQLite databases, or raw PII
  result files.
- Treat persistence data as sensitive because it can contain raw PII.
- Use `rg` / `rg --files` for search.
- Use ASCII by default unless an existing file clearly uses non-ASCII text.

## Commands

### tauri/ (run from `tauri/`)

```sh
pnpm install
pnpm tauri dev        # run the desktop app
pnpm build            # tsc && vite build (frontend typecheck + build)
pnpm test:unit        # vitest run (all unit tests)
pnpm vitest run src/lib/pii-task-queue.test.ts   # single test file
```

Rust tests: `cargo test` from `tauri/src-tauri/`.

## Architecture: tauri/ (PII redaction app)

### Data flow

User loads a PDF/markdown/text → (PDF) `src/lib/pdf-document.ts` extracts text plus per-character boxes via pdf.js → `src/lib/pii-text-chunks.ts` splits long input into token-bounded, page-aware chunks → `src/lib/pii-task-queue.ts` queues the task → frontend invokes the Rust `redact_text` command → Rust returns matches + redacted text → user reviews/toggles matches in the UI (`src/components/pdf-preview.tsx` renders highlight overlays from charBoxes) → export via `src/lib/pdf-redacted-export.ts` (burns black rects into canvas-rendered pages with pdf-lib) or text save → results persisted via `src/lib/app-persistence.ts`.

### Frontend

- `src/App.tsx` is the orchestrator: tab management, hand-rolled hash routing (no React Router) for `/` (workbench), `/settings`, `/onboarding` — keep these routes separate.
- `src/lib/redaction-policy.ts` — match merging/selection/restoration logic.
- `src/lib/i18n.ts` — all UI copy (en, ko, ja); language settings drive visible copy.
- Reusable UI primitives go in `src/components/ui/` following the existing shadcn/Radix wrapper style; use Tailwind utilities, design tokens from `App.css`, and lucide icons.
- Preserve keyboard shortcut behavior (`src/lib/app-shortcuts.ts`) and tooltip labels when changing buttons.
- For visual changes, run the app and inspect the UI when practical.

### Rust backend (`src-tauri/src/`)

- `lib.rs` exposes the Tauri commands: `redact_text`, model lifecycle (`download_model` from Hugging Face with `model-download-progress` events, `delete_model`, `model_download_status`), and file I/O (`read_import_file`, `write_output_file`, `write_pii_filter_result`, etc.). Path-writing commands must keep files inside the Tauri app data directory.
- `redact_engine.rs` — `RedactEngine` with three backends:
  - **regex** — built-in rules (email, phone, URL, date, secrets)
  - **onnx** — OpenAI privacy-filter ONNX model (`ort` 2.0.0-rc + `tokenizers`; lazy static session; model dir from `PRIVACY_FILTER_MODEL_DIR`)
  - **bardsai** — BardsAI EU PII multilingual model (`BARDSAI_PII_MODEL_DIR`)
- Keep match labels aligned with the existing privacy taxonomy: `account_number`, `private_address`, `private_email`, `private_person`, `private_phone`, `private_url`, `private_date`, and `secret`.

### Persistence

- SQLite (`sqlite:pii-gui.db` via `@tauri-apps/plugin-sql` / `tauri-plugin-sql`), schema created in `src/lib/app-persistence.ts` with ALTER TABLE fallback migrations. Tables: `tabs` (full tab snapshots incl. serialized PDF data), `custom_rules` (user regex/exact filters), `pii_filter_results` (task history, capped at 200 rows on load).
- Raw filter results: `{app_data_dir}/tabs/{tab_uuid}/results/{datetime}.json`.

## Verification

- Text-only changes: at least `git diff --check`.
- Frontend logic changes: `pnpm test:unit` and `pnpm build`.
- Rust/backend changes: run relevant Rust tests from `tauri/src-tauri` when
  possible, plus `pnpm build` from `tauri/`.
- Persistence changes: verify both the no-op browser/test path and the Tauri
  plugin path when practical.
- Report any validation that could not be run.

## Commit Protocol

When committing, stage only files related to the current task and use the Lore
commit format:

```text
<intent line: why the change was made, not what changed>

<optional concise body: constraints and approach rationale>

Constraint: <external constraint that shaped the decision>
Rejected: <alternative considered> | <reason for rejection>
Confidence: <low|medium|high>
Scope-risk: <narrow|moderate|broad>
Directive: <forward-looking warning for future modifiers>
Tested: <what was verified>
Not-tested: <known gaps in verification>
Co-authored-by: OmX <omx@oh-my-codex.dev>
```

Use trailers only when they add useful decision context. The `Co-authored-by`
trailer is required by the local workflow.
