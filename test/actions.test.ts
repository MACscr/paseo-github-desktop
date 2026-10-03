import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { customEditorArgs, discard as discardWith, splitArgs, type Trash } from "../server/actions";
import { clearCaches, getStatus } from "../server/repo";

let repo: string;
let trashDir: string;
/** Stands in for the macOS Trash so tests never touch the real one; records what was sent there. */
let trashed: Array<{ name: string; contents: string }>;
const fakeTrash: Trash = async (path) => {
  const name = basename(path);
  trashed.push({ name, contents: readFileSync(path, "utf8") });
  renameSync(path, join(trashDir, `${trashed.length}-${name}`));
  return true;
};
const discard = (input: Parameters<typeof discardWith>[0]) => discardWith(input, fakeTrash);

function run(...args: string[]) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Ada",
      GIT_AUTHOR_EMAIL: "ada@example.com",
      GIT_COMMITTER_NAME: "Ada",
      GIT_COMMITTER_EMAIL: "ada@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  }).trim();
}

async function changed() {
  clearCaches();
  const status = await getStatus({ cwd: repo });
  if (status.state !== "ok") throw new Error(status.state);
  return status.files.map((file) => `${file.status}:${file.path}`);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "gd-actions-"));
  trashDir = mkdtempSync(join(tmpdir(), "gd-trash-"));
  trashed = [];
  run("init", "-q", "-b", "main");
  writeFileSync(join(repo, "keep.txt"), "original\n");
  writeFileSync(join(repo, "gone.txt"), "still here\n");
  writeFileSync(join(repo, "old-name.txt"), "renamed content\n");
  run("add", "-A");
  run("commit", "-q", "-m", "initial");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(trashDir, { recursive: true, force: true });
});

describe("discard", () => {
  it("restores a modified file, including staged edits", async () => {
    writeFileSync(join(repo, "keep.txt"), "edited\n");
    run("add", "keep.txt");
    writeFileSync(join(repo, "keep.txt"), "edited again\n");
    expect(await discard({ cwd: repo, path: "keep.txt", origPath: null, status: "modified" })).toEqual({
      discarded: true,
      trashed: true,
    });
    expect(readFileSync(join(repo, "keep.txt"), "utf8")).toBe("original\n");
    expect(trashed).toEqual([{ name: "keep.txt", contents: "edited again\n" }]);
    expect(await changed()).toEqual([]);
  });

  it("brings back a deleted file", async () => {
    unlinkSync(join(repo, "gone.txt"));
    await discard({ cwd: repo, path: "gone.txt", origPath: null, status: "deleted" });
    expect(readFileSync(join(repo, "gone.txt"), "utf8")).toBe("still here\n");
    expect(trashed).toEqual([]);
    expect(await changed()).toEqual([]);
  });

  it("deletes an untracked file", async () => {
    writeFileSync(join(repo, "scratch.txt"), "temp\n");
    await discard({ cwd: repo, path: "scratch.txt", origPath: null, status: "untracked" });
    expect(existsSync(join(repo, "scratch.txt"))).toBe(false);
    expect(trashed).toEqual([{ name: "scratch.txt", contents: "temp\n" }]);
    expect(await changed()).toEqual([]);
  });

  it("unstages and deletes a newly added file", async () => {
    writeFileSync(join(repo, "new.txt"), "new\n");
    run("add", "new.txt");
    await discard({ cwd: repo, path: "new.txt", origPath: null, status: "added" });
    expect(existsSync(join(repo, "new.txt"))).toBe(false);
    expect(trashed).toEqual([{ name: "new.txt", contents: "new\n" }]);
    expect(await changed()).toEqual([]);
  });

  it("undoes a staged rename", async () => {
    run("mv", "old-name.txt", "new-name.txt");
    expect(await changed()).toEqual(["renamed:new-name.txt"]);
    await discard({ cwd: repo, path: "new-name.txt", origPath: "old-name.txt", status: "renamed" });
    expect(existsSync(join(repo, "new-name.txt"))).toBe(false);
    expect(readFileSync(join(repo, "old-name.txt"), "utf8")).toBe("renamed content\n");
    expect(trashed.map((item) => item.name)).toEqual(["new-name.txt"]);
    expect(await changed()).toEqual([]);
  });

  it("deletes outright, and says so, only where there is no Trash", async () => {
    writeFileSync(join(repo, "scratch.txt"), "temp\n");
    const result = await discardWith(
      { cwd: repo, path: "scratch.txt", origPath: null, status: "untracked" },
      async () => false,
    );
    expect(result).toEqual({ discarded: true, trashed: false });
    expect(existsSync(join(repo, "scratch.txt"))).toBe(false);
  });

  it("only touches the file it was asked to discard", async () => {
    writeFileSync(join(repo, "keep.txt"), "edited\n");
    writeFileSync(join(repo, "scratch.txt"), "temp\n");
    await discard({ cwd: repo, path: "scratch.txt", origPath: null, status: "untracked" });
    expect(await changed()).toEqual(["modified:keep.txt"]);
  });

  it("refuses paths outside the repository and conflicted files", async () => {
    await expect(discard({ cwd: repo, path: "../escape.txt", origPath: null, status: "untracked" })).rejects.toThrow(
      /outside the repository/,
    );
    await expect(discard({ cwd: repo, path: "keep.txt", origPath: null, status: "conflicted" })).rejects.toThrow(
      /conflict/,
    );
  });
});

describe("custom editor arguments", () => {
  it("fills {file} and {line}, keeping quoted arguments together", () => {
    expect(customEditorArgs('-g "{file}:{line}" --new-window', "/repo/a b.ts", 12)).toEqual([
      "-g",
      "/repo/a b.ts:12",
      "--new-window",
    ]);
  });

  it("uses line 1 when there is no line, and appends the file when the template omits it", () => {
    expect(customEditorArgs("{file}:{line}", "/repo/a.ts")).toEqual(["/repo/a.ts:1"]);
    expect(customEditorArgs("--wait", "/repo/a.ts", 3)).toEqual(["--wait", "/repo/a.ts"]);
    expect(customEditorArgs("", "/repo/a.ts")).toEqual(["/repo/a.ts"]);
  });

  it("rejects an unclosed quote instead of guessing", () => {
    expect(() => splitArgs('"{file}')).toThrow(/unclosed quote/);
  });
});
