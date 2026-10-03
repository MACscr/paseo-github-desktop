import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { FileStatus } from "./git";

export const openInEditorRpc = defineRpc({
  name: "files.open-in-editor",
  input: z.object({ cwd: z.string(), path: z.string(), line: z.number().int().positive().optional() }),
  output: z.object({ editor: z.string() }),
});

export const discardRpc = defineRpc({
  name: "files.discard",
  input: z.object({ cwd: z.string(), path: z.string(), origPath: z.string().nullable(), status: FileStatus }),
  /** Whether the discarded content went to the Trash; false only where no Trash command exists. */
  output: z.object({ discarded: z.literal(true), trashed: z.boolean() }),
});

export const capabilitiesRpc = defineRpc({
  name: "files.capabilities",
  input: z.object({}),
  /** `trash` is false on hosts with no Trash / Recycle Bin, where discarding deletes permanently. */
  output: z.object({ trash: z.boolean(), githubDesktop: z.boolean() }),
});

export const openInGithubDesktopRpc = defineRpc({
  name: "github-desktop.open",
  input: z.object({ cwd: z.string() }),
  output: z.object({ opened: z.literal(true) }),
});

/** Discarding these removes the file from disk rather than restoring a committed version. */
export function discardDeletesFile(status: FileStatus) {
  return status === "untracked" || status === "added" || status === "copied";
}

export function canDiscard(status: FileStatus) {
  return status !== "conflicted";
}
