import type { CommitFile, FileStatus } from "../shared/git";

export interface ParsedStatusEntry {
  path: string;
  origPath: string | null;
  status: FileStatus;
  /** The porcelain record itself; it changes whenever the index entry changes. */
  record: string;
}

export interface ParsedStatus {
  headSha: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  entries: ParsedStatusEntry[];
}

/** Splits `count` space-separated fields off the front, returning the remainder (a path) intact. */
function splitFields(record: string, count: number): [string[], string] {
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const end = record.indexOf(" ", start);
    if (end === -1) return [fields, ""];
    fields.push(record.slice(start, end));
    start = end + 1;
  }
  return [fields, record.slice(start)];
}

function statusFromXY(xy: string): FileStatus {
  const x = xy[0];
  const y = xy[1];
  if (x === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  if (x === "T" || y === "T") return "typechange";
  return "modified";
}

/** Parses `git status --porcelain=v2 --branch -z`. */
export function parseStatus(output: string): ParsedStatus {
  const result: ParsedStatus = {
    headSha: null,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    entries: [],
  };
  const records = output.split("\0");
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record === "") continue;
    const kind = record[0];
    if (kind === "#") {
      const [[, key], value] = splitFields(record, 2);
      if (key === "branch.oid") result.headSha = value === "(initial)" ? null : value;
      else if (key === "branch.head") result.branch = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") result.upstream = value;
      else if (key === "branch.ab") {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) {
          result.ahead = Number(match[1]);
          result.behind = Number(match[2]);
        }
      }
      continue;
    }
    if (kind === "1") {
      const [fields, path] = splitFields(record, 8);
      result.entries.push({ path, origPath: null, status: statusFromXY(fields[1] ?? ".."), record });
    } else if (kind === "2") {
      const [fields, path] = splitFields(record, 9);
      const origPath = records[++i] ?? null;
      const score = fields[8] ?? "R";
      result.entries.push({
        path,
        origPath,
        status: score.startsWith("C") ? "copied" : "renamed",
        record: `${record}\0${origPath}`,
      });
    } else if (kind === "u") {
      const [, path] = splitFields(record, 10);
      result.entries.push({ path, origPath: null, status: "conflicted", record });
    } else if (kind === "?") {
      result.entries.push({ path: record.slice(2), origPath: null, status: "untracked", record });
    }
  }
  return result;
}

export const LOG_FORMAT = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1e";

export interface ParsedLogEntry {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  date: number;
  subject: string;
}

/** Parses `git log --format=LOG_FORMAT`. */
export function parseLog(output: string): ParsedLogEntry[] {
  const commits: ParsedLogEntry[] = [];
  for (const raw of output.split("\x1e")) {
    const record = raw.replace(/^\n+/, "");
    if (record === "") continue;
    const [sha = "", parents = "", authorName = "", authorEmail = "", date = "0", subject = ""] =
      record.split("\x1f");
    commits.push({
      sha,
      parents: parents === "" ? [] : parents.split(" "),
      authorName,
      authorEmail,
      date: Number(date),
      subject,
    });
  }
  return commits;
}

export const COMMIT_FORMAT = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b";

export function parseCommitHeader(output: string): ParsedLogEntry & { body: string } {
  const [sha = "", parents = "", authorName = "", authorEmail = "", date = "0", subject = "", body = ""] =
    output.split("\x1f");
  return {
    sha: sha.trim(),
    parents: parents === "" ? [] : parents.split(" "),
    authorName,
    authorEmail,
    date: Number(date),
    subject,
    body: body.trim(),
  };
}

const RAW_STATUS: Record<string, FileStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "typechange",
  U: "conflicted",
};

/** Parses `git diff-tree -r -z -M --raw --numstat`: all raw records, then numstat records in the same order. */
export function parseTreeChanges(output: string): CommitFile[] {
  const tokens = output.split("\0");
  const files: CommitFile[] = [];
  let i = 0;
  // diff-tree prints the commit id first when given a single commit without --no-commit-id.
  while (i < tokens.length && tokens[i] !== "" && !tokens[i]!.startsWith(":") && !tokens[i]!.includes("\t")) i++;
  while (i < tokens.length && tokens[i]!.startsWith(":")) {
    const letter = tokens[i]!.split(" ")[4]?.[0] ?? "M";
    const status = RAW_STATUS[letter] ?? "modified";
    if (letter === "R" || letter === "C") {
      files.push({ path: tokens[i + 2] ?? "", origPath: tokens[i + 1] ?? null, status, additions: null, deletions: null });
      i += 3;
    } else {
      files.push({ path: tokens[i + 1] ?? "", origPath: null, status, additions: null, deletions: null });
      i += 2;
    }
  }
  for (const file of files) {
    const token = tokens[i];
    if (token === undefined || token === "") break;
    const [added = "-", deleted = "-", path = ""] = token.split("\t");
    i += path === "" ? 3 : 1;
    if (added !== "-") {
      file.additions = Number(added);
      file.deletions = Number(deleted);
    }
  }
  return files;
}
