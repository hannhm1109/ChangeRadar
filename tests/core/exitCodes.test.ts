import { describe, expect, it } from "vitest";
import { getAnalysisExitCode } from "../../src/core/exitCodes.js";
import type { Finding, Severity } from "../../src/core/types.js";

describe("getAnalysisExitCode", () => {
  it.each<[Severity[], number]>([
    [[], 0], [["LOW"], 0], [["MEDIUM"], 0], [["MEDIUM", "LOW"], 0],
    [["HIGH"], 1], [["LOW", "MEDIUM", "HIGH"], 1], [["HIGH", "HIGH"], 1],
  ])("maps %j to %i", (severities, expected) => {
    const findings: Finding[] = severities.map((severity) => ({ detector: "test", severity, title: "Finding", files: [] }));
    expect(getAnalysisExitCode(findings)).toBe(expected);
  });
});
