import { describe, expect, it } from "vitest";
import type { ChangeContext, Finding } from "../../src/core/types.js";
import { formatTerminalReport } from "../../src/reporters/terminalReporter.js";

const context: ChangeContext = {
  repositoryRoot: "/repo",
  files: [{ status: "modified", path: "config.json" }],
  diff: "",
};

describe("formatTerminalReport", () => {
  it("distinguishes a clean repository from changed files without matching findings", () => {
    const clean = formatTerminalReport({ ...context, files: [] }, []);
    expect(clean).toContain("0 files changed against HEAD");
    expect(clean).toContain("No changed files to analyze.");
    const unmatched = formatTerminalReport(context, []);
    expect(unmatched).toContain("1 file changed against HEAD");
    expect(unmatched).toContain("0 deployment impacts detected");
    expect(unmatched).toContain("No deployment impacts detected by enabled detectors.");
    expect(unmatched).not.toContain("Suggested deployment checks:");
  });

  it("groups severities, includes descriptions, and deduplicates deployment checks", () => {
    const findings: Finding[] = [
      { detector: "dependency", severity: "LOW", title: "Dependencies changed", files: ["package.json"] },
      { detector: "migration", severity: "HIGH", title: "Migration added", files: ["first.sql"], suggestedAction: "Apply migrations" },
      { detector: "environment", severity: "MEDIUM", title: "Environment variable added", description: "PAYMENT_API_KEY", files: [], suggestedAction: "Configure PAYMENT_API_KEY" },
      { detector: "migration", severity: "HIGH", title: "Migration added", files: ["second.sql"], suggestedAction: "Apply migrations" },
    ];
    expect(formatTerminalReport(context, findings)).toBe([
      "ChangeRadar", "", "1 file changed against HEAD", "4 deployment impacts detected",
      "", "HIGH", "  Migration added", '    "first.sql"', "  Migration added", '    "second.sql"',
      "", "MEDIUM", "  Environment variable added", "    PAYMENT_API_KEY",
      "", "LOW", "  Dependencies changed", '    "package.json"',
      "", "Suggested deployment checks:", "  [ ] Apply migrations", "  [ ] Configure PAYMENT_API_KEY", "",
    ].join("\n"));
    expect(findings[0]?.severity).toBe("LOW");
  });

  it("escapes unusual filenames and uses singular impact wording", () => {
    const report = formatTerminalReport(context, [{
      detector: "test", severity: "HIGH", title: "Change detected", files: ['line\nbreak\t".sql'],
    }]);
    expect(report).toContain("1 deployment impact detected");
    expect(report).toContain(`    ${JSON.stringify('line\nbreak\t".sql')}`);
    expect(report).not.toContain("\nMEDIUM\n");
    expect(report.endsWith("\n")).toBe(true);
  });
});
