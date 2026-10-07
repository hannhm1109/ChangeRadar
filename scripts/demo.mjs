import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "changeradar-demo-"));
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const before = {
  ".env.example": "EXISTING_API_URL=https://example.invalid\n",
  "src/config.ts": "export const config = { url: process.env.EXISTING_API_URL };\n",
  "package.json": '{"private":true,"dependencies":{"zod":"3"}}\n',
  "app/api/orders/route.ts": "export function GET() { return Response.json({ orders: [] }); }\n",
  "crontab": "0 * * * * run-cleanup\n",
};
const after = {
  ...before,
  ".env.example": before[".env.example"] + "PAYMENT_API_KEY=placeholder\n",
  "src/config.ts": "export const config = { url: process.env.EXISTING_API_URL, key: process.env.PAYMENT_API_KEY };\n",
  "package.json": '{"private":true,"dependencies":{"zod":"3","stripe":"1"}}\n',
  "app/api/orders/route.ts": "export function GET() { return Response.json({ orders: [], version: 2 }); }\n",
  "crontab": "*/15 * * * * run-cleanup\n",
  "prisma/migrations/20261007_orders/migration.sql": "CREATE TABLE orders (id INT PRIMARY KEY);\n",
};

function git(...args) {
  execFileSync("git", args, { cwd: directory, stdio: "pipe", windowsHide: true });
}

function commit(files, message) {
  for (const [path, contents] of Object.entries(files)) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  git("add", ".");
  git("commit", "--quiet", "-m", message);
}

try {
  accessSync(cli);
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.name", "ChangeRadar Demo");
  git("config", "user.email", "demo@example.com");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  git("config", "core.hooksPath", ".git/changeradar-no-hooks");
  commit(before, "Demo baseline");
  commit(after, "Demo deployment impacts");
  const result = spawnSync(process.execPath, [cli, "analyze", "HEAD~1..HEAD", ...process.argv.slice(2)], {
    cwd: directory, stdio: "inherit", windowsHide: true,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 2;
} catch {
  process.stderr.write("ChangeRadar demo failed. Run npm run build first and ensure Git is on your PATH.\n");
  process.exitCode = 2;
} finally {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("changeradar-demo-")) {
    throw new Error("Refusing to clean up an unexpected demo directory");
  }
  rmSync(target, { recursive: true, force: true });
}
