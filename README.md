# ChangeRadar

ChangeRadar analyzes Git changes to highlight modifications that may affect deployment: environment variables, database migrations, API routes, dependencies, and scheduled jobs.

## Current Status

Phase 5 is complete: all five MVP detector categories run through the shared engine and terminal reporter: environment variables, migrations, Next.js API routes, dependencies, and cron/config files.

Migration findings have HIGH severity; environment, API-route, and cron/config findings have MEDIUM severity; dependency findings have LOW severity. A report with no findings does not establish that a deployment is safe. CLI polish and reference/range support come in the next phase.

## Supported Detectors

Environment detection compares variable names in the committed and working-tree versions of changed JS/TS files and `.env.example` templates. It supports `process.env.NAME`, static `process.env["NAME"]` access, and optional chaining, including JSX/TSX and CommonJS/ES module extensions. One finding per new name lists all matching changed files. Comments, string examples, formatting edits, removed names, value-only template edits, and names moved between changed files do not produce findings.

Only template keys and code references are reported. Actual `.env`, `.env.local`, and other `.env.*` files are excluded from content snapshots and raw patches, except `.env.example`. Source-file symlinks are not followed. No values or raw source are printed.

Migration detection reports added, modified, deleted, and renamed files under these root-relative patterns:

- `prisma/migrations/<name>/migration.sql`
- `migrations/` and `database/migrations/`, for `.sql`, `.js`, `.ts`, `.cjs`, `.mjs`, `.cts`, `.mts`, `.py`, `.rb`, and `.php` files

Renames check both paths, so moves into or out of migration directories are reported. Documentation, lock metadata, declaration files, and `.test`/`.spec` files are excluded. Detection is path-based; it does not interpret SQL or execute migrations.

Environment detection compares only changed supported files, not every existing reference in the repository. Dynamic keys, aliases, destructuring, other environment APIs, and lexical shadowing of `process` are not resolved. Unsupported or malformed source syntax produces a tool error rather than an incomplete success report. Nested monorepo migration roots and custom directory configuration are not supported yet.

API-route detection reports additions, edits, deletions, and renames under these root-relative Next.js conventions, also allowing a `src/` prefix:

- App Router: `app/api/**/route.ts` and `route.js`, including `app/api/route.ts`.
- Pages Router: `pages/api/**/*.{js,jsx,ts,tsx}`.

Paths are translated into URL patterns: `app/api/orders/route.ts` and `pages/api/orders/index.ts` both map to `/api/orders`. Dynamic segments such as `[id]`, `[...slug]`, and `[[...slug]]` remain visible as patterns. App Router [route groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) are removed from the URL, including groups before `api`, such as `app/(backend)/api/orders/route.ts`.

Renames include both affected files. A changed URL reports its old and new patterns; a file move that preserves the URL reports a modification. Moves into or out of recognized routing paths report an added or deleted route. Suggested checks identify the affected endpoint and, for removals, its consumers.

