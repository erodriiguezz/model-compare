# ADR: Provider keys live in the engine env file

- Date: 2026-10-19
- Status: accepted
- Issue / PR: #4

## Context
Provider API keys are set by editing the engine env file by hand, which is the main setup friction. The Settings page must add, replace, test and remove keys, show them masked, and apply them without a restart. The server is local-only and has no auth.

## Options
1. **The env file** (`MODELCOMPARE_KEYS_FILE`, default the file python-dotenv already loads) — Pros: the CLI and the server already read it; no new storage; the user can still edit it by hand. Cons: plaintext on disk.
2. **OS keychain** — Pros: encrypted at rest. Cons: platform-specific code, a new dependency, and the CLI would need a second source. Rejected.
3. **Database** — Pros: one store. Cons: secrets next to run history that users share and export; needs encryption we do not have. Rejected.

## Decision
Option 1. `modelcompare/keys.py` rewrites only the `VAR=` line of an allowlisted provider variable through a temp file (fsynced) and `os.replace`, sets mode 600, and updates `os.environ` so the change is live. The default file is the one the old bare `load_dotenv()` found (walking up from the package), not the cwd's.

## Consequences
- Only six provider variables are writable; the Settings routes accept nothing else.
- Values are validated (printable ASCII, no quotes, `#`, `$`, backslash or whitespace, at most 512 characters), so a value cannot inject another line.
- Settings routes live under `/api` only. They require a loopback `Host` (DNS rebinding) and, when present, a loopback `Origin` (a hostile page posting to 127.0.0.1); anything else gets 403.
- Responses carry only a masked value (`sk-…a1b2`); values are never logged or put in error messages.
- `load_dotenv` never overrides the environment, so a shell-exported key wins at runtime. Status shows the effective value; `source` is `file` only when it equals the file's value, else `environment`.
- A key set only in the environment cannot be removed here: DELETE returns 409. Removing a key that is in the file clears the process env only if it held the file's value; with no matching line the file is not touched.
- PUT sets the process env, so it overrides a shell export until restart. Duplicate lines collapse to one on PUT and all go on DELETE; `export` and indented forms are matched, replaced lines use the file's line ending, and a symlinked file keeps its link.
- PUT requires `Content-Type: application/json` (415 otherwise).
- The file is plaintext on disk. Encryption at rest is out of scope.
