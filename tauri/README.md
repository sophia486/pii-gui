# PII GUI Desktop App

This directory contains the Tauri v2 desktop app for PII GUI. The renderer is React 19, TypeScript, Vite, Tailwind CSS, and shadcn-style Radix UI wrappers. The native boundary is Rust and owns detection commands, model lifecycle, app-data file I/O, and packaging.

## App Layout

```text
src/
  App.tsx                  main app shell, routes, tabs, workbench state
  components/              PDF preview, controls, and reusable UI primitives
  lib/
    app-persistence.ts     local SQLite metadata and result-file persistence
    pdf-document.ts        pdf.js text and character-box extraction
    pdf-redacted-export.ts burned-in PDF redaction export
    pii-task-queue.ts      queued chunk processing
    pii-text-chunks.ts     token-bounded document chunking
    redaction-policy.ts    match merge, selection, and restoration logic
src-tauri/
  src/lib.rs               Tauri commands and app-data file boundaries
  src/redact_engine.rs     regex, OpenAI Privacy Filter, and BardsAI backends
  icons/                   source SVG and generated platform icons
```

## Setup

Install dependencies from this directory:

```sh
pnpm install
```

For normal development, no local environment file is required. If you need updater signing values for local packaging tests, copy the template and fill in your own private key:

```sh
cp .env.example .env
```

Local `.env` files are ignored by git.

## Local Development

Run the desktop app:

```sh
pnpm tauri dev
```

This starts Vite at `http://localhost:1420`, compiles the Rust app, and launches the Tauri window.

Run only the renderer during frontend work:

```sh
pnpm dev
```

Build the renderer:

```sh
pnpm build
```

## Common Commands

```sh
pnpm test:unit
pnpm build
pnpm tauri dev
pnpm tauri build
cd src-tauri && cargo check
cd src-tauri && cargo test
```

## Desktop Notes

- App identity is configured in `src-tauri/tauri.conf.json`.
- The dev binary name is configured in `src-tauri/Cargo.toml`.
- The icon source is `src-tauri/icons/app-icon.svg`; regenerate platform icons with `pnpm tauri icon src-tauri/icons/app-icon.svg`.
- Raw filter results can contain sensitive text and must stay under the Tauri app data directory.
- Do not commit `.env`, SQLite databases, downloaded models, exported documents, or raw PII result files.

## Verification

Use the smallest check that proves the change:

```sh
pnpm test:unit
pnpm build
cd src-tauri && cargo check
git diff --check
```

For release packaging, run `pnpm tauri build` on the target platform before publishing artifacts.
