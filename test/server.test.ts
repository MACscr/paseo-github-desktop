import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearCaches, getCommit, getFileDiff, getLog, getStatus, nameFromRemote } from "../server/repo";

let dir: string;
let repo: string;
let clock = 1_700_000_000;

function run(cwd: string, ...args: string[]) {
  const date = `${clock++} +0000`;
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
      GIT_AUTHOR_NAME: "Ada",
      GIT_AUTHOR_EMAIL: "ada@example.com",
      GIT_COMMITTER_NAME: "Ada",
      GIT_COMMITTER_EMAIL: "ada@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  }).trim();
}

function write(path: string, contents: string | Buffer) {
  mkdirSync(join(repo, path, ".."), { recursive: true });
  writeFileSync(join(repo, path), contents);
}

function commit(message: string) {
  run(repo, "add", "-A");
  run(repo, "commit", "-q", "-m", message);
  return run(repo, "rev-parse", "HEAD");
}

async function okStatus() {
  const status = await getStatus({ cwd: repo });
  if (status.state !== "ok") throw new Error(`unexpected ${status.state}`);
  return status;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "gd-test-"));
  const origin = join(dir, "origin.git");
  repo = join(dir, "work");
  run(dir, "init", "-q", "--bare", "-b", "main", origin);
  run(dir, "init", "-q", "-b", "main", repo);
  run(repo, "remote", "add", "origin", origin);

  write("a.txt", "one\ntwo\nthree\n");
  write("b.txt", "rename me\nplease\n");
  write("img.bin", Buffer.from([0, 1, 2, 3, 0, 255]));
  commit("initial");
  write("a.txt", "one\n2\nthree\nfour\n");
  commit("edit a");
  run(repo, "push", "-q", "-u", "origin", "main");

  run(repo, "checkout", "-q", "-b", "feature");
  run(repo, "mv", "b.txt", "c.txt");
  commit("rename b to c");
  run(repo, "push", "-q", "-u", "origin", "feature");
  write("dir/with space.txt", "spaced\n");
  commit("add spaced file");
  run(repo, "checkout", "-q", "main");
  write("main-only.txt", "x\n");
  commit("main side");
  run(repo, "checkout", "-q", "feature");
  run(repo, "merge", "-q", "--no-edit", "main");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("history", () => {
  it("pages commits and marks unpushed and not-on-base commits", async () => {
    const status = await okStatus();
    expect(status.repo.branch).toBe("feature");
    expect(status.repo.upstream).toBe("origin/feature");
    expect(status.repo.ahead).toBe(3);

    const headSha = status.repo.headSha!;
    const first = await getLog({ cwd: repo, headSha, skip: 0, limit: 3 });
    expect(first.base).toBe("origin/main");
    expect(first.hasMore).toBe(true);
    expect(first.commits.map((c) => c.subject)).toEqual([
      "Merge branch 'main' into feature",
      "main side",
      "add spaced file",
    ]);
    const bySubject = Object.fromEntries(first.commits.map((c) => [c.subject, c]));
    expect(bySubject["add spaced file"]).toMatchObject({ unpushed: true, notOnBase: true });
    expect(bySubject["main side"]).toMatchObject({ unpushed: true, notOnBase: true });

    const rest = await getLog({ cwd: repo, headSha, skip: 3, limit: 50 });
    expect(rest.hasMore).toBe(false);
    expect(rest.commits.map((c) => c.subject)).toEqual(["rename b to c", "edit a", "initial"]);
    expect(rest.commits[0]).toMatchObject({ unpushed: false, notOnBase: true });
    expect(rest.commits[1]).toMatchObject({ unpushed: false, notOnBase: false });
  });

  it("lists commit files with stats, renames, binaries, and merges against the first parent", async () => {
    const headSha = (await okStatus()).repo.headSha!;
    const { commits } = await getLog({ cwd: repo, headSha, skip: 0, limit: 50 });
    const sha = (subject: string) => commits.find((c) => c.subject === subject)!.sha;

    const root = await getCommit({ cwd: repo, sha: sha("initial") });
    expect(root.parents).toEqual([]);
    expect(root.files).toEqual([
      { path: "a.txt", origPath: null, status: "added", additions: 3, deletions: 0 },
      { path: "b.txt", origPath: null, status: "added", additions: 2, deletions: 0 },
      { path: "img.bin", origPath: null, status: "added", additions: null, deletions: null },
    ]);

    const renamed = await getCommit({ cwd: repo, sha: sha("rename b to c") });
    expect(renamed.files).toEqual([{ path: "c.txt", origPath: "b.txt", status: "renamed", additions: 0, deletions: 0 }]);

    const merge = await getCommit({ cwd: repo, sha: sha("Merge branch 'main' into feature") });
    expect(merge.parents).toHaveLength(2);
    expect(merge.files.map((f) => f.path)).toEqual(["main-only.txt"]);

    const spaced = await getCommit({ cwd: repo, sha: sha("add spaced file") });
    expect(spaced.files[0]?.path).toBe("dir/with space.txt");
  });

  it("diffs one file of a commit, including root, binary, and rename-only files", async () => {
    const headSha = (await okStatus()).repo.headSha!;
    const { commits } = await getLog({ cwd: repo, headSha, skip: 0, limit: 50 });
    const find = (subject: string) => commits.find((c) => c.subject === subject)!;

    const edit = find("edit a");
    const diff = await getFileDiff({
      cwd: repo,
      source: { kind: "commit", sha: edit.sha, parent: edit.parents[0]!, path: "a.txt", origPath: null },
    });
    expect(diff).toEqual({ kind: "text", patch: "@@ -1,3 +1,4 @@\n one\n-two\n+2\n three\n+four\n" });

    const initial = find("initial");
    const rootDiff = await getFileDiff({
      cwd: repo,
      source: { kind: "commit", sha: initial.sha, parent: null, path: "a.txt", origPath: null },
    });
    expect(rootDiff).toEqual({ kind: "text", patch: "@@ -0,0 +1,3 @@\n+one\n+two\n+three\n" });

    const binary = await getFileDiff({
      cwd: repo,
      source: { kind: "commit", sha: initial.sha, parent: null, path: "img.bin", origPath: null },
    });
    expect(binary).toEqual({ kind: "binary" });

    const rename = find("rename b to c");
    const renameDiff = await getFileDiff({
      cwd: repo,
      source: { kind: "commit", sha: rename.sha, parent: rename.parents[0]!, path: "c.txt", origPath: "b.txt" },
    });
    expect(renameDiff).toEqual({ kind: "empty" });
  });
});

