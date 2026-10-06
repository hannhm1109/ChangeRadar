import { describe, expect, it } from "vitest";
import type { FileContentChange } from "../../src/core/types.js";
import { environmentDetector, isEnvironmentSource } from "../../src/detectors/environmentDetector.js";

function detect(fileContents: FileContentChange[]) {
  return environmentDetector.detect({ repositoryRoot: "/repo", files: [], diff: "", fileContents });
}

describe("environmentDetector", () => {
  it("reports newly added references with MEDIUM severity and names only", () => {
    expect(detect([{
      path: "src/config.ts", before: "", after: 'const key = process.env.PAYMENT_API_KEY || "never-print-this";',
    }])).toEqual([{
      detector: "environment", severity: "MEDIUM",
      title: "New environment variable detected: PAYMENT_API_KEY",
      files: ["src/config.ts"],
      suggestedAction: "Configure PAYMENT_API_KEY in the deployment environment.",
    }]);
  });

  it.each([
    "process.env.API_KEY",
    "process . env . API_KEY",
    'process.env["API_KEY"]',
    "process.env['API_KEY']",
    "process.env?.API_KEY",
    "process?.env?.API_KEY",
  ])("detects static reference %s", (source) => {
    expect(detect([{ path: "config.js", before: "", after: source }])[0]?.title)
      .toBe("New environment variable detected: API_KEY");
  });

  it("ignores comments, strings, regexes, template text, and lookalike objects", () => {
    const after = [
      "// process.env.COMMENT",
      "/* process.env.BLOCK_COMMENT */",
      'const example = "process.env.STRING";',
      "const template = `process.env.TEMPLATE_TEXT`;",
      "const regex = /process.env.REGEX/;",
      "myprocess.env.LOOKALIKE;",
      "other.process.env.NESTED_OBJECT;",
      "const value = process.env[variable];",
    ].join("\n");
    expect(detect([{ path: "config.ts", before: "", after }])).toEqual([]);
  });

  it("finds references inside template expressions and TSX", () => {
    const findings = detect([{
      path: "component.tsx", before: "",
      after: 'const label: string = `${process.env.LABEL}`; const view = <div>{process.env.API_URL}</div>;',
    }]);
    expect(findings.map((finding) => finding.title)).toEqual([
      "New environment variable detected: API_URL", "New environment variable detected: LABEL",
    ]);
  });

  it.each(["config.ts", "config.mts", "config.cts", "config.js", "config.mjs", "config.cjs", "config.jsx"])
    ("supports source extension %s", (path) => {
      expect(detect([{ path, before: "", after: "process.env.API_KEY;" }])).toHaveLength(1);
    });

  it("ignores unchanged names after formatting edits and only reports a new name", () => {
    const findings = detect([{
      path: "config.ts",
      before: "const existing = process.env.EXISTING;",
      after: "const renamed = process.env.EXISTING;\nconst added = process.env.ADDED;",
    }]);
    expect(findings.map((finding) => finding.title)).toEqual(["New environment variable detected: ADDED"]);
  });

  it("deduplicates names across source and example files, retaining all affected paths", () => {
    const findings = detect([
      { path: "z.ts", before: "", after: "process.env.API_KEY; process.env.API_KEY;" },
      { path: "a.js", before: "", after: "process.env.API_KEY;" },
      { path: ".env.example", before: "", after: "API_KEY=example-value\nAPI_KEY=another-value" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.files).toEqual([".env.example", "a.js", "z.ts"]);
    expect(JSON.stringify(findings)).not.toContain("example-value");
  });

  it("ignores names moved between changed files or retained across a rename", () => {
    expect(detect([
      { path: "old.ts", before: "process.env.API_KEY;", after: "" },
      { path: "new.ts", before: "", after: "process.env.API_KEY;" },
    ])).toEqual([]);
    expect(detect([{
      path: "new.ts", previousPath: "old.ts", before: "process.env.API_KEY;", after: "process.env.API_KEY;",
    }])).toEqual([]);
  });

  it("compares .env.example keys, ignoring value changes and commented entries", () => {
    const findings = detect([{
      path: "config/.env.example",
      before: "EXISTING=old-placeholder\nREMOVED=\n",
      after: "EXISTING=new-placeholder\nexport API_KEY=example-value\n# COMMENTED=\n",
    }]);
    expect(findings.map((finding) => finding.title)).toEqual(["New environment variable detected: API_KEY"]);
  });

  it("does not treat assignment-like text inside multiline example values as names", () => {
    const findings = detect([{
      path: ".env.example", before: "", after: 'CERT="first line\nFAKE_KEY=inside-value\nlast line"\nREAL_KEY=\n',
    }]);
    expect(findings.map((finding) => finding.title)).toEqual([
      "New environment variable detected: CERT", "New environment variable detected: REAL_KEY",
    ]);
  });

  it.each([".env", ".env.local", "config/.env.production", "README.md", "config.json", "config.py"])
    ("ignores unsupported or secret source %s", (path) => {
      expect(isEnvironmentSource(path)).toBe(false);
      expect(detect([{ path, before: "", after: "process.env.API_KEY;" }])).toEqual([]);
    });

  it("ignores removed references and empty contexts", () => {
    expect(detect([{ path: "deleted.ts", before: "process.env.API_KEY;", after: "" }])).toEqual([]);
    expect(detect([])).toEqual([]);
  });

  it("fails clearly when source contents were not loaded", () => {
    expect(() => environmentDetector.detect({ repositoryRoot: "/repo", files: [], diff: "" }))
      .toThrow(expect.objectContaining({ code: "DETECTOR_FAILED" }));
  });

  it("returns a useful parser error without including source text", () => {
    expect(() => detect([{ path: "broken.ts", before: "", after: 'const password = "private-value' }]))
      .toThrow(expect.objectContaining({ code: "INVALID_SOURCE", message: expect.stringContaining('"broken.ts"') }));
  });
});
