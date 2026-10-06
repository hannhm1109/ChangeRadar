import type { Detector } from "../core/types.js";

export const migrationDetector: Detector = {
  name: "migration",
  detect(context) {
    return context.files
      .filter((file) => file.status === "added"
        && /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(file.path))
      .map((file) => ({
        detector: "migration",
        severity: "HIGH",
        title: "Database migration added",
        files: [file.path],
        suggestedAction: "Review and apply database migrations before deployment.",
      }));
  },
};
