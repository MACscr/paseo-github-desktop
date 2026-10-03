import { existsSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { canDiscard, discardDeletesFile, type discardRpc, type openInEditorRpc } from "../shared/actions";
import type { EditorChoice } from "../shared/settings";
import { launch, which } from "./process";
import { git } from "./run-git";
import { moveToTrash, type Trash } from "./trash";

export type { Trash } from "./trash";

interface KnownEditor {
  id: Exclude<EditorChoice, "auto" | "custom">;
  name: string;
  command: string;
  args: (file: string, line?: number) => string[];
}

// In "auto", the first of these found on the daemon's PATH wins; each takes the file and line differently.
const EDITORS: readonly KnownEditor[] = [
  { id: "code", name: "VS Code", command: "code", args: (file, line) => (line ? ["-g", `${file}:${line}`] : [file]) },
  { id: "cursor", name: "Cursor", command: "cursor", args: (file, line) => (line ? ["-g", `${file}:${line}`] : [file]) },
  { id: "zed", name: "Zed", command: "zed", args: (file, line) => [line ? `${file}:${line}` : file] },
  { id: "subl", name: "Sublime Text", command: "subl", args: (file, line) => [line ? `${file}:${line}` : file] },
];

export interface EditorPreference {
  editor: EditorChoice;
  customCommand: string;
  customArgs: string;
}

/** Splits an argument template like a shell would for quotes, without running a shell. */
export function splitArgs(template: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const char of template) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started || current) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
    }
  }
  if (quote) throw new Error("The editor arguments have an unclosed quote.");
  if (started || current) args.push(current);
  return args;
}

export function customEditorArgs(template: string, file: string, line?: number): string[] {
  const effective = template.trim() || "{file}";
  const args = splitArgs(effective).map((arg) =>
    arg.replaceAll("{file}", file).replaceAll("{line}", String(line ?? 1)),
  );
  return effective.includes("{file}") ? args : [...args, file];
}

export async function detectEditors(): Promise<Array<KnownEditor["id"]>> {
  const found = await Promise.all(EDITORS.map(async (editor) => ((await which(editor.command)) ? editor.id : null)));
  return found.filter((id): id is KnownEditor["id"] => id !== null);
}

async function repoRoot(cwd: string) {
  return (await git(["rev-parse", "--show-toplevel"], { cwd })).stdout.trim();
}

/** Resolves a repository-relative path, refusing anything that escapes the repository. */
function insideRepo(root: string, path: string): string {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Path is outside the repository: ${path}`);
  return absolute;
}

export async function openInEditor(
  { cwd, path, line }: RpcInput<typeof openInEditorRpc>,
  preference: EditorPreference,
): Promise<RpcOutput<typeof openInEditorRpc>> {
  const root = await repoRoot(cwd);
  const file = insideRepo(root, path);

  if (preference.editor === "custom") {
    const command = preference.customCommand.trim();
    if (!command) throw new Error("Set the custom editor command in Settings → Plugins → GitHub Desktop.");
    // A macOS .app bundle can only be handed the file; for line numbers, point at the bundle's CLI instead.
    if (command.replace(/\/+$/, "").endsWith(".app")) {
      await launch("/usr/bin/open", ["-a", command, file], root);
      return { editor: command };
    }
    const binary = await which(command);
    if (!binary) throw new Error(`Custom editor not found or not executable: ${command}`);
    await launch(binary, customEditorArgs(preference.customArgs, file, line), root);
    return { editor: command };
  }

  const candidates = preference.editor === "auto" ? EDITORS : EDITORS.filter((editor) => editor.id === preference.editor);
  for (const editor of candidates) {
    const binary = await which(editor.command);
    if (!binary) continue;
    await launch(binary, editor.args(file, line), root);
    return { editor: editor.name };
  }
  throw new Error(
    preference.editor === "auto"
      ? "No editor command found on the daemon's PATH (looked for code, cursor, zed, subl)."
      : `The \`${candidates[0]?.command}\` command is not on the daemon's PATH.`,
  );
}

/** Sends a file to the Trash, deleting it outright only where there is no Trash. */
async function removeFile(file: string, trash: Trash): Promise<boolean> {
  if (!existsSync(file)) return true;
  if (await trash(file)) return true;
  await rm(file, { recursive: true, force: true });
  return false;
}

/** Saves the working copy to the Trash under its own name before git overwrites it. */
async function trashCopy(file: string, trash: Trash): Promise<boolean> {
  if (!existsSync(file)) return true;
  const dir = await mkdtemp(join(tmpdir(), "paseo-discard-"));
  try {
    const copy = join(dir, basename(file));
    await cp(file, copy);
    return await trash(copy);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function discard(
  { cwd, path, origPath, status }: RpcInput<typeof discardRpc>,
  trash: Trash = moveToTrash,
): Promise<RpcOutput<typeof discardRpc>> {
  if (!canDiscard(status)) throw new Error("Resolve the conflict before discarding this file.");
  const root = await repoRoot(cwd);
  const file = insideRepo(root, path);
  if (discardDeletesFile(status)) {
    // Unstage first so a newly added file does not linger in the index after it leaves the disk.
    if (status !== "untracked") await git(["rm", "--cached", "--quiet", "--", path], { cwd: root });
    return { discarded: true, trashed: await removeFile(file, trash) };
  }
  if (origPath && origPath !== path) {
    // A rename: the new path holds the only copy of any edits, so it goes to the Trash before HEAD's original returns.
    insideRepo(root, origPath);
    await git(["rm", "--cached", "--quiet", "--ignore-unmatch", "--", path], { cwd: root });
    const trashed = await removeFile(file, trash);
    await git(["restore", "--source=HEAD", "--staged", "--worktree", "--", origPath], { cwd: root });
    return { discarded: true, trashed };
  }
  const trashed = status === "deleted" ? true : await trashCopy(file, trash);
  await git(["restore", "--source=HEAD", "--staged", "--worktree", "--", path], { cwd: root });
  return { discarded: true, trashed };
}
