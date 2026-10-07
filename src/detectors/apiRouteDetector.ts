import type { Detector, Finding } from "../core/types.js";

function isRouteGroup(segment: string): boolean {
  return /^\([^()]+\)$/.test(segment) && !/^\(\.{1,3}\)$/.test(segment);
}

function getApiRoute(path: string): string | undefined {
  const app = path.match(/^(?:src\/)?app\/(.+)\/route\.(?:js|ts)$/s);
  if (app) {
    const segments = app[1]!.split("/");
    if (segments.some((segment) => segment.startsWith("_") || segment.startsWith("@")
      || (segment.startsWith("(") && !isRouteGroup(segment)))) return undefined;
    const urlSegments = segments.filter((segment) => !isRouteGroup(segment));
    return urlSegments[0] === "api" ? `/${urlSegments.join("/")}` : undefined;
  }

  const pages = path.match(/^(?:src\/)?pages\/api\/(.+)\.(?:js|jsx|ts|tsx)$/s);
  if (!pages) return undefined;
  const relative = pages[1]!;
  if (/\.(?:d|test|spec)$/.test(relative)) return undefined;
  const segments = relative.split("/");
  if (segments.includes("__tests__")) return undefined;
  if (segments.at(-1) === "index") segments.pop();
  return ["", "api", ...segments].join("/");
}

function displayRoute(route: string): string {
  return /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(route) ? JSON.stringify(route) : route;
}

function routeFinding(
  status: "added" | "modified" | "deleted",
  route: string,
  files: string[],
  description?: string,
): Finding {
  const label = displayRoute(route);
  const finding: Finding = {
    detector: "api-route",
    severity: "MEDIUM",
    title: `API route ${status}: ${label}`,
    files,
    suggestedAction: status === "deleted"
      ? `Review consumers of ${label} before deployment.`
      : `Regression test ${label} before deployment.`,
  };
  if (description) finding.description = description;
  return finding;
}

export const apiRouteDetector: Detector = {
  name: "api-route",
  detect(context) {
    const findings: Finding[] = [];
    for (const file of context.files) {
      const route = getApiRoute(file.path);
      if (file.status !== "renamed") {
        if (route) findings.push(routeFinding(file.status, route, [file.path]));
        continue;
      }

      const previousRoute = getApiRoute(file.previousPath);
      const files = [file.previousPath, file.path];
      if (route && previousRoute && route !== previousRoute) {
        const previousLabel = displayRoute(previousRoute);
        const label = displayRoute(route);
        findings.push({
          detector: "api-route",
          severity: "MEDIUM",
          title: `API route renamed: ${previousLabel} -> ${label}`,
          files,
          suggestedAction: `Review consumers of ${previousLabel} and regression test ${label} before deployment.`,
        });
      } else if (route && previousRoute) {
        findings.push(routeFinding("modified", route, files, "Route file renamed; URL pattern is unchanged."));
      } else if (route) {
        findings.push(routeFinding("added", route, files, "Moved into a supported API route path."));
      } else if (previousRoute) {
        findings.push(routeFinding("deleted", previousRoute, files, "Moved out of a supported API route path."));
      }
    }
    return findings;
  },
};
