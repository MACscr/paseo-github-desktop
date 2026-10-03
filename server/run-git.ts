import { spawn } from "node:child_process";

const MAX_CONCURRENT = 4;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  // Never take index.lock for opportunistic refreshes, so polling cannot block agents' git commands.
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_PAGER: "cat",
  LC_ALL: "C",
};

const GLOBAL_ARGS = ["-c", "core.quotepath=off", "-c", "color.ui=false", "-c", "diff.noprefix=false"];

export class GitError extends Error {
  constructor(
    message: string,
    readonly code: "not_repo" | "no_git" | "timeout" | "failed",
    readonly stderr = "",
  ) {
    super(message);
  }
}

export interface RunOptions {
  cwd: string;
  timeoutMs?: number;
  /** Stop reading and kill git once stdout exceeds this many bytes. */
  maxBytes?: number;
  /** Exit codes treated as success (git diff --no-index exits 1 when files differ). */
  okCodes?: readonly number[];
}

export interface RunResult {
  stdout: string;
  truncated: boolean;
  bytes: number;
}

// Newest-first: when the user moves through commits quickly, the latest selection runs next.
let running = 0;
const waiting: Array<() => void> = [];

function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.pop();
  if (next) next();
  else running--;
}

export async function git(args: readonly string[], options: RunOptions): Promise<RunResult> {
  await acquire();
  try {
    return await spawnGit(args, options);
  } finally {
    release();
  }
}

function spawnGit(args: readonly string[], options: RunOptions): Promise<RunResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const okCodes = options.okCodes ?? [0];
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...GLOBAL_ARGS, ...args], {
      cwd: options.cwd,
      env: GIT_ENV,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      finish(() => reject(new GitError(`git ${args[0]} timed out`, "timeout")));
      child.kill("SIGKILL");
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    function finish(action: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    }

    child.stdout.on("data", (chunk: Buffer) => {
      if (truncated) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        truncated = true;
        child.kill("SIGKILL");
        finish(() => resolve({ stdout: "", truncated: true, bytes }));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 8192) stderr += chunk.toString("utf8");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          error.code === "ENOENT"
            ? new GitError("git is not installed or not on the daemon's PATH", "no_git")
            : new GitError(error.message, "failed"),
        ),
      );
    });
    child.on("close", (code) => {
      finish(() => {
        if (code !== null && okCodes.includes(code)) {
          resolve({ stdout: Buffer.concat(chunks).toString("utf8"), truncated: false, bytes });
          return;
        }
        const message = stderr.trim() || `git ${args[0]} exited with code ${code}`;
        reject(new GitError(message, /not a git repository/i.test(message) ? "not_repo" : "failed", stderr));
      });
    });
  });
}
