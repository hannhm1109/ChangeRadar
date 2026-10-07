import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../../src/core/types.js";
import { cronConfigDetector } from "../../src/detectors/cronConfigDetector.js";
import { runDetectors } from "../../src/core/runDetectors.js";

function detect(files: ChangedFile[]) {
  return cronConfigDetector.detect({ repositoryRoot: "/repo", files, diff: "" });
}

describe("cronConfigDetector", () => {
  it.each([
    ["crontab", "Scheduled job file"],
    ["crontab.txt", "Scheduled job file"],
    ["cron.d/cleanup", "Scheduled job file"],
    ["cron/cleanup.sh", "Scheduled job file"],
    ["cron/tasks/cleanup.ts", "Scheduled job file"],
    ["cron/cleanup.py", "Scheduled job file"],
    ["cron/cleanup.mjs", "Scheduled job file"],
    ["vercel.json", "Deployment configuration"],
    [".github/workflows/deploy.yml", "CI workflow"],
    [".github/workflows/scheduled.yaml", "CI workflow"],
    ["Dockerfile", "Container configuration"],
    ["Dockerfile.production", "Container configuration"],
    [".dockerignore", "Container configuration"],
    ["docker-compose.yml", "Container configuration"],
    ["docker-compose.prod.yaml", "Container configuration"],
    ["compose.yaml", "Container configuration"],
    ["compose.staging.yml", "Container configuration"],
  ])("reports relevant path %s", (path, label) => {
    const findings = detect([{ status: "modified", path }]);
    expect(findings[0]).toMatchObject({
      detector: "cron-config", severity: "MEDIUM", title: `${label} modified`, files: [path],
    });
    expect(findings[0]?.suggestedAction).toBeTruthy();
  });

  it.each(["added", "modified", "deleted"] as const)("reports configuration %s", (status) => {
    expect(detect([{ status, path: "vercel.json" }])[0]?.title).toBe(`Deployment configuration ${status}`);
  });

  it.each([
    "README.md", "config.json", "src/config.ts", "cron/README.md", "cron/cleanup.test.ts",
    "cron/cleanup.spec.py", "cron/types.d.ts", "cron/__tests__/cleanup.ts", "cron.d/README.md",
    "crontab.example", "my-cron/cleanup.sh", "docs/vercel.json", "packages/site/vercel.json",
    ".github/README.md", ".github/workflows/README.md", ".github/workflows/nested/deploy.yml",
    "Dockerfile.md", "docs/Dockerfile", "docker-compose.example.yml", "compose.json",
  ])("ignores unrelated, example, or test path %s", (path) => {
    expect(detect([{ status: "modified", path }])).toEqual([]);
  });

  it("includes both workflow paths for a rename", () => {
    const findings = detect([{
      status: "renamed", previousPath: ".github/workflows/old.yml", path: ".github/workflows/new.yml",
    }]);
    expect(findings[0]).toMatchObject({
      title: "CI workflow renamed", files: [".github/workflows/old.yml", ".github/workflows/new.yml"],
    });
  });

  it("reports moves into and out of recognized paths", () => {
    const findings = detect([
      { status: "renamed", previousPath: "draft.yml", path: ".github/workflows/deploy.yml" },
      { status: "renamed", previousPath: "cron/cleanup.sh", path: "archive/cleanup.sh" },
    ]);
    expect(findings.map((finding) => finding.title)).toEqual(["CI workflow added", "Scheduled job file deleted"]);
    expect(findings[0]?.description).toContain("Moved into");
    expect(findings[1]?.description).toContain("Moved out");
  });

  it("reports both categories when a file moves between known categories", () => {
    const findings = detect([{
      status: "renamed", previousPath: ".github/workflows/deploy.yml", path: "compose.yml",
    }]);
    expect(findings.map((finding) => finding.title)).toEqual(["CI workflow deleted", "Container configuration added"]);
  });

  it("does not claim that every workflow or Vercel edit is a schedule change", () => {
    const findings = detect([
      { status: "modified", path: "vercel.json" },
      { status: "modified", path: ".github/workflows/test.yml" },
    ]);
    expect(findings.every((finding) => !finding.title.includes("Scheduled job"))).toBe(true);
  });

  it("returns no findings for empty input or unrelated renames", () => {
    expect(detect([])).toEqual([]);
    expect(detect([{ status: "renamed", previousPath: "old.json", path: "new.json" }])).toEqual([]);
  });

  it("preserves distinct files while the runner removes exact duplicates", () => {
    const file: ChangedFile = { status: "modified", path: "cron/cleanup.sh" };
    const context = { repositoryRoot: "/repo", files: [file, file, { status: "modified" as const, path: "cron/report.sh" }], diff: "" };
    expect(runDetectors(context, [cronConfigDetector])).toHaveLength(2);
  });
});
