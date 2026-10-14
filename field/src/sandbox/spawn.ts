import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

/** Cap on pytest; run_checks.py enforces it. */
export const TEST_TIMEOUT_SECONDS = 60;
const STDERR_TAIL = 2000;
// run_checks.py caps pytest's output at 64 KB, but test code can write to stdout directly.
export const STDOUT_TAIL = 128 * 1024;

export interface CappedExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** The tails of the output, capped. */
  stdout: string;
  stderr: string;
}

export interface CappedRunOptions {
  /** Named in the error when the process can't start. */
  what: string;
  timeoutMs: number;
  signal: AbortSignal;
  /** Stops the run; called once, at the timeout or on abort. */
  kill: () => void;
}

/**
 * Collects a test run's output tails and stops it at the timeout or when `signal` aborts. A
 * stopped run rejects with the reason; otherwise it resolves with how the process exited.
 */
export function runCapped(
  child: ChildProcessByStdio<null, Readable, Readable>,
  { what, timeoutMs, signal, kill }: CappedRunOptions,
): Promise<CappedExit> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-STDOUT_TAIL);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    let stopReason: string | null = null;
    const stop = (reason: string) => {
      if (stopReason) return;
      stopReason = reason;
      kill();
    };
    const timer = setTimeout(
      () => stop(`Public tests exceeded ${timeoutMs / 1000} seconds`),
      timeoutMs,
    );
    const onAbort = () => stop("Stopped by the runner");
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    child.on("error", (err) => {
      cleanup();
      reject(new Error(`Could not start ${what}: ${err.message}`));
    });
    child.on("close", (code, sig) => {
      cleanup();
      if (stopReason) reject(new Error(stopReason));
      else resolve({ code, signal: sig, stdout, stderr });
    });
  });
}
