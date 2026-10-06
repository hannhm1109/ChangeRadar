import { describe, expect, it } from "vitest";
import { parseNameStatus } from "../../src/git/parseNameStatus.js";

describe("parseNameStatus", () => {
  it("returns no files for empty output", () => {
    expect(parseNameStatus("")).toEqual([]);
  });

  it("parses additions, modifications, deletions, and type changes", () => {
    expect(parseNameStatus("A\0new.ts\0M\0existing.ts\0D\0old.ts\0T\0link\0")).toEqual([
      { status: "added", path: "new.ts" },
      { status: "modified", path: "existing.ts" },
      { status: "deleted", path: "old.ts" },
      { status: "modified", path: "link" },
    ]);
  });

  it.each(["R100", "R75", "R9"])("preserves both rename paths for %s", (status) => {
    expect(parseNameStatus(`${status}\0old name.ts\0new name.ts\0`)).toEqual([
      { status: "renamed", previousPath: "old name.ts", path: "new name.ts" },
    ]);
  });

  it.each([" file with spaces.ts ", "tab\tname.ts", "line\nbreak.ts", "caf\u00e9.ts", 'quote"name.ts'])
    ("preserves unusual path %j", (path) => {
      expect(parseNameStatus(`M\0${path}\0`)).toEqual([{ status: "modified", path }]);
    });

  it.each(["M\0file.ts", "M\0", "M\0\0", "R100\0old.ts\0", "R101\0old\0new\0", "U\0file\0", "C100\0old\0new\0", "X\0file\0", "M\tfile.ts\n"])
    ("rejects malformed or unsupported output %j", (output) => {
      expect(() => parseNameStatus(output)).toThrow("unexpected name-status output");
    });
});
