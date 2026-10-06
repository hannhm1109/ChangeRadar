export type { ChangeContext, ChangedFile, ChangeStatus, Detector, Finding, Severity } from "./core/types.js";
export { ChangeRadarError } from "./errors/ChangeRadarError.js";
export type { ChangeRadarErrorCode } from "./errors/ChangeRadarError.js";
export { getChanges } from "./git/gitAdapter.js";
export { runDetectors } from "./core/runDetectors.js";
export { migrationDetector } from "./detectors/migrationDetector.js";
export { formatTerminalReport } from "./reporters/terminalReporter.js";
