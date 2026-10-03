import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const FileStatus = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "typechange",
  "untracked",
  "conflicted",
]);
export type FileStatus = z.infer<typeof FileStatus>;

const WorkingFile = z.object({
  path: z.string(),
  origPath: z.string().nullable(),
  status: FileStatus,
  /** Changes whenever the file's index entry or on-disk content changes. */
  fingerprint: z.string(),
});
export type WorkingFile = z.infer<typeof WorkingFile>;

const RepoInfo = z.object({
  root: z.string(),
  /** Null when HEAD is detached. */
  branch: z.string().nullable(),
  /** Null when the branch has no commits yet. */
  headSha: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
});
export type RepoInfo = z.infer<typeof RepoInfo>;

export const statusRpc = defineRpc({
  name: "git.status",
  input: z.object({ cwd: z.string() }),
  output: z.discriminatedUnion("state", [
    z.object({
      state: z.literal("ok"),
      repo: RepoInfo,
      files: z.array(WorkingFile),
      /** Changed files before the list was capped; equals files.length when nothing was dropped. */
      totalFiles: z.number(),
    }),
    z.object({ state: z.literal("not_repo"), message: z.string() }),
    z.object({ state: z.literal("no_git"), message: z.string() }),
  ]),
});
export type StatusResult = z.infer<typeof statusRpc.output>;

const CommitSummary = z.object({
  sha: z.string(),
  parents: z.array(z.string()),
  authorName: z.string(),
  authorEmail: z.string(),
  /** Unix seconds. */
  date: z.number(),
  subject: z.string(),
  unpushed: z.boolean(),
  notOnBase: z.boolean(),
});
export type CommitSummary = z.infer<typeof CommitSummary>;

export const logRpc = defineRpc({
  name: "git.log",
  input: z.object({
    cwd: z.string(),
    /** Ties the page to one HEAD so pages never mix histories. */
    headSha: z.string(),
    skip: z.number().int().min(0),
    limit: z.number().int().min(1).max(500),
  }),
  output: z.object({
    commits: z.array(CommitSummary),
    hasMore: z.boolean(),
    base: z.string().nullable(),
  }),
});
export type LogResult = z.infer<typeof logRpc.output>;

const CommitFile = z.object({
  path: z.string(),
  origPath: z.string().nullable(),
  status: FileStatus,
  /** Null for binary files. */
  additions: z.number().nullable(),
  deletions: z.number().nullable(),
});
export type CommitFile = z.infer<typeof CommitFile>;

export const commitRpc = defineRpc({
  name: "git.commit",
  input: z.object({ cwd: z.string(), sha: z.string() }),
  output: z.object({
    sha: z.string(),
    parents: z.array(z.string()),
    authorName: z.string(),
    authorEmail: z.string(),
    date: z.number(),
    subject: z.string(),
    body: z.string(),
    files: z.array(CommitFile),
  }),
});
export type CommitDetail = z.infer<typeof commitRpc.output>;

export const DiffSource = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("commit"),
    sha: z.string(),
    /** First parent, or null for a root commit. */
    parent: z.string().nullable(),
    path: z.string(),
    origPath: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("worktree"),
    path: z.string(),
    origPath: z.string().nullable(),
    status: FileStatus,
  }),
]);
export type DiffSource = z.infer<typeof DiffSource>;

export const fileDiffRpc = defineRpc({
  name: "git.file-diff",
  input: z.object({ cwd: z.string(), source: DiffSource, full: z.boolean().optional() }),
  output: z.discriminatedUnion("kind", [
    /** Raw unified diff starting at the first hunk header; parsed on the client. */
    z.object({ kind: z.literal("text"), patch: z.string() }),
    z.object({ kind: z.literal("binary") }),
    z.object({ kind: z.literal("empty") }),
    z.object({ kind: z.literal("too_large"), bytes: z.number() }),
  ]),
});
export type FileDiffResult = z.infer<typeof fileDiffRpc.output>;
