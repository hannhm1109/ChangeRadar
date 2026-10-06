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

  it.each(["modified", "deleted"] as const)("does not yet report %s migrations", (status) => {
    expect(detect([{ status, path: "prisma/migrations/init/migration.sql" }])).toEqual([]);
  });

  it("does not yet report renamed migrations", () => {
    expect(detect([{
      status: "renamed",
      previousPath: "prisma/migrations/old/migration.sql",
      path: "prisma/migrations/new/migration.sql",
    }])).toEqual([]);
  });

  it.each([
    "src/migration.sql",
    "prisma/migrations/migration_lock.toml",
    "prisma/migrations/init/README.md",
    "prisma/migrations/migration.sql",
    "not-prisma/migrations/init/migration.sql",
    "prisma/migrations/init/nested/migration.sql",
  ])("ignores unrelated or metadata path %s", (path) => {
    expect(detect([{ status: "added", path }])).toEqual([]);
  });

  it("returns no findings for no changes", () => {
    expect(detect([])).toEqual([]);
  });
});
