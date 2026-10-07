import { styleText } from "node:util";
import type { ChangeContext, Finding, Severity } from "../core/types.js";

export interface TerminalReportOptions {
  color?: boolean;
}

function comparisonLabel(context: ChangeContext): string {
  const comparison = context.comparison;
  if (!comparison) return "against HEAD";
  const base = JSON.stringify(comparison.baseRef).slice(1, -1);
  if (comparison.mode === "working-tree") return `against ${base}`;
  const target = JSON.stringify(comparison.targetRef).slice(1, -1);
  return comparison.mode === "two-dot"
    ? `between ${base} and ${target} (committed)`
    : `from merge base of ${base} and ${target} to ${target} (committed)`;
}

export function formatTerminalReport(
  context: ChangeContext,
  findings: readonly Finding[],
  options: TerminalReportOptions = {},
): string {
  const fileCount = context.files.length;
  const impactCount = findings.length;
  const lines = [
    "ChangeRadar",
    "",
    `${fileCount} ${fileCount === 1 ? "file" : "files"} changed ${comparisonLabel(context)}`,
    `${impactCount} deployment ${impactCount === 1 ? "impact" : "impacts"} detected`,
  ];

  if (impactCount === 0) {
    lines.push("", fileCount === 0
      ? "No changed files to analyze."
      : "No deployment impacts detected by enabled detectors.");
  }

  const severities: Severity[] = ["HIGH", "MEDIUM", "LOW"];
  for (const severity of severities) {
    const group = findings.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;
    const colors = { HIGH: "red", MEDIUM: "yellow", LOW: "cyan" } as const;
    lines.push("", options.color ? styleText(["bold", colors[severity]], severity, { validateStream: false }) : severity);
    for (const finding of group) {
      lines.push(`  ${finding.title}`);
      if (finding.description) lines.push(`    ${finding.description}`);
      for (const path of finding.files) lines.push(`    ${JSON.stringify(path)}`);
    }
  }

  const actions = new Set(findings.flatMap((finding) => finding.suggestedAction
    ? [finding.suggestedAction]
    : []));
  if (actions.size > 0) {
    lines.push("", "Suggested deployment checks:");
    for (const action of actions) lines.push(`  [ ] ${action}`);
  }

  return `${lines.join("\n")}\n`;
}
