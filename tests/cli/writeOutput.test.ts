import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { writeOutput } from "../../src/cli/writeOutput.js";

describe("writeOutput", () => {
  it("waits for buffered output without ending the destination stream", async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        setImmediate(() => { chunks.push(String(chunk)); callback(); });
      },
    });
    const output = "report\n".repeat(10_000);
    await writeOutput(output, destination);
    expect(chunks.join("")).toBe(output);
    expect(destination.writableEnded).toBe(false);
    expect(destination.destroyed).toBe(false);
    destination.end();
  });

  it.each(["EPIPE", "ENOSPC", "EACCES"])("wraps %s errors without exposing system details", async (code) => {
    const cause = Object.assign(new Error("private-system-detail"), { code });
    const destination = new Writable({ write(_chunk, _encoding, callback) { setImmediate(() => callback(cause)); } });
    await expect(writeOutput("report\n", destination)).rejects.toMatchObject({
      code: "OUTPUT_WRITE_FAILED", cause, message: expect.not.stringContaining("private-system-detail"),
    });
  });
});
