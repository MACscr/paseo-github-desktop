import { stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { commitRpc, DiffSource, fileDiffRpc, logRpc, statusRpc } from "../shared/git";
import { Lru, memoAsync } from "./lru";
import { COMMIT_FORMAT, LOG_FORMAT, parseCommitHeader, parseLog, parseStatus, parseTreeChanges } from "./parse";
import { git, GitError } from "./run-git";

const MAX_DIFF_BYTES = 1024 * 1024;
const MAX_DIFF_LINES = 5000;
const MAX_FULL_DIFF_BYTES = 64 * 1024 * 1024;
const MARKER_LIMIT = 10_000;
// Status polls every 2s; an unignored build or vendor folder must not ship tens of thousands of rows each time.
const MAX_STATUS_FILES = 2000;
const BASE_CANDIDATES = [
  "refs/remotes/origin/HEAD",
  "refs/remotes/origin/main",
  "refs/remotes/origin/master",
  "refs/heads/main",
  "refs/heads/master",
];

const roots = new Lru<string, Promise<string>>(64);
const names = new Lru<string, Promise<string>>(64);
const emptyTrees = new Lru<string, Promise<string>>(64);
const commits = new Lru<string, Promise<RpcOutput<typeof commitRpc>>>(500);
const markers = new Lru<string, Promise<{ notOnBase: Set<string>; unpushed: Set<string> }>>(16);
const refs = new Lru<string, { at: number; value: Promise<Refs> }>(64);
type DiffResult = RpcOutput<typeof fileDiffRpc>;
const commitDiffs = new Lru<string, DiffResult>(1000, 96 * 1024 * 1024, (value) =>
  value.kind === "text" ? value.patch.length : 64,
);

export function clearCaches() {
  for (const cache of [roots, names, emptyTrees, commits, markers, refs, commitDiffs]) cache.clear();
}

function repoRoot(cwd: string): Promise<string> {
  return memoAsync(roots, cwd, async () => (await git(["rev-parse", "--show-toplevel"], { cwd })).stdout.trim());
}

/** The last path segment of a remote URL, e.g. `git@github.com:acme/widgets.git` → `widgets`. */
export function nameFromRemote(url: string): string | null {
  const segment = url.trim().replace(/\/+$/, "").split(/[/:]/).pop();
  const name = segment?.replace(/\.git$/, "");
  return name ? name : null;
}

/**
 * The repository's own name rather than the checkout folder's, which for a worktree is often a
 * generated name. Cached per root: remotes and worktree layout almost never change.
 */
function repoName(root: string): Promise<string> {
  return memoAsync(names, root, async () => {
    const remote = await git(["config", "--get", "remote.origin.url"], { cwd: root, okCodes: [0, 1] });
    const fromRemote = nameFromRemote(remote.stdout);
    if (fromRemote) return fromRemote;
    // A linked worktree shares the main checkout's .git directory; its parent folder is the repository.
    const common = (await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root })).stdout.trim();
    if (basename(common) === ".git") return basename(dirname(common));
    // A bare repository (`widgets.git`) with worktrees elsewhere.
    return basename(common).replace(/\.git$/, "") || basename(root);
  });
}

function emptyTree(root: string): Promise<string> {
  return memoAsync(emptyTrees, root, async () =>
    (await git(["hash-object", "-t", "tree", "/dev/null"], { cwd: root })).stdout.trim(),
  );
}

