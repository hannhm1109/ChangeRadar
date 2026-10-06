export type ChangeRadarErrorCode =
  | "GIT_NOT_INSTALLED"
  | "NOT_A_REPOSITORY"
  | "NO_COMMITS"
  | "GIT_EXECUTION_FAILED"
  | "INVALID_GIT_OUTPUT"
  | "FILE_READ_FAILED"
  | "INVALID_SOURCE"
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
