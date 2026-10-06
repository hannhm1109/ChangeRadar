import { describe, expect, it, vi } from "vitest";
import type { ChangeContext, Detector, Finding } from "../../src/core/types.js";
import { runDetectors } from "../../src/core/runDetectors.js";

const context: ChangeContext = { repositoryRoot: "/repo", files: [], diff: "" };
const finding: Finding = {
  detector: "test",
  severity: "MEDIUM",
  title: "Configuration changed",
  files: ["config.json"],
};

function detector(findings: Finding[]): Detector {
  return { name: "test", detect: () => findings };
}

describe("runDetectors", () => {
  it("returns no findings when no detectors or no matches exist", () => {
    expect(runDetectors(context, [])).toEqual([]);
    expect(runDetectors(context, [detector([])])).toEqual([]);
  });

  it("passes the context to each detector and orders findings by severity", () => {
    const low: Finding = { ...finding, severity: "LOW" };
    const high: Finding = { ...finding, severity: "HIGH" };
    const first = { name: "first", detect: vi.fn(() => [low, finding]) };
    const second = { name: "second", detect: vi.fn(() => [high]) };
    expect(runDetectors(context, [first, second])).toEqual([high, finding, low]);
    expect(first.detect).toHaveBeenCalledExactlyOnceWith(context);
    expect(second.detect).toHaveBeenCalledExactlyOnceWith(context);
  });

  it("deduplicates equivalent findings without mutating detector output", () => {
    const original: Finding = { ...finding, files: ["b.json", "a.json", "a.json"] };
    const reordered: Finding = { ...finding, files: ["a.json", "b.json"] };
    expect(runDetectors(context, [detector([original, reordered, original])])).toEqual([
      { ...finding, files: ["a.json", "b.json"] },
    ]);
    expect(original.files).toEqual(["b.json", "a.json", "a.json"]);
  });

  it("keeps findings with different files, detectors, descriptions, or advice", () => {
    const distinct: Finding[] = [
      finding,
      { ...finding, files: ["other.json"] },
      { ...finding, detector: "other" },
      { ...finding, description: "Extra context" },
      { ...finding, suggestedAction: "Review configuration" },
    ];
    expect(runDetectors(context, [detector(distinct)])).toEqual(distinct);
  });

  it("fails the analysis if a detector throws and retains the cause", () => {
    const cause = new Error("Internal detector failure");
    const broken: Detector = { name: "broken", detect() { throw cause; } };
    expect(() => runDetectors(context, [detector([finding]), broken])).toThrow(
      expect.objectContaining({ code: "DETECTOR_FAILED", cause }),
    );
  });
});