describe("changes", () => {
  it("reports working tree changes and diffs them against HEAD", async () => {
    write("a.txt", "one\n2\nthree\nfour\nfive\n");
    write("new file.txt", "brand new\n");
    unlinkSync(join(repo, "main-only.txt"));
    run(repo, "mv", "c.txt", "d.txt");

    const status = await okStatus();
    expect(status.files.map(({ path, origPath, status: s }) => ({ path, origPath, status: s }))).toEqual([
      { path: "a.txt", origPath: null, status: "modified" },
      { path: "d.txt", origPath: "c.txt", status: "renamed" },
      { path: "main-only.txt", origPath: null, status: "deleted" },
      { path: "new file.txt", origPath: null, status: "untracked" },
    ]);

    const modified = await getFileDiff({
      cwd: repo,
      source: { kind: "worktree", path: "a.txt", origPath: null, status: "modified" },
    });
    expect(modified).toEqual({ kind: "text", patch: "@@ -2,3 +2,4 @@ one\n 2\n three\n four\n+five\n" });

    const untracked = await getFileDiff({
      cwd: repo,
      source: { kind: "worktree", path: "new file.txt", origPath: null, status: "untracked" },
    });
    expect(untracked).toEqual({ kind: "text", patch: "@@ -0,0 +1 @@\n+brand new\n" });

    const deleted = await getFileDiff({
      cwd: repo,
      source: { kind: "worktree", path: "main-only.txt", origPath: null, status: "deleted" },
    });
    expect(deleted).toEqual({ kind: "text", patch: "@@ -1 +0,0 @@\n-x\n" });

    const renamed = await getFileDiff({
      cwd: repo,
      source: { kind: "worktree", path: "d.txt", origPath: "c.txt", status: "renamed" },
    });
    expect(renamed).toEqual({ kind: "empty" });
  });

  it("changes a file's fingerprint only when that file changes", async () => {
    const before = await okStatus();
    await new Promise((resolve) => setTimeout(resolve, 20));
    write("a.txt", "edited again\n");
    const after = await okStatus();
    const print = (s: typeof before, path: string) => s.files.find((f) => f.path === path)!.fingerprint;
    expect(print(after, "a.txt")).not.toBe(print(before, "a.txt"));
    expect(print(after, "new file.txt")).toBe(print(before, "new file.txt"));
  });

  it("gates large diffs until requested in full", async () => {
    write("big.txt", Array.from({ length: 6000 }, (_, i) => `line ${i}`).join("\n") + "\n");
    const source = { kind: "worktree", path: "big.txt", origPath: null, status: "untracked" } as const;
    const gated = await getFileDiff({ cwd: repo, source });
    expect(gated.kind).toBe("too_large");
    const full = await getFileDiff({ cwd: repo, source, full: true });
    expect(full.kind).toBe("text");
    unlinkSync(join(repo, "big.txt"));
  });
});

