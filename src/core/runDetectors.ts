import type { ChangeContext, Detector, Finding, Severity } from "./types.js";
import { ChangeRadarError } from "../errors/ChangeRadarError.js";

const severityOrder: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function runDetectors(context: ChangeContext, detectors: readonly Detector[]): Finding[] {
  const unique = new Map<string, Finding>();

  for (const detector of detectors) {
    let findings: Finding[];
    try {
      findings = detector.detect(context);
    } catch (cause) {
      throw new ChangeRadarError(
        "DETECTOR_FAILED",
        `Detector "${detector.name}" failed. Analysis could not be completed.`,
        { cause },
      );
    }

    for (const finding of findings) {
      const normalized = { ...finding, files: [...new Set(finding.files)].sort() };
      // File order is not part of a finding's identity; distinct advice is.
      const key = JSON.stringify([
        normalized.detector,
        normalized.severity,
        normalized.title,
        normalized.description ?? null,
        normalized.files,
        normalized.suggestedAction ?? null,
      ]);
      if (!unique.has(key)) unique.set(key, normalized);
    }
  }

  return [...unique.values()].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}