The rule is path-based, following the documented [App Router route convention](https://nextjs.org/docs/app/api-reference/file-conventions/route) and [Pages API convention](https://nextjs.org/docs/pages/building-your-application/routing/api-routes). It does not validate handler exports or infer HTTP methods, schemas, or breaking changes. Tests and declarations are excluded conservatively. App Router private folders and advanced parallel/interception layouts are skipped. Route handlers outside `/api`, monorepo app roots, configured page extensions, rewrites, and `basePath` are not resolved.

Dependency detection compares the root `package.json` before and after a change. It reports added, removed, and updated names in `dependencies`, `devDependencies`, `optionalDependencies`, and `peerDependencies`, identifying the affected section. Moving a name between sections reports a removal from one and an addition to the other. Comparison uses declared specifier strings, not installed versions or semantic-version risk. Specifiers and any embedded credentials are not printed.

Formatting, key order, scripts, package version, and other metadata-only edits are ignored. Changed root `package-lock.json`, `pnpm-lock.yaml`, and `yarn.lock` files produce one grouped fallback finding when there are no direct manifest dependency findings. This avoids reporting the same direct update twice while still highlighting lockfile-only resolution changes. Lockfiles are not parsed line by line. A malformed manifest or dependency section produces a tool error. Nested workspace manifests, overrides, bundled dependencies, and other package managers are not analyzed yet. The supported declaration fields follow [npm's package.json documentation](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).

Cron/config detection uses explicit root-relative paths:

- Scheduled jobs: `crontab`, `crontab.txt`, files named with letters, digits, underscores, or hyphens under `cron.d/`, and `.sh`, `.js`, `.ts`, `.cjs`, `.mjs`, `.cts`, `.mts`, `.py`, `.rb`, or `.php` files under `cron/`.
- Deployment configuration: root [vercel.json](https://vercel.com/docs/project-configuration/vercel-json).
- CI workflows: `.github/workflows/*.yml` and `*.yaml`, following the [GitHub Actions workflow location](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
- Container configuration: root `Dockerfile`, `.dockerignore`, `docker-compose.yml`/`.yaml`, and `compose.yml`/`.yaml`. Dockerfile and Compose variants with `dev`, `development`, `prod`, `production`, `staging`, or `test` suffixes are also supported.

These findings identify additions, edits, deletions, and renames. Moves into or out of recognized paths are reported; moves between categories produce a finding for each affected category. Job tests and declarations are excluded. Configuration contents are not parsed, schedules are not validated, and workflows or containers are not executed. A workflow or Vercel edit is reported as configuration impact, not automatically described as a schedule change. Arbitrary config directories and custom conventions are intentionally excluded.

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

6 files changed against HEAD
5 deployment impacts detected

HIGH
  Database migration added
    "prisma/migrations/20261006_init/migration.sql"

MEDIUM
  New environment variable detected: PAYMENT_API_KEY
    "src/config.ts"
  API route modified: /api/orders
    "app/api/orders/route.ts"
  Scheduled job file modified
    "crontab"

LOW
  Added dependency: stripe
    Dependency section: dependencies.
    "package.json"

Suggested deployment checks:
  [ ] Review and apply database migrations before deployment.
  [ ] Configure PAYMENT_API_KEY in the deployment environment.
  [ ] Regression test /api/orders before deployment.
  [ ] Review job schedules and verify the affected jobs in the deployment environment.
  [ ] Install dependencies from the updated manifest and lockfile, then run relevant tests.
```

## Architecture

```text
CLI -> Git adapter -> ChangeContext -> Detectors -> Findings -> Terminal reporter
```

- `src/cli.ts` coordinates analysis, writes the completed report, and selects an exit code.
- `src/git/gitAdapter.ts` runs Git through Node's `execFile`, passing arguments without a shell. An optional content filter loads before-and-after versions only for selected changed paths; renamed files preserve their original path.
- `src/git/parseNameStatus.ts` parses null-delimited file statuses, preserving unusual filenames and rename paths.
- `src/core/types.ts` defines the change context, severity, structured findings, and detector interface.
- `src/core/runDetectors.ts` runs detectors, deduplicates equivalent findings, and orders them by severity.
- `src/detectors/migrationDetector.ts` recognizes migration paths and change statuses.
- `src/detectors/environmentDetector.ts` compares environment names using [Babel's JS/TS parser](https://babeljs.io/docs/babel-parser) for code and Node's built-in [parseEnv](https://nodejs.org/api/util.html#utilparseenvcontent) for example templates. Parsing syntax avoids treating comments and strings as executable references; no type checking or code execution is performed.
- `src/detectors/apiRouteDetector.ts` maps supported Next.js file paths to API URL patterns and checks both sides of renames.
- `src/detectors/dependencyDetector.ts` compares dependency maps with JSON parsing and summarizes unexplained lockfile changes.
- `src/detectors/cronConfigDetector.ts` flags known job and configuration paths without reading their contents.
- `src/reporters/terminalReporter.ts` formats findings without running Git or printing directly.
- `src/errors/ChangeRadarError.ts` provides typed errors with user-facing messages.

Each detector implements `name` and `detect(context): Finding[]`. To add a detector, implement that interface and register it in the CLI's detector list. Detection stays independent of formatting, so the same findings can later support another output format.

When using the library directly, load source and manifest contents before running their detectors:

```ts
import {
  getChanges, runDetectors, isEnvironmentSource, isDependencyManifest,
  environmentDetector, migrationDetector, apiRouteDetector, dependencyDetector, cronConfigDetector,
} from "changeradar";

const context = await getChanges(process.cwd(), {
  includeContent: (path) => isEnvironmentSource(path) || isDependencyManifest(path),
});
const findings = runDetectors(context, [
  migrationDetector, environmentDetector, apiRouteDetector, dependencyDetector, cronConfigDetector,
]);
```

The environment detector requires content snapshots; the dependency detector requires a snapshot for each changed root manifest. Both fail clearly if required contents were not loaded. The CLI loads them automatically.

Duplicate findings have the same detector, severity, title, description, file set, and suggested action. Different files or advice remain separate findings. A detector failure stops analysis with a tool error instead of producing an incomplete success report.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Tests cover Git parsing, real temporary Git repositories, all five detector categories, duplicate handling, report formatting, and complete CLI analysis with exit codes.

## Exit Codes

- `0`: analysis completed with no HIGH findings, or help/version displayed.
- `1`: HIGH deployment-impact findings detected.
- `2`: CLI usage or tool execution error.

ChangeRadar highlights detected impacts; humans still decide whether and how to deploy.
