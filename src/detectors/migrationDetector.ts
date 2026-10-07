import type { Detector, Finding } from "../core/types.js";

function isMigration(path: string): boolean {
  if (/^prisma\/migrations\/[^/]+\/migration\.sql$/.test(path)) return true;
  return /^(?:database\/)?migrations\/.+\.(?:sql|[cm]?[jt]s|py|rb|php)$/s.test(path)
    && !/\.(?:d|test|spec)\.(?:sql|[cm]?[jt]s|py|rb|php)$/.test(path);
}

export const migrationDetector: Detector = {
  name: "migration",
  detect(context) {
    const findings: Finding[] = [];
    for (const file of context.files) {
      const currentIsMigration = isMigration(file.path);
      const previousIsMigration = file.status === "renamed" && isMigration(file.previousPath);
      if (!currentIsMigration && !previousIsMigration) continue;
      const finding: Finding = {
        detector: "migration",
        severity: "HIGH",
        title: `Database migration ${file.status}`,
        files: file.status === "renamed" ? [file.previousPath, file.path] : [file.path],
        suggestedAction: file.status === "added"
          ? "Review and apply database migrations before deployment."
          : "Review migration history and compatibility with deployed databases before deployment.",
      };
      if (file.status === "renamed" && currentIsMigration !== previousIsMigration) {
        finding.description = currentIsMigration
          ? "Moved into a migration directory."
          : "Moved out of a migration directory.";
      }
      findings.push(finding);
    }
    return findings;
  },
};
