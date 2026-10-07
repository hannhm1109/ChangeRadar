# Changelog

## 0.1.0

Initial ChangeRadar release candidate.

- Detect new environment names, database migrations, Next.js API routes, dependency changes, and scheduled-job/deployment configuration changes.
- Analyze net working-tree changes, a single Git reference, or committed two-dot/three-dot comparisons.
- Produce grouped text reports or versioned JSON with suggested deployment checks.
- Use exit codes `0` for no HIGH findings, `1` for HIGH findings, and `2` for tool errors.
- Exclude private environment-file contents, reject sensitive renames, and stop on unresolved working-tree merge conflicts.
- Handle asynchronous report-write errors and avoid buffering unused raw patches.
- Include a temporary-repository demo, a GitHub Actions usage example, and package-install smoke checks.

Node.js 22.12 or newer and Git are required. This is a focused MVP: no custom configuration, monorepo discovery, deployment execution, or safety guarantees. npm publication is deferred.
