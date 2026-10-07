import type { Finding } from "./types.js";

export type AnalysisExitCode = 0 | 1;

export function getAnalysisExitCode(findings: readonly Finding[]): AnalysisExitCode {
  return findings.some((finding) => finding.severity === "HIGH") ? 1 : 0;
}
