import type { Detector, Finding } from "../core/types.js";
import { ChangeRadarError } from "../errors/ChangeRadarError.js";

const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
type DependencySection = typeof sections[number];
type DependencyMaps = Map<DependencySection, Map<string, string>>;
const lockfiles = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
const installCheck = "Install dependencies from the updated manifest and lockfile, then run relevant tests.";

export function isDependencyManifest(path: string): boolean {
  return path === "package.json";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDependencies(source: string, path: string): DependencyMaps {
  try {
    const manifest: unknown = JSON.parse(source);
    if (!isObject(manifest)) throw new Error("Expected a manifest object");
    const result: DependencyMaps = new Map();
    for (const section of sections) {
      if (!Object.hasOwn(manifest, section)) continue;
      const value = manifest[section];
      if (!isObject(value)) throw new Error("Expected a dependency map");
      const dependencies = new Map<string, string>();
      for (const [name, specifier] of Object.entries(value)) {
        if (typeof specifier !== "string") throw new Error("Expected a dependency specifier string");
        dependencies.set(name, specifier);
      }
      result.set(section, dependencies);
    }
    return result;
  } catch (cause) {
    throw new ChangeRadarError(
      "INVALID_MANIFEST",
      `Unable to analyze dependencies in ${JSON.stringify(path)}. Expected valid JSON with dependency sections mapping names to strings.`,
      { cause },
    );
  }
}

function displayName(name: string): string {
  return /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(name) ? JSON.stringify(name) : name;
}

export const dependencyDetector: Detector = {
  name: "dependency",
  detect(context) {
    const findings: Finding[] = [];
    const changedLockfiles = new Set<string>();
    for (const file of context.files) {
      const previousPath = file.status === "renamed" ? file.previousPath : file.path;
      if (lockfiles.has(previousPath) || lockfiles.has(file.path)) {
        changedLockfiles.add(previousPath);
        changedLockfiles.add(file.path);
      }
      if (!isDependencyManifest(file.path) && !isDependencyManifest(previousPath)) continue;
      const contents = context.fileContents?.find((item) => item.path === file.path
        && item.previousPath === (file.status === "renamed" ? file.previousPath : undefined));
      if (!contents) {
        throw new ChangeRadarError("DETECTOR_FAILED", "Dependency analysis requires before-and-after package.json contents.");
      }
      const before: DependencyMaps = file.status !== "added" && isDependencyManifest(previousPath)
        ? readDependencies(contents.before, previousPath) : new Map();
      const after: DependencyMaps = file.status !== "deleted" && isDependencyManifest(file.path)
        ? readDependencies(contents.after, file.path) : new Map();
      for (const section of sections) {
        const oldDependencies = before.get(section) ?? new Map<string, string>();
        const newDependencies = after.get(section) ?? new Map<string, string>();
        const names = new Set<string>([...oldDependencies.keys(), ...newDependencies.keys()]);
        for (const name of [...names].sort()) {
          if (oldDependencies.get(name) === newDependencies.get(name)) continue;
          const change = !oldDependencies.has(name) ? "Added" : !newDependencies.has(name) ? "Removed" : "Updated";
          findings.push({
            detector: "dependency",
            severity: "LOW",
            title: `${change} dependency: ${displayName(name)}`,
            description: `Dependency section: ${section}.`,
            files: file.status === "renamed" ? [file.previousPath, file.path] : [file.path],
            suggestedAction: file.status === "deleted" || !isDependencyManifest(file.path)
              ? "Review the removed package manifest and update dependency installation steps."
              : installCheck,
          });
        }
      }
    }
    // Manifest findings explain direct changes; lockfiles alone still need a check.
    if (findings.length === 0 && changedLockfiles.size > 0) {
      findings.push({
        detector: "dependency",
        severity: "LOW",
        title: "Dependency lockfiles changed",
        description: "Resolved dependency changes may require installation and regression tests.",
        files: [...changedLockfiles].sort(),
        suggestedAction: installCheck,
      });
    }
    return findings;
  },
};
