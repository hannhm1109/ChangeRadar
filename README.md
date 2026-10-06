# ChangeRadar

ChangeRadar analyzes Git changes to highlight modifications that may affect deployment: environment variables, database migrations, API routes, dependencies, and scheduled jobs.

## Current Status

Phase 2 is complete: the CLI collects Git changes, runs independent detectors, and prints a severity-grouped report with suggested deployment checks.

The first detector reports added Prisma migration files at `prisma/migrations/<name>/migration.sql` as HIGH. Modified, deleted, or renamed migrations, other migration directories, and the remaining detector categories will be implemented in subsequent phases. A report with no findings does not establish that a deployment is safe.

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

The report includes changed-file and finding counts, then groups findings by HIGH, MEDIUM, and LOW severity. Each finding lists the relevant files. Suggested checks are deduplicated. Paths are quoted and escaped so tabs and newlines cannot break the report. File contents and raw diffs are not printed.

```text
ChangeRadar

2 files changed against HEAD
1 deployment impact detected

HIGH
  Database migration added
    "prisma/migrations/20261006_init/migration.sql"

Suggested deployment checks:
  [ ] Review and apply database migrations before deployment.
```

## Architecture

```text
CLI -> Git adapter -> ChangeContext -> Detectors -> Findings -> Terminal reporter
```

- `src/cli.ts` coordinates analysis, writes the completed report, and selects an exit code.
- `src/git/gitAdapter.ts` runs Git through Node's `execFile`, passing arguments without a shell.
- `src/git/parseNameStatus.ts` parses null-delimited file statuses, preserving unusual filenames and rename paths.
- `src/core/types.ts` defines the change context, severity, structured findings, and detector interface.
- `src/core/runDetectors.ts` runs detectors, deduplicates equivalent findings, and orders them by severity.
- `src/detectors/migrationDetector.ts` implements the initial Prisma migration addition rule.
- `src/reporters/terminalReporter.ts` formats findings without running Git or printing directly.
- `src/errors/ChangeRadarError.ts` provides typed errors with user-facing messages.

Each detector implements `name` and `detect(context): Finding[]`. To add a detector, implement that interface and register it in the CLI's detector list. Detection stays independent of formatting, so the same findings can later support another output format.

Duplicate findings have the same detector, severity, title, description, file set, and suggested action. Different files or advice remain separate findings. A detector failure stops analysis with a tool error instead of producing an incomplete success report.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Tests cover Git parsing, real temporary Git repositories, the detector runner, migration matching, report formatting, and complete CLI analysis with exit codes.

## Exit Codes

- `0`: analysis completed with no HIGH findings, or help/version displayed.
- `1`: HIGH deployment-impact findings detected.
- `2`: CLI usage or tool execution error.

ChangeRadar highlights detected impacts; humans still decide whether and how to deploy.
