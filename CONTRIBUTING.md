# Contributing to PII GUI

Thanks for helping improve PII GUI. This is a local-first PII detection and redaction desktop app, so privacy matters in contributions as much as it does in the product.

- Search existing issues and pull requests before opening a new one.
- For security vulnerabilities, do not open a public issue. Follow [SECURITY.md](SECURITY.md).
- By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development environment

PII GUI is a Tauri 2 desktop app: a React 19 + TypeScript frontend in `tauri/` and a Rust backend in `tauri/src-tauri/`.

Requirements:

- Node.js 24+
- pnpm
- Rust and Cargo
- Tauri v2 platform prerequisites for your OS (https://v2.tauri.app/start/prerequisites/)

### Install

```sh
cd tauri
pnpm install
```

Local release signing values are optional for development. If you need updater signing locally, copy the environment template and fill in your own key:

```sh
cp .env.example .env
```

Never commit `.env` files or signing keys.

### Run the app

```sh
cd tauri
pnpm tauri dev
```

### Build

```sh
cd tauri
pnpm tauri build
```

## Tests and verification

Run the smallest check that proves the change, then widen as needed. These are the commands from the README's Verification section:

```sh
cd tauri && pnpm test:unit
cd tauri && pnpm build
cd tauri/src-tauri && cargo check
git diff --check
```

The CI workflow runs a wider set:

```sh
cd tauri && pnpm test:unit:coverage
cd tauri && pnpm build
cd tauri/src-tauri && cargo test --all-targets
cd tauri/src-tauri && cargo clippy --all-targets
```

`pnpm format:check`, `pnpm lint` and `cargo fmt --check` are advisory in CI today.

For packaging, run `pnpm tauri build` on the target platform before making release claims. Report any check you could not run in the pull request.

## Pull request rules

- Keep changes small and focused on one behavior, and prefer existing app patterns over new abstractions.
- Do not revert other people's changes or unrelated work in progress.
- Stage only files related to the task.
- Run the checks for the area you touched (frontend, Rust backend, or both) and state what you ran in the pull request.
- Never commit secrets, `.env` files, app data, SQLite databases, or raw PII result files. Persistence data can contain raw PII, so treat it as sensitive.
- Keep local benchmark scripts and outputs out of commits; `/benchmarks/` is ignored.
- For detection quality fixes, include the backend used (regex, OpenAI Privacy Filter, or BardsAI EU PII) and a minimal sample with **no real personal data**.
- Keep match labels aligned with the existing privacy taxonomy: `account_number`, `private_address`, `private_email`, `private_person`, `private_phone`, `private_url`, `private_date`, `secret`.

Commit messages follow the Lore format described in [AGENTS.md](AGENTS.md):

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
```

Use trailers only when they add useful decision context.

## Reporting bugs and feature requests

Open an issue with the bug report or feature request template. Include steps to reproduce or the use case, your OS, and the app version you are running.

Never attach real personal data, production documents, or unredacted exports to an issue. Use synthetic samples.

## License

By contributing you agree that your contributions are licensed under the GNU Affero General Public License v3.0, the license of this project.
