import type { Writable } from "node:stream";
import { ChangeRadarError } from "../errors/ChangeRadarError.js";

export async function writeOutput(output: string, destination: Writable = process.stdout): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (cause: Error) => reject(cause);
      destination.once("error", onError);
      try {
        destination.write(output, (cause) => {
          if (cause) {
            // Writable emits its error after this callback; keep the one-shot listener to consume it.
            reject(cause);
            return;
          }
          destination.removeListener("error", onError);
          resolve();
        });
      } catch (cause) {
        destination.removeListener("error", onError);
        reject(cause);
      }
    });
  } catch (cause) {
    throw new ChangeRadarError("OUTPUT_WRITE_FAILED",
      "Unable to write the report. Check the output pipe, file permissions, and available disk space.", { cause });
  }
}
