import { run, which } from "./process";

/** Moves a path to the user's Trash / Recycle Bin. Returns false when this host has no way to do that. */
export type Trash = (path: string) => Promise<boolean>;

interface Trasher {
  name: string;
  command: string;
  args: (path: string) => string[];
  /** Extra environment; Windows passes the path this way so PowerShell never parses it. */
  env?: (path: string) => NodeJS.ProcessEnv;
}

const RECYCLE_BIN_SCRIPT =
  "Add-Type -AssemblyName Microsoft.VisualBasic; " +
  "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:PASEO_TRASH_PATH, 'OnlyErrorDialogs', 'SendToRecycleBin')";

export const TRASHERS: Readonly<Record<string, readonly Trasher[]>> = {
  darwin: [{ name: "macOS Trash", command: "/usr/bin/trash", args: (path) => [path] }],
  // GLib's gio covers most desktops; trash-cli and KDE's client cover the rest.
  linux: [
    { name: "gio", command: "gio", args: (path) => ["trash", "--", path] },
    { name: "trash-cli", command: "trash-put", args: (path) => ["--", path] },
    { name: "KDE", command: "kioclient6", args: (path) => ["move", path, "trash:/"] },
    { name: "KDE", command: "kioclient5", args: (path) => ["move", path, "trash:/"] },
  ],
  win32: [
    {
      name: "Recycle Bin",
      command: "powershell",
      args: () => ["-NoProfile", "-NonInteractive", "-Command", RECYCLE_BIN_SCRIPT],
      env: (path) => ({ PASEO_TRASH_PATH: path }),
    },
  ],
};

let found: Promise<{ trasher: Trasher; binary: string } | null> | null = null;

/** The first Trash mechanism available on this host, looked up once. */
export function findTrasher(platform: string = process.platform) {
  const lookup = async () => {
    for (const trasher of TRASHERS[platform] ?? []) {
      const binary = await which(trasher.command);
      if (binary) return { trasher, binary };
    }
    return null;
  };
  if (platform !== process.platform) return lookup();
  found ??= lookup();
  return found;
}

export async function trashAvailable(): Promise<boolean> {
  return (await findTrasher()) !== null;
}

export const moveToTrash: Trash = async (path) => {
  const match = await findTrasher();
  if (!match) return false;
  await run(match.binary, match.trasher.args(path), match.trasher.env?.(path));
  return true;
};
