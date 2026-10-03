import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, extname, join } from "node:path";

const WINDOWS = process.platform === "win32";

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, WINDOWS ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Finds a command on PATH; on Windows also tries PATHEXT endings such as `.exe` and `.cmd`. */
export async function which(command: string): Promise<string | null> {
  if (command.includes("/") || (WINDOWS && command.includes("\\"))) return (await executable(command)) ? command : null;
  const endings = WINDOWS && !extname(command) ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ending of endings) {
      const candidate = join(dir, command + ending.toLowerCase());
      if (await executable(candidate)) return candidate;
    }
  }
  return null;
}

/** Windows cannot spawn .cmd/.bat directly; run them through cmd.exe with each argument quoted. */
function invocation(binary: string, args: readonly string[]): { file: string; args: string[] } {
  if (!WINDOWS || !/\.(cmd|bat)$/i.test(binary)) return { file: binary, args: [...args] };
  const quote = (value: string) => `"${value.replace(/"/g, "")}"`;
  return { file: "cmd.exe", args: ["/d", "/s", "/c", `"${[binary, ...args].map(quote).join(" ")}"`] };
}

/** Starts a GUI program and returns once it is running, without waiting for it to exit. */
export function launch(binary: string, args: readonly string[], cwd: string): Promise<void> {
  const { file, args: argv } = invocation(binary, args);
  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, { cwd, detached: true, stdio: "ignore", windowsVerbatimArguments: file === "cmd.exe" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/** Runs a command to completion, rejecting with its stderr on a non-zero exit. */
export function run(binary: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<void> {
  const { file, args: argv } = invocation(binary, args);
  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, {
      stdio: ["ignore", "ignore", "pipe"],
      env: env ? { ...process.env, ...env } : process.env,
      windowsVerbatimArguments: file === "cmd.exe",
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `${binary} exited with code ${code}`)),
    );
  });
}
