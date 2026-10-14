import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { CodeFile, LIMITS, type RunnerJobView } from "@sideagent/protocol";

/** The job spec, written into the workspace so it never has to be pasted into a prompt. */
export const SPEC_FILE = "SPEC.md";

// Tool caches and environments, not results.
const IGNORED_DIRS = new Set(["__pycache__", "node_modules", "venv", "build"]);

export interface Workspace {
  dir: string;
  /** New files written by the executor. Inputs (spec, public tests) are never part of the result. */
  collect(): Promise<CodeFile[]>;
  dispose(): Promise<void>;
}

/** Throwaway directory holding the spec and public tests. Job content is untrusted. */
export async function createWorkspace(job: RunnerJobView): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), "sideagent-job-"));
  const inputs = new Set<string>();

  try {
    if (job.public_tests.some((f) => f.path === SPEC_FILE)) {
      throw new Error(`A public test can't be named ${SPEC_FILE}`);
    }
    for (const file of [...job.public_tests, { path: SPEC_FILE, content: job.spec }]) {
      const path = resolveInside(dir, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content);
      inputs.add(toPosix(relative(dir, path)));
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }

  async function collect(): Promise<CodeFile[]> {
    const files: CodeFile[] = [];
    for (const path of await listFiles(dir)) {
      const rel = toPosix(relative(dir, path));
      if (inputs.has(rel)) continue;
      // Skip reading a huge log or binary. The limit counts characters; UTF-8 is at most 4 bytes each.
      if ((await stat(path)).size > LIMITS.maxFileBytes * 4) {
        throw new Error(`${rel} can't be submitted: larger than ${LIMITS.maxFileBytes} bytes`);
      }
      const parsed = CodeFile.safeParse({ path: rel, content: await readFile(path, "utf8") });
      if (!parsed.success) {
        throw new Error(`${rel} can't be submitted: ${parsed.error.issues[0]?.message}`);
      }
      files.push(parsed.data);
      if (files.length > LIMITS.maxFiles) {
        throw new Error(`The result has more than ${LIMITS.maxFiles} files`);
      }
    }
    return files;
  }

  return { dir, collect, dispose: () => rm(dir, { recursive: true, force: true }) };
}

export function resolveInside(dir: string, path: string): string {
  const resolved = resolve(dir, path);
  if (!resolved.startsWith(dir + sep)) throw new Error(`Path escapes the workspace: ${path}`);
  return resolved;
}

/** Regular files only: dotfiles, tool caches and symlinks are skipped. */
export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) out.push(...(await listFiles(path)));
    else if (entry.isFile()) out.push(path);
  }
  return out.sort();
}

export function toPosix(path: string): string {
  return path.split(sep).join("/");
}
