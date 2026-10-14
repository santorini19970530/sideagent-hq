import type { Runtime } from "@sideagent/protocol";
import { PYTHON_TEST_FORMAT, pythonTrapPath } from "./python.ts";

// Runtime-specific details the platform agents need, keyed by runtime.

export const TEST_FORMAT: Record<Runtime, string> = { python: PYTHON_TEST_FORMAT };

export const TRAP_PATH: Record<Runtime, (name: string) => string> = { python: pythonTrapPath };
