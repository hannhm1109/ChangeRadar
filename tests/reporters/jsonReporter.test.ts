import { describe, expect, it } from "vitest";
import type { ChangeComparison, ChangeContext, Finding } from "../../src/core/types.js";
import { formatJsonReport } from "../../src/reporters/jsonReporter.js";
import type { JsonReport } from "../../src/reporters/jsonReporter.js";

const context: ChangeContext = { repositoryRoot: "/private/repository-root", files: [], diff: "" };

function readReport(context: ChangeContext, findings: readonly Finding[]): JsonReport {
  return JSON.parse(formatJsonReport(context, findings)) as JsonReport;
}

describe("formatJsonReport", () => {
  it("returns one versioned JSON document with a trailing newline for a clean context", () => {
    expect(readReport(context, [])).toEqual({
      schemaVersion: 1, comparison: null,
      summary: { changedFileCount: 0, findingCount: 0, bySeverity: { HIGH: 0, MEDIUM: 0, LOW: 0 }, exitCode: 0 },
      files: [], findings: [], suggestedChecks: [],
    });
    expect(formatJsonReport(context, []).endsWith("\n")).toBe(true);
  });

  it("counts findings, retains metadata, and deduplicates suggested checks in order", () => {
    const findings: Finding[] = [
      { detector: "migration", severity: "HIGH", title: "Migration added", files: ["a.sql"], suggestedAction: "Apply migrations" },
      { detector: "migration", severity: "HIGH", title: "Migration modified", files: ["b.sql"], suggestedAction: "Apply migrations" },
      { detector: "environment", severity: "MEDIUM", title: "Environment variable added", description: "API_KEY", files: [], suggestedAction: "Configure API_KEY" },
      { detector: "dependency", severity: "LOW", title: "Dependency updated", files: ["package.json"] },
    ];
    const files = [{ status: "renamed", path: 'new\nname\t".ts', previousPath: "old.ts" } as const];
    const report = readReport({ ...context, files }, findings);
    expect(report.summary).toEqual({ changedFileCount: 1, findingCount: 4, bySeverity: { HIGH: 2, MEDIUM: 1, LOW: 1 }, exitCode: 1 });
    expect(report.files).toEqual(files);
    expect(report.findings).toEqual(findings);
    expect(report.suggestedChecks).toEqual(["Apply migrations", "Configure API_KEY"]);
    expect(report.findings[3]).not.toHaveProperty("description");
    expect(report.findings[3]).not.toHaveProperty("suggestedAction");
  });

  it.each<ChangeComparison>([
    { mode: "working-tree", baseRef: "HEAD~1", baseCommit: "base" },
    { mode: "two-dot", baseRef: "main", targetRef: "feature", baseCommit: "base", targetCommit: "target" },
    { mode: "three-dot", baseRef: "main", targetRef: "feature", baseCommit: "ancestor", targetCommit: "target" },
  ])("retains resolved comparison metadata for $mode", (comparison) => {
    expect(readReport({ ...context, comparison }, []).comparison).toEqual(comparison);
  });

  it("distinguishes unmatched changes from a clean repository without turning findings into blockers", () => {
    const changed = { ...context, files: [{ status: "modified", path: "README.md" } as const] };
    expect(readReport(changed, []).summary).toMatchObject({ changedFileCount: 1, findingCount: 0, exitCode: 0 });
    const findings: Finding[] = [{ detector: "test", severity: "MEDIUM", title: "Impact", files: [] }];
    expect(readReport(changed, findings).summary.exitCode).toBe(0);
  });

  it("never serializes context contents, absolute repository paths, or extra payload fields", () => {
    const input = {
      ...context, diff: "raw-patch-private-value",
      fileContents: [{ path: "config.ts", before: "source-before-private-value", after: "source-after-private-value" }],
      files: [{ status: "modified", path: "config.ts", rawContents: "file-private-value" } as const],
      comparison: { mode: "working-tree" as const, baseRef: "HEAD", baseCommit: "base", rawContents: "comparison-private-value" },
    };
    const findings = [{ detector: "test", severity: "LOW" as const, title: "Impact", files: ["config.ts"], rawContents: "finding-private-value" }];
    const output = formatJsonReport(input, findings);
    expect(output).not.toContain("private-value");
    expect(output).not.toContain(context.repositoryRoot);
    expect(output).not.toContain("rawContents");
    expect(Object.keys(JSON.parse(output))).toEqual(["schemaVersion", "comparison", "summary", "files", "findings", "suggestedChecks"]);
  });

  it("produces stable output without mutating caller-owned data", () => {
    const findings: Finding[] = [{ detector: "test", severity: "LOW", title: "Impact", files: ["b.ts", "a.ts"] }];
    const original = JSON.stringify({ context, findings });
    expect(formatJsonReport(context, findings)).toBe(formatJsonReport(context, findings));
    expect(JSON.stringify({ context, findings })).toBe(original);
  });
});
