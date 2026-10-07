import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../../src/core/types.js";
import { migrationDetector } from "../../src/detectors/migrationDetector.js";

function detect(files: ChangedFile[]) {
  return migrationDetector.detect({ repositoryRoot: "/repo", files, diff: "" });
}

describe("migrationDetector", () => {
  it("reports an added Prisma migration with a HIGH finding and deployment advice", () => {
    const path = "prisma/migrations/20261006_orders/migration.sql";
    expect(detect([{ status: "added", path }])).toEqual([{
      detector: "migration",
      severity: "HIGH",
      title: "Database migration added",
      files: [path],
      suggestedAction: "Review and apply database migrations before deployment.",
    }]);
  });

  it("reports each migration file separately", () => {
    const files: ChangedFile[] = [
      { status: "added", path: "prisma/migrations/first/migration.sql" },
      { status: "added", path: "prisma/migrations/second/migration.sql" },
    ];
    expect(detect(files).map((finding) => finding.files)).toEqual(files.map((file) => [file.path]));
  });

  it.each(["modified", "deleted"] as const)("reports %s migrations with history review advice", (status) => {
    const findings = detect([{ status, path: "prisma/migrations/init/migration.sql" }]);
    expect(findings[0]).toMatchObject({ title: `Database migration ${status}`, severity: "HIGH" });
    expect(findings[0]?.suggestedAction).toContain("migration history");
  });

  it("reports renamed migrations with both paths", () => {
    const findings = detect([{
      status: "renamed",
      previousPath: "prisma/migrations/old/migration.sql",
      path: "prisma/migrations/new/migration.sql",
    }]);
    expect(findings[0]).toMatchObject({
      title: "Database migration renamed", severity: "HIGH",
      files: ["prisma/migrations/old/migration.sql", "prisma/migrations/new/migration.sql"],
    });
  });

  it.each(["migrations/001.sql", "database/migrations/001.sql", "migrations/nested/001.ts", "migrations/001.js", "migrations/001.cjs", "migrations/001.py", "migrations/001.rb", "migrations/001.php"])
    ("reports common migration source %s", (path) => {
      expect(detect([{ status: "added", path }])[0]).toMatchObject({ severity: "HIGH", files: [path] });
    });

  it.each([
    ["migrations/001.sql", "archive/001.sql", "out of"],
    ["drafts/001.sql", "database/migrations/001.sql", "into"],
  ])("reports a move from %s to %s", (previousPath, path, direction) => {
    const findings = detect([{ status: "renamed", previousPath, path }]);
    expect(findings[0]?.description).toBe(`Moved ${direction} a migration directory.`);
    expect(findings[0]?.files).toEqual([previousPath, path]);
  });

  it.each([
    "src/migration.sql",
    "prisma/migrations/migration_lock.toml",
    "prisma/migrations/init/README.md",
    "prisma/migrations/migration.sql",
    "not-prisma/migrations/init/migration.sql",
    "prisma/migrations/init/nested/migration.sql",
    "migrations/README.md",
    "migrations/.gitkeep",
    "migrations/001.test.ts",
    "migrations/001.spec.js",
    "migrations/001.test.py",
    "migrations/001.spec.sql",
    "migrations/types.d.ts",
    "src/not-migrations/001.sql",
  ])("ignores unrelated or metadata path %s", (path) => {
    expect(detect([{ status: "added", path }])).toEqual([]);
  });

  it("returns no findings for no changes", () => {
    expect(detect([])).toEqual([]);
  });

  it.each(["migrations/line\nbreak.sql", "database/migrations/line\rbreak.ts", "migrations/nested\nname/001.py"])(
    "preserves detection for unusual migration path %j", (path) => {
      expect(detect([{ status: "added", path }])[0]).toMatchObject({ severity: "HIGH", files: [path] });
    },
  );

  it("ignores a rename between unrelated paths", () => {
    expect(detect([{ status: "renamed", previousPath: "old.sql", path: "new.sql" }])).toEqual([]);
  });
});