export async function getStatus({ cwd }: RpcInput<typeof statusRpc>): Promise<RpcOutput<typeof statusRpc>> {
  try {
    const info = await stat(cwd).catch(() => null);
    if (!info?.isDirectory()) return { state: "not_repo", message: `Folder not found: ${cwd}` };
    const root = await repoRoot(cwd);
    const { stdout } = await git(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], {
      cwd: root,
    });
    const parsed = parseStatus(stdout);
    const entries = [...parsed.entries]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .slice(0, MAX_STATUS_FILES);
    const files = await Promise.all(
      entries.map(async (entry) => {
        let disk = "-";
        if (entry.status !== "deleted") {
          const file = await stat(join(root, entry.path)).catch(() => null);
          if (file) disk = `${file.mtimeMs}:${file.size}`;
        }
        return {
          path: entry.path,
          origPath: entry.origPath,
          status: entry.status,
          fingerprint: `${entry.record}|${disk}`,
        };
      }),
    );
    return {
      state: "ok",
      repo: {
        root,
        name: await repoName(root),
        branch: parsed.branch,
        headSha: parsed.headSha,
        upstream: parsed.upstream,
        ahead: parsed.ahead,
        behind: parsed.behind,
      },
      files,
      totalFiles: parsed.entries.length,
    };
  } catch (error) {
    if (error instanceof GitError && error.code === "not_repo") {
      roots.delete(cwd);
      return { state: "not_repo", message: "This workspace folder is not a git repository." };
    }
    if (error instanceof GitError && error.code === "no_git") return { state: "no_git", message: error.message };
    throw error;
  }
}

interface Refs {
  base: { name: string; sha: string } | null;
  upstreamSha: string | null;
}

