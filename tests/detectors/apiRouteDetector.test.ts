import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../../src/core/types.js";
import { apiRouteDetector } from "../../src/detectors/apiRouteDetector.js";
import { runDetectors } from "../../src/core/runDetectors.js";
import { formatTerminalReport } from "../../src/reporters/terminalReporter.js";

function detect(files: ChangedFile[]) {
  return apiRouteDetector.detect({ repositoryRoot: "/repo", files, diff: "" });
}

describe("apiRouteDetector", () => {
  it.each([
    ["app/api/orders/route.ts", "/api/orders"],
    ["app/api/orders/route.js", "/api/orders"],
    ["src/app/api/orders/route.ts", "/api/orders"],
    ["app/api/route.ts", "/api"],
    ["app/api/orders/[id]/route.ts", "/api/orders/[id]"],
    ["app/api/[...slug]/route.ts", "/api/[...slug]"],
    ["app/api/[[...slug]]/route.js", "/api/[[...slug]]"],
    ["app/(backend)/api/orders/route.ts", "/api/orders"],
    ["src/app/(backend)/api/(v1)/orders/route.ts", "/api/orders"],
    ["app/api/orders/index/route.ts", "/api/orders/index"],
    ["pages/api/orders.ts", "/api/orders"],
    ["pages/api/orders.js", "/api/orders"],
    ["pages/api/orders.tsx", "/api/orders"],
    ["pages/api/orders.jsx", "/api/orders"],
    ["src/pages/api/orders.ts", "/api/orders"],
    ["pages/api/index.ts", "/api"],
    ["pages/api/orders/index.ts", "/api/orders"],
    ["pages/api/orders/[id].ts", "/api/orders/[id]"],
    ["pages/api/[...slug].js", "/api/[...slug]"],
    ["pages/api/[[...slug]].ts", "/api/[[...slug]]"],
    ["pages/api/index/orders.ts", "/api/index/orders"],
    ["pages/api/route.ts", "/api/route"],
  ])("maps %s to %s", (path, route) => {
    expect(detect([{ status: "modified", path }])).toEqual([{
      detector: "api-route", severity: "MEDIUM", title: `API route modified: ${route}`,
      files: [path], suggestedAction: `Regression test ${route} before deployment.`,
    }]);
  });

  it.each(["added", "modified", "deleted"] as const)("reports a route %s", (status) => {
    const findings = detect([{ status, path: "app/api/orders/route.ts" }]);
    expect(findings[0]).toMatchObject({ severity: "MEDIUM", title: `API route ${status}: /api/orders` });
    expect(findings[0]?.suggestedAction).toContain(status === "deleted" ? "Review consumers" : "Regression test");
  });

  it.each([
    "app/api/orders/page.tsx",
    "app/api/orders/layout.tsx",
    "app/api/orders/helper.ts",
    "app/orders/route.ts",
    "app/apis/orders/route.ts",
    "app/api/orders/route.test.ts",
    "app/api/orders/route.d.ts",
    "app/api/orders/route.ts.bak",
    "app/api/orders/route.mts",
    "app/api/orders/route.tsx",
    "app/api/_internal/orders/route.ts",
    "app/_internal/api/orders/route.ts",
    "app/api/@slot/orders/route.ts",
    "app/api/(.)orders/route.ts",
    "app/api/(..)(..)orders/route.ts",
    "app/api/(...)/route.ts",
    "pages/orders.tsx",
    "pages/apis/orders.ts",
    "pages/api/orders.test.ts",
    "pages/api/orders.spec.js",
    "pages/api/types.d.ts",
    "pages/api/__tests__/orders.ts",
    "pages/api/README.md",
    "pages/api/orders.mjs",
    "server/api/orders.ts",
    "api/orders/route.ts",
    "packages/site/app/api/orders/route.ts",
    "not-app/api/orders/route.ts",
  ])("ignores unsupported or unrelated path %s", (path) => {
    expect(detect([{ status: "modified", path }])).toEqual([]);
  });

  it("reports a renamed URL and both affected files", () => {
    expect(detect([{
      status: "renamed", previousPath: "pages/api/orders.ts", path: "pages/api/purchases.ts",
    }])).toEqual([{
      detector: "api-route", severity: "MEDIUM", title: "API route renamed: /api/orders -> /api/purchases",
      files: ["pages/api/orders.ts", "pages/api/purchases.ts"],
      suggestedAction: "Review consumers of /api/orders and regression test /api/purchases before deployment.",
    }]);
  });

  it.each([
    ["pages/api/orders.js", "pages/api/orders.ts"],
    ["pages/api/orders.ts", "app/api/orders/route.ts"],
    ["app/(old)/api/orders/route.ts", "app/(new)/api/orders/route.ts"],
    ["pages/api/orders.ts", "pages/api/orders/index.ts"],
  ])("preserves the URL for a move from %s to %s", (previousPath, path) => {
    const findings = detect([{ status: "renamed", previousPath, path }]);
    expect(findings[0]).toMatchObject({
      title: "API route modified: /api/orders", description: "Route file renamed; URL pattern is unchanged.",
      files: [previousPath, path],
    });
  });

  it("reports files moved into or out of API routing as added or deleted routes", () => {
    const findings = detect([
      { status: "renamed", previousPath: "drafts/orders.ts", path: "pages/api/orders.ts" },
      { status: "renamed", previousPath: "app/api/old/route.ts", path: "archive/old.ts" },
    ]);
    expect(findings.map((finding) => finding.title)).toEqual([
      "API route added: /api/orders", "API route deleted: /api/old",
    ]);
    expect(findings[0]?.description).toBe("Moved into a supported API route path.");
    expect(findings[1]?.description).toBe("Moved out of a supported API route path.");
  });

  it("returns no findings for no changes or unrelated renames", () => {
    expect(detect([])).toEqual([]);
    expect(detect([{ status: "renamed", previousPath: "old.ts", path: "new.ts" }])).toEqual([]);
  });

  it("keeps distinct changed files while the runner removes exact duplicate findings", () => {
    const file: ChangedFile = { status: "modified", path: "pages/api/orders.ts" };
    const context = { repositoryRoot: "/repo", files: [file, file, { status: "deleted" as const, path: "pages/api/old.ts" }], diff: "" };
    expect(runDetectors(context, [apiRouteDetector]).map((finding) => finding.title)).toEqual([
      "API route modified: /api/orders", "API route deleted: /api/old",
    ]);
  });

  it("escapes control characters in route labels as well as file paths", () => {
    const file: ChangedFile = { status: "modified", path: "pages/api/line\nbreak.ts" };
    const findings = detect([file]);
    expect(findings[0]?.title).toBe('API route modified: "/api/line\\nbreak"');
    const report = formatTerminalReport({ repositoryRoot: "/repo", files: [file], diff: "" }, findings);
    expect(report).not.toContain("line\nbreak");
    expect(report).toContain('"pages/api/line\\nbreak.ts"');
  });
});
