import type { ChangeContext, Finding, Severity } from "../core/types.js";

export function formatTerminalReport(context: ChangeContext, findings: readonly Finding[]): string {
  const fileCount = context.files.length;
  const impactCount = findings.length;
  const lines = [
    "ChangeRadar",
    "",
    `${fileCount} ${fileCount === 1 ? "file" : "files"} changed against HEAD`,
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
    lines.push("", severity);
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