function shortRef(ref: string) {
  return ref.replace(/^refs\/remotes\//, "").replace(/^refs\/heads\//, "");
}

function resolveRefs(root: string): Promise<Refs> {
  const cached = refs.get(root);
  if (cached && Date.now() - cached.at < 3000) return cached.value;
  const value = (async (): Promise<Refs> => {
    const [forEach, upstream] = await Promise.all([
      git(["for-each-ref", "--format=%(refname)%09%(objectname)%09%(symref)", ...BASE_CANDIDATES], { cwd: root }),
      git(["rev-parse", "--verify", "-q", "@{upstream}"], { cwd: root, okCodes: [0, 1, 128] }),
    ]);
    const found = new Map<string, { sha: string; symref: string }>();
    for (const line of forEach.stdout.split("\n")) {
      const [name, sha, symref = ""] = line.split("\t");
      if (name && sha) found.set(name, { sha, symref });
    }
    let base: Refs["base"] = null;
    for (const candidate of BASE_CANDIDATES) {
      const hit = found.get(candidate);
      if (!hit) continue;
      base = { name: shortRef(hit.symref || candidate), sha: hit.sha };
      break;
    }
    return { base, upstreamSha: upstream.stdout.trim() || null };
  })();
  refs.set(root, { at: Date.now(), value });
  value.catch(() => refs.delete(root));
  return value;
}

async function revSet(root: string, head: string, exclude: string | null): Promise<Set<string>> {
  if (!exclude) return new Set();
  const { stdout } = await git(["rev-list", `--max-count=${MARKER_LIMIT}`, head, `^${exclude}`], { cwd: root });
  return new Set(stdout.split("\n").filter(Boolean));
}

export async function getLog({ cwd, headSha, skip, limit }: RpcInput<typeof logRpc>): Promise<RpcOutput<typeof logRpc>> {
  const root = await repoRoot(cwd);
  const [logOutput, refInfo] = await Promise.all([
    git(["log", `--format=${LOG_FORMAT}`, `--skip=${skip}`, `-n`, String(limit + 1), headSha, "--"], { cwd: root }),
    resolveRefs(root),
  ]);
  const key = `${root}|${headSha}|${refInfo.base?.sha ?? ""}|${refInfo.upstreamSha ?? ""}`;
  const marks = await memoAsync(markers, key, async () => {
    const [notOnBase, unpushed] = await Promise.all([
      revSet(root, headSha, refInfo.base?.sha ?? null),
      revSet(root, headSha, refInfo.upstreamSha),
    ]);
    return { notOnBase, unpushed };
  });
  const entries = parseLog(logOutput.stdout);
  return {
    commits: entries.slice(0, limit).map((entry) => ({
      ...entry,
      notOnBase: marks.notOnBase.has(entry.sha),
      unpushed: marks.unpushed.has(entry.sha),
    })),
    hasMore: entries.length > limit,
    base: refInfo.base?.name ?? null,
  };
}

export async function getCommit({ cwd, sha }: RpcInput<typeof commitRpc>): Promise<RpcOutput<typeof commitRpc>> {
  const root = await repoRoot(cwd);
  return memoAsync(commits, `${root}|${sha}`, async () => {
    const [show, tree] = await Promise.all([
      git(["show", "-s", `--format=${COMMIT_FORMAT}`, sha, "--"], { cwd: root }),
      git(
        ["diff-tree", "-r", "-z", "-M", "--raw", "--numstat", "--no-commit-id", "--root", "--diff-merges=first-parent", sha],
        { cwd: root },
      ),
    ]);
    return { ...parseCommitHeader(show.stdout), files: parseTreeChanges(tree.stdout) };
  });
}

function toDiffResult(stdout: string, truncated: boolean, bytes: number, full: boolean): DiffResult {
  if (truncated) return { kind: "too_large", bytes };
  const hunkStart = stdout.startsWith("@@") ? 0 : stdout.indexOf("\n@@");
  const header = hunkStart === -1 ? stdout : stdout.slice(0, hunkStart);
  if (/^Binary files .* differ$/m.test(header) || header.includes("GIT binary patch")) return { kind: "binary" };
  if (hunkStart === -1) return { kind: "empty" };
  const patch = stdout.slice(hunkStart === 0 ? 0 : hunkStart + 1);
  if (!full) {
    let lines = 0;
    for (let i = patch.indexOf("\n"); i !== -1; i = patch.indexOf("\n", i + 1)) {
      if (++lines > MAX_DIFF_LINES) return { kind: "too_large", bytes: patch.length };
    }
  }
  return { kind: "text", patch };
}

const DIFF_ARGS = ["diff", "--no-color", "--no-ext-diff", "-M", "-U3"];

function pathspec(source: { path: string; origPath: string | null }) {
  return source.origPath && source.origPath !== source.path ? [source.path, source.origPath] : [source.path];
}

async function diffWorktree(root: string, source: Extract<DiffSource, { kind: "worktree" }>, maxBytes: number) {
  if (source.status === "untracked") {
    return git([...DIFF_ARGS, "--no-index", "--", "/dev/null", source.path], { cwd: root, maxBytes, okCodes: [0, 1] });
  }
  try {
    return await git([...DIFF_ARGS, "HEAD", "--", ...pathspec(source)], { cwd: root, maxBytes });
  } catch (error) {
    if (!(error instanceof GitError) || !/bad revision|unknown revision|ambiguous argument 'HEAD'/i.test(error.message)) {
      throw error;
    }
    return git([...DIFF_ARGS, await emptyTree(root), "--", ...pathspec(source)], { cwd: root, maxBytes });
  }
}

export async function getFileDiff({ cwd, source, full = false }: RpcInput<typeof fileDiffRpc>): Promise<DiffResult> {
  const root = await repoRoot(cwd);
  const maxBytes = full ? MAX_FULL_DIFF_BYTES : MAX_DIFF_BYTES;
  if (source.kind === "worktree") {
    const { stdout, truncated, bytes } = await diffWorktree(root, source, maxBytes);
    return toDiffResult(stdout, truncated, bytes, full);
  }
  const key = `${root}|${source.sha}|${source.parent ?? ""}|${source.origPath ?? ""}|${source.path}|${full}`;
  const hit = commitDiffs.get(key);
  if (hit) return hit;
  const base = source.parent ?? (await emptyTree(root));
  const { stdout, truncated, bytes } = await git([...DIFF_ARGS, base, source.sha, "--", ...pathspec(source)], {
    cwd: root,
    maxBytes,
  });
  const result = toDiffResult(stdout, truncated, bytes, full);
  commitDiffs.set(key, result);
  return result;
}
