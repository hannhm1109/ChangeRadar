import { getAnalysisExitCode } from "../core/exitCodes.js";
import type { AnalysisExitCode } from "../core/exitCodes.js";
import type { ChangeComparison, ChangeContext, ChangedFile, Finding, Severity } from "../core/types.js";

export interface JsonReport {
  schemaVersion: 1;
  comparison: ChangeComparison | null;
  summary: {
    changedFileCount: number;
    findingCount: number;
    bySeverity: Record<Severity, number>;
    exitCode: AnalysisExitCode;
  };
  files: ChangedFile[];
  findings: Finding[];
  suggestedChecks: string[];
}

export function formatJsonReport(context: ChangeContext, findings: readonly Finding[]): string {
  const comparison = context.comparison;
  const bySeverity: Record<Severity, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const finding of findings) bySeverity[finding.severity]++;

  // Serialize report metadata explicitly, never the context's patches or content snapshots.
  const report: JsonReport = {
    schemaVersion: 1,
    comparison: comparison === undefined ? null : comparison.mode === "working-tree"
      ? { mode: comparison.mode, baseRef: comparison.baseRef, baseCommit: comparison.baseCommit }
      : {
        mode: comparison.mode, baseRef: comparison.baseRef, targetRef: comparison.targetRef,
        baseCommit: comparison.baseCommit, targetCommit: comparison.targetCommit,
      },
    summary: {
      changedFileCount: context.files.length,
      findingCount: findings.length,
      bySeverity,
      exitCode: getAnalysisExitCode(findings),
    },
    files: context.files.map((file) => file.status === "renamed"
      ? { status: file.status, path: file.path, previousPath: file.previousPath }
      : { status: file.status, path: file.path }),
    findings: findings.map((finding) => ({
      detector: finding.detector,
      severity: finding.severity,
      title: finding.title,
      ...(finding.description === undefined ? {} : { description: finding.description }),
      files: [...finding.files],
      ...(finding.suggestedAction === undefined ? {} : { suggestedAction: finding.suggestedAction }),
    })),
    suggestedChecks: [...new Set(findings.flatMap((finding) => finding.suggestedAction
      ? [finding.suggestedAction] : []))],
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}
