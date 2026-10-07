import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check with npm run check:package");
const directory = mkdtempSync(join(tmpdir(), "changeradar-package-"));

function npm(args, cwd) {
  return execFileSync(process.execPath, [npmCli, ...args], {
    cwd, encoding: "utf8", windowsHide: true, timeout: 120_000,
  });
}

function cli(args, cwd) {
  const result = spawnSync(process.execPath, [join(directory, "install/node_modules/changeradar/dist/cli.js"), ...args], {
    cwd, encoding: "utf8", windowsHide: true, timeout: 30_000,
  });
  if (result.error) throw result.error;
  return result;
}

try {
  const [packed] = JSON.parse(npm(["pack", "--json", "--pack-destination", directory], root));
  assert.equal(packed.name, "changeradar");
  assert.equal(packed.version, manifest.version);
  const paths = packed.files.map((file) => file.path);
  const required = ["package.json", "README.md", "CHANGELOG.md", "docs/demo.png", "scripts/demo.mjs", "dist/cli.js", "dist/index.js", "dist/index.d.ts"];
  for (const path of required) assert.ok(paths.includes(path), `Missing package file: ${path}`);
  for (const path of paths) {
    assert.ok(required.includes(path) || path === "LICENSE" || /^dist\/.+\.(?:js|js\.map|d\.ts)$/.test(path), `Unexpected package file: ${path}`);
  }
  assert.equal(basename(packed.filename), packed.filename);
  const install = join(directory, "install");
  mkdirSync(install);
  writeFileSync(join(install, "package.json"), '{"name":"changeradar-install-check","private":true}\n');
  npm(["install", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--package-lock=false", join(directory, packed.filename)], install);
  const version = cli(["--version"], install);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), manifest.version);
  assert.equal(cli(["--help"], install).status, 0);
  assert.equal(npm(["exec", "--offline", "--", "changeradar", "--version"], install).trim(), manifest.version);
  const library = await import(pathToFileURL(join(install, "node_modules/changeradar/dist/index.js")).href);
  assert.equal(typeof library.getChanges, "function");
  assert.equal(typeof library.formatJsonReport, "function");
  const demo = spawnSync(process.execPath, [join(install, "node_modules/changeradar/scripts/demo.mjs"), "--format", "json"], {
    cwd: install, encoding: "utf8", windowsHide: true, timeout: 30_000,
  });
  if (demo.error) throw demo.error;
  assert.equal(demo.status, 1, demo.stderr);
  const report = JSON.parse(demo.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.summary.changedFileCount, 6);
  assert.equal(report.summary.findingCount, 5);
  assert.equal(new Set(report.findings.map((finding) => finding.detector)).size, 5);
  assert.deepEqual(report.summary.bySeverity, { HIGH: 1, MEDIUM: 3, LOW: 1 });
  assert.equal(report.summary.exitCode, 1);
  const error = cli(["analyze", "--format", "json"], install);
  assert.equal(error.status, 2);
  assert.equal(error.stdout, "");
  assert.ok(error.stderr.includes("Not a Git repository"));
  console.log(`Package check passed: ${packed.filename}; ${paths.length} files; installed CLI, bin, library, demo, and error behavior verified.`);
} finally {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("changeradar-package-")) {
    throw new Error("Refusing to clean up an unexpected package-check directory");
  }
  rmSync(target, { recursive: true, force: true });
}
