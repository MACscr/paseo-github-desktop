import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { launch, which } from "./process";
import { git } from "./run-git";

const MAC_APPS = ["/Applications/GitHub Desktop.app", join(homedir(), "Applications", "GitHub Desktop.app")];

type Launcher = { binary: string; args: (root: string) => string[] };

/** How to open a repository in GitHub Desktop on this host, or null when it is not installed. */
async function findLauncher(): Promise<Launcher | null> {
  if (process.platform === "darwin") {
    // The `github` CLI is optional (Desktop's menu installs it); the app bundle alone is enough.
    const cli = await which("github");
    if (cli) return { binary: cli, args: (root) => [root] };
    const app = MAC_APPS.find((path) => existsSync(path));
    return app ? { binary: "/usr/bin/open", args: (root) => ["-a", app, root] } : null;
  }
  if (process.platform === "win32") {
    const cli = await which("github");
    return cli ? { binary: cli, args: (root) => [root] } : null;
  }
  // GitHub ships no Linux build; the community fork installs `github-desktop`.
  const cli = await which("github-desktop");
  return cli ? { binary: cli, args: (root) => [root] } : null;
}

export async function githubDesktopAvailable(): Promise<boolean> {
  return (await findLauncher()) !== null;
}

export async function openInGithubDesktop({ cwd }: { cwd: string }): Promise<{ opened: true }> {
  const launcher = await findLauncher();
  if (!launcher) throw new Error("GitHub Desktop is not installed on this host.");
  const root = (await git(["rev-parse", "--show-toplevel"], { cwd })).stdout.trim();
  await launch(launcher.binary, launcher.args(root), root);
  return { opened: true };
}