describe("edge cases", () => {
  it("reports folders that are not repositories", async () => {
    const plain = join(dir, "plain");
    mkdirSync(plain);
    expect((await getStatus({ cwd: plain })).state).toBe("not_repo");
    expect((await getStatus({ cwd: join(dir, "missing") })).state).toBe("not_repo");
  });

  it("handles a repository with no commits", async () => {
    const empty = join(dir, "empty");
    run(dir, "init", "-q", "-b", "main", empty);
    writeFileSync(join(empty, "first.txt"), "hello\n");
    run(empty, "add", "first.txt");
    clearCaches();
    const status = await getStatus({ cwd: empty });
    expect(status).toMatchObject({ state: "ok", repo: { headSha: null, branch: "main" } });
    const diff = await getFileDiff({
      cwd: empty,
      source: { kind: "worktree", path: "first.txt", origPath: null, status: "added" },
    });
    expect(diff).toEqual({ kind: "text", patch: "@@ -0,0 +1 @@\n+hello\n" });
  });

  it("caps a huge working tree at 2000 files but reports the real total", async () => {
    const big = join(dir, "big");
    run(dir, "init", "-q", "-b", "main", big);
    mkdirSync(join(big, "build"));
    for (let i = 0; i < 2500; i++) writeFileSync(join(big, "build", `f${String(i).padStart(4, "0")}.txt`), "x\n");
    clearCaches();
    const status = await getStatus({ cwd: big });
    if (status.state !== "ok") throw new Error(`unexpected ${status.state}`);
    expect(status.totalFiles).toBe(2500);
    expect(status.files).toHaveLength(2000);
    expect(status.files[0]?.path).toBe("build/f0000.txt");
  });

  it("works from a subdirectory of the repository", async () => {
    const status = await getStatus({ cwd: join(repo, "dir") });
    expect(status.state).toBe("ok");
    if (status.state === "ok") expect(status.files.some((f) => f.path === "a.txt")).toBe(true);
  });
});


describe("repository name", () => {
  it("reads the name from common remote URL forms", () => {
    expect(nameFromRemote("git@github.com:acme/widgets.git")).toBe("widgets");
    expect(nameFromRemote("https://github.com/acme/widgets")).toBe("widgets");
    expect(nameFromRemote("https://gitlab.example.com/group/sub/widgets.git/\n")).toBe("widgets");
    expect(nameFromRemote("")).toBeNull();
  });

  it("names a worktree after its repository, not the worktree folder", async () => {
    const main = join(dir, "widgets");
    run(dir, "init", "-q", "-b", "main", main);
    writeFileSync(join(main, "a.txt"), "a\n");
    run(main, "add", "-A");
    run(main, "commit", "-q", "-m", "initial");
    const worktree = join(dir, "lazy-narwhal");
    run(main, "worktree", "add", "-q", "-b", "feature", worktree);
    clearCaches();
    const fromWorktree = await getStatus({ cwd: worktree });
    expect(fromWorktree).toMatchObject({ state: "ok", repo: { name: "widgets", root: expect.stringContaining("lazy-narwhal") } });

    run(main, "remote", "add", "origin", "git@github.com:acme/real-name.git");
    clearCaches();
    expect(await getStatus({ cwd: worktree })).toMatchObject({ state: "ok", repo: { name: "real-name" } });
  });
});
