import type { Detector, Finding } from "../core/types.js";

const rules = [
  {
    label: "Scheduled job file",
    pattern: /^(?:crontab(?:\.txt)?|cron\.d\/[A-Za-z0-9_-]+|cron\/.+\.(?:sh|[cm]?[jt]s|py|rb|php))$/s,
    action: "Review job schedules and verify the affected jobs in the deployment environment.",
  },
  {
    label: "Deployment configuration",
    pattern: /^vercel\.json$/,
    action: "Review deployment settings and any scheduled jobs configured in vercel.json.",
  },
  {
    label: "CI workflow",
    pattern: /^\.github\/workflows\/[^/]+\.ya?ml$/,
    action: "Review workflow triggers, permissions, and deployment steps.",
  },
  {
    label: "Container configuration",
    pattern: /^(?:Dockerfile(?:\.(?:dev|development|prod|production|staging|test))?|\.dockerignore|(?:docker-compose|compose)(?:\.(?:dev|development|prod|production|staging|test))?\.ya?ml)$/,
    action: "Rebuild the container and verify runtime configuration.",
  },
];

function matches(pattern: RegExp, path: string): boolean {
  return pattern.test(path) && !/\.(?:d|test|spec)\.(?:sh|[cm]?[jt]s|py|rb|php)$/.test(path)
    && !/(?:^|\/)__tests__(?:\/|$)/.test(path);
}

export const cronConfigDetector: Detector = {
  name: "cron-config",
  detect(context) {
    const findings: Finding[] = [];
    for (const file of context.files) {
      for (const rule of rules) {
        const currentMatches = matches(rule.pattern, file.path);
        const previousMatches = file.status === "renamed" && matches(rule.pattern, file.previousPath);
        if (!currentMatches && !previousMatches) continue;
        const status = file.status !== "renamed" ? file.status
          : currentMatches && previousMatches ? "renamed" : currentMatches ? "added" : "deleted";
        const finding: Finding = {
          detector: "cron-config",
          severity: "MEDIUM",
          title: `${rule.label} ${status}`,
          files: file.status === "renamed" ? [file.previousPath, file.path] : [file.path],
          suggestedAction: rule.action,
        };
        if (file.status === "renamed" && currentMatches !== previousMatches) {
          finding.description = currentMatches
            ? "Moved into a recognized configuration or job path."
            : "Moved out of a recognized configuration or job path.";
        }
        findings.push(finding);
      }
    }
    return findings;
  },
};
