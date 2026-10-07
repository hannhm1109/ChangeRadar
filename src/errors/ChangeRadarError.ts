export type ChangeRadarErrorCode =
  | "GIT_NOT_INSTALLED"
  | "NOT_A_REPOSITORY"
  | "NO_COMMITS"
  | "INVALID_REFERENCE"
  | "INVALID_COMPARISON"
  | "NO_MERGE_BASE"
  | "GIT_EXECUTION_FAILED"
  | "INVALID_GIT_OUTPUT"
  | "UNMERGED_CHANGES"
  | "SECRET_FILE_RENAME"
  | "FILE_READ_FAILED"
  | "OUTPUT_WRITE_FAILED"
  | "INVALID_SOURCE"
  | "INVALID_MANIFEST"
  | "DETECTOR_FAILED";

export class ChangeRadarError extends Error {
  constructor(
    public readonly code: ChangeRadarErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ChangeRadarError";
  }
}
