# ChangeRadar

ChangeRadar analyzes Git changes to highlight modifications that may affect deployment: environment variables, database migrations, API routes, dependencies, and scheduled jobs.

## Current Status

Phase 1 is complete: the TypeScript CLI and Git adapter are implemented. The current CLI lists changed files; deployment detectors will be added in subsequent phases.

## Local Development

Requires Node.js 22.12 or newer (an LTS release is recommended), npm, and Git on your PATH.

```bash
npm install
npm run dev -- analyze
npm run dev -- --help
npm run dev -- --version
```

To run the compiled CLI:

```bash
npm run build
node dist/cli.js analyze
```

## Diff Mode

`analyze` compares the current working tree against `HEAD`. This includes the net staged and unstaged changes across the entire repository, even when invoked from a subdirectory.

New untracked files are excluded. Run `git add <file>` to include a new file. A repository must have an initial commit. Git references and ranges will be added in a later phase.

The current output lists added, modified, deleted, and renamed files. Paths are quoted and escaped so tabs and newlines cannot break the report. File contents and raw diffs are not printed.

```text
ChangeRadar

2 files changed against HEAD
  added     "prisma/migrations/20261006_init/migration.sql"
  modified  "app/api/orders/route.ts"

Deployment detectors are not implemented yet.
```

## Architecture

```text
CLI -> Git adapter -> ChangeContext
```

- `src/cli.ts` owns command parsing and terminal output.
- `src/git/gitAdapter.ts` runs Git through Node's `execFile`, passing arguments without a shell.
- `src/git/parseNameStatus.ts` parses null-delimited file statuses, preserving unusual filenames and rename paths.
- `src/core/types.ts` defines changed files and the context containing the repository root, changed files, and zero-context patch.
- `src/errors/ChangeRadarError.ts` provides typed errors with user-facing messages.

The next phase adds independent detectors that return structured findings and a separate terminal reporter.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Tests cover Git output parsing and real temporary Git repositories, including staged and unstaged changes, renames, deletions, subdirectories, and invalid repository states.

## Exit Codes

- `0`: file inspection completed, or help/version displayed.
- `2`: CLI usage or tool execution error.

Exit code `1` will represent HIGH findings after deployment detection is implemented. Success currently means file inspection completed, not that a deployment is safe.
