# Security Policy

## Supported versions

PII GUI is pre-1.0. Security fixes land on `main` and ship in the next release, so the latest release is the supported version.

| Version | Supported |
| --- | --- |
| Latest release (0.1.x) | Yes |
| Older releases | No |

## Reporting a vulnerability

Please do not report security vulnerabilities through public issues, discussions, or pull requests.

Report them privately with GitHub's private vulnerability reporting for this repository:

https://github.com/sophia486/pii-gui/security/advisories/new

That form opens a draft security advisory that only you and the repository owner can see. If the form is not available for this repository, contact the repository owner, [@sophia486](https://github.com/sophia486), through GitHub and ask for a private channel before sharing any details. GitHub's guide to private reporting: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability

### What to include

- Affected version and platform (macOS, Windows, or Linux)
- Steps to reproduce, or a minimal proof of concept
- The impact you believe it has, for example whether document content, stored results, or downloaded model files can be exposed
- Any suggested fix

Do not include real personal data, production documents, or your own credentials. Use synthetic samples.

## Scope

This policy covers the desktop app in `tauri/` and `tauri/src-tauri/`: document parsing, PII detection, redaction export, local persistence, and the model download path. If a vulnerability is in a third-party dependency, report it upstream as well; you can still report the impact on PII GUI here.

## What to expect

The repository owner will respond in the advisory thread. Please keep the details private until a fix has shipped and the advisory is published.
