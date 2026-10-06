import { parseEnv } from "node:util";
import { parse } from "@babel/parser";
import type { ParserPlugin } from "@babel/parser";
import { isIdentifier, isMemberExpression, isOptionalMemberExpression, isStringLiteral, traverseFast } from "@babel/types";
import type { Detector, Finding } from "../core/types.js";
import { ChangeRadarError } from "../errors/ChangeRadarError.js";

const variableName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isExample = (path: string) => /(?:^|\/)\.env\.example$/.test(path);

export function isEnvironmentSource(path: string): boolean {
  return isExample(path) || /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path);
}

function collectNames(path: string, source: string): Set<string> {
  if (!source || !isEnvironmentSource(path)) return new Set();
  if (isExample(path)) {
    return new Set(Object.keys(parseEnv(source)).filter((name) => variableName.test(name)));
  }

  const plugins: ParserPlugin[] = [];
  if (/\.(?:[cm]?ts|tsx)$/.test(path)) plugins.push("typescript");
  if (/\.(?:jsx|tsx|js)$/.test(path)) plugins.push("jsx");
  let tree;
  try {
    tree = parse(source, { sourceType: "unambiguous", plugins, attachComment: false, allowReturnOutsideFunction: true });
  } catch (cause) {
    throw new ChangeRadarError(
      "INVALID_SOURCE",
      `Unable to parse environment references in ${JSON.stringify(path)}. Check syntax or unsupported language extensions.`,
      { cause },
    );
  }

  const names = new Set<string>();
  traverseFast(tree, (node) => {
    if (!isMemberExpression(node) && !isOptionalMemberExpression(node)) return;
    const object = node.object;
    if ((!isMemberExpression(object) && !isOptionalMemberExpression(object))
      || object.computed || !isIdentifier(object.object, { name: "process" })
      || !isIdentifier(object.property, { name: "env" })) return;
    const name = !node.computed && isIdentifier(node.property) ? node.property.name
      : node.computed && isStringLiteral(node.property) ? node.property.value : undefined;
    if (name && variableName.test(name)) names.add(name);
  });
  return names;
}

export const environmentDetector: Detector = {
  name: "environment",
  detect(context) {
    if (!context.fileContents) {
      throw new ChangeRadarError("DETECTOR_FAILED", "Environment analysis requires before-and-after source contents.");
    }
    const before = new Set<string>();
    const after = new Map<string, Set<string>>();
    for (const file of context.fileContents) {
      for (const name of collectNames(file.previousPath ?? file.path, file.before)) before.add(name);
      for (const name of collectNames(file.path, file.after)) {
        const paths = after.get(name) ?? new Set<string>();
        paths.add(file.path);
        after.set(name, paths);
      }
    }
    const findings: Finding[] = [];
    for (const name of [...after.keys()].sort()) {
      if (before.has(name)) continue;
      findings.push({
        detector: "environment",
        severity: "MEDIUM",
        title: `New environment variable detected: ${name}`,
        files: [...after.get(name)!].sort(),
        suggestedAction: `Configure ${name} in the deployment environment.`,
      });
    }
    return findings;
  },
};
