import { describe, expect, it } from "vitest";
import type { ChangeContext, ChangedFile, FileContentChange } from "../../src/core/types.js";
import { dependencyDetector, isDependencyManifest } from "../../src/detectors/dependencyDetector.js";
import { runDetectors } from "../../src/core/runDetectors.js";

function context(files: ChangedFile[], fileContents?: FileContentChange[]): ChangeContext {
  return { repositoryRoot: "/repo", files, diff: "", ...(fileContents ? { fileContents } : {}) };
}

function compare(before: unknown, after: unknown, otherFiles: ChangedFile[] = []) {
  return dependencyDetector.detect(context(
    [{ status: "modified", path: "package.json" }, ...otherFiles],
    [{ path: "package.json", before: JSON.stringify(before), after: JSON.stringify(after) }],
  ));
}

describe("dependencyDetector", () => {
  it("reports added, removed, and updated dependency names with LOW severity", () => {
    const findings = compare(
      { dependencies: { axios: "1", zod: "3", stable: "1" } },
      { dependencies: { stripe: "1", zod: "4", stable: "1" } },
    );
    expect(findings.map((finding) => finding.title)).toEqual([
      "Removed dependency: axios", "Added dependency: stripe", "Updated dependency: zod",
    ]);
    expect(findings.every((finding) => finding.severity === "LOW")).toBe(true);
    expect(findings[0]).toMatchObject({ detector: "dependency", files: ["package.json"], description: "Dependency section: dependencies." });
  });

  it.each(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])
    ("identifies changes in %s", (section) => {
      const findings = compare({ [section]: { package: "1" } }, { [section]: { package: "2" } });
      expect(findings[0]).toMatchObject({ title: "Updated dependency: package", description: `Dependency section: ${section}.` });
    });

  it("keeps dependency-section moves visible", () => {
    const findings = compare({ devDependencies: { tool: "1" } }, { dependencies: { tool: "1" } });
    expect(findings.map((finding) => [finding.title, finding.description])).toEqual([
      ["Added dependency: tool", "Dependency section: dependencies."],
      ["Removed dependency: tool", "Dependency section: devDependencies."],
    ]);
  });

  it("ignores metadata, scripts, package version, and key-order changes", () => {
    expect(compare(
      { version: "1", scripts: { build: "old" }, dependencies: { b: "2", a: "1" } },
      { version: "2", scripts: { build: "new" }, description: "Changed", dependencies: { a: "1", b: "2" } },
    )).toEqual([]);
  });

  it("does not print dependency specifiers or embedded credentials", () => {
    const findings = compare(
      { dependencies: { private: "git+https://old-credential@example.com/private.git" } },
      { dependencies: { private: "git+https://new-credential@example.com/private.git" } },
    );
    expect(findings[0]?.title).toBe("Updated dependency: private");
    expect(JSON.stringify(findings)).not.toContain("credential");
  });

  it("suppresses a redundant lockfile summary when the manifest explains direct changes", () => {
    const findings = compare({}, { dependencies: { stripe: "1" } }, [
      { status: "modified", path: "package-lock.json" },
    ]);
    expect(findings.map((finding) => finding.title)).toEqual(["Added dependency: stripe"]);
  });

  it("reports a lockfile change when manifest changes are metadata-only", () => {
    const findings = compare({ version: "1" }, { version: "2" }, [
      { status: "modified", path: "package-lock.json" },
    ]);
    expect(findings[0]?.title).toBe("Dependency lockfiles changed");
  });

  it("groups lockfile-only changes into one finding without needing contents", () => {
    const findings = dependencyDetector.detect(context([
      { status: "modified", path: "yarn.lock" },
      { status: "added", path: "pnpm-lock.yaml" },
      { status: "deleted", path: "package-lock.json" },
    ]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "LOW", files: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"] });
  });

  it("keeps both paths when a recognized lockfile moves elsewhere", () => {
    const findings = dependencyDetector.detect(context([
      { status: "renamed", previousPath: "yarn.lock", path: "archive/yarn.lock" },
    ]));
    expect(findings[0]?.files).toEqual(["archive/yarn.lock", "yarn.lock"]);
  });

  it.each(["added", "deleted"] as const)("handles an %s manifest without parsing the absent side", (status) => {
    const source = JSON.stringify({ dependencies: { package: "1" } });
    const findings = dependencyDetector.detect(context([{ status, path: "package.json" }], [{
      path: "package.json", before: status === "added" ? "" : source, after: status === "deleted" ? "" : source,
    }]));
    expect(findings[0]?.title).toBe(`${status === "added" ? "Added" : "Removed"} dependency: package`);
    expect(findings[0]?.suggestedAction).toContain(status === "deleted" ? "removed package manifest" : "Install dependencies");
  });

  it.each([
    ["package.json", "archive/package.json", "Removed"],
    ["drafts/package.json", "package.json", "Added"],
  ])("handles manifest moves from %s to %s", (previousPath, path, change) => {
    const source = JSON.stringify({ dependencies: { package: "1" } });
    const findings = dependencyDetector.detect(context([{ status: "renamed", previousPath, path }], [{
      path, previousPath, before: previousPath === "package.json" ? source : "", after: path === "package.json" ? source : "",
    }]));
    expect(findings[0]?.title).toBe(`${change} dependency: package`);
    expect(findings[0]?.files).toEqual([previousPath, path]);
  });

  it.each(["", "not JSON", "[]", "null", "true", '{"dependencies":null}', '{"dependencies":[]}', '{"dependencies":{"package":42}}'])
    ("rejects malformed manifest or dependency fields %j", (source) => {
      expect(() => dependencyDetector.detect(context([{ status: "added", path: "package.json" }], [
        { path: "package.json", before: "", after: source },
      ]))).toThrow(expect.objectContaining({ code: "INVALID_MANIFEST" }));
    });

  it("fails clearly if contents were not loaded for a changed manifest", () => {
    expect(() => dependencyDetector.detect(context([{ status: "modified", path: "package.json" }])))
      .toThrow(expect.objectContaining({ code: "DETECTOR_FAILED" }));
  });

  it("escapes control characters in dependency names", () => {
    const findings = compare({}, { dependencies: { "line\nbreak": "1" } });
    expect(findings[0]?.title).toBe('Added dependency: "line\\nbreak"');
  });

  it("ignores unrelated and nested package files", () => {
    expect(isDependencyManifest("package.json")).toBe(true);
    expect(isDependencyManifest("packages/app/package.json")).toBe(false);
    expect(dependencyDetector.detect(context([
      { status: "modified", path: "packages/app/package.json" },
      { status: "modified", path: "packages/app/yarn.lock" },
      { status: "modified", path: "README.md" },
    ]))).toEqual([]);
  });

  it("returns no findings for no changes and deduplicates repeated input through the runner", () => {
    expect(dependencyDetector.detect(context([]))).toEqual([]);
    const file: ChangedFile = { status: "added", path: "package.json" };
    const input = context([file, file], [{ path: "package.json", before: "", after: '{"dependencies":{"package":"1"}}' }]);
    expect(runDetectors(input, [dependencyDetector])).toHaveLength(1);
  });
});
