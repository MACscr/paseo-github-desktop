export type DiffRowKind = "hunk" | "add" | "del" | "ctx" | "meta";

export interface DiffRow {
  kind: DiffRowKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface ParsedDiff {
  rows: DiffRow[];
  additions: number;
  deletions: number;
  /** Longest rendered line, in characters, for sizing the horizontal scroller. */
  maxChars: number;
  maxLineNo: number;
}

export const MAX_LINE_CHARS = 2000;
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function expand(text: string): string {
  const expanded = text.includes("\t") ? text.replace(/\t/g, "    ") : text;
  return expanded.length > MAX_LINE_CHARS ? `${expanded.slice(0, MAX_LINE_CHARS)}…` : expanded;
}

/** Parses a unified diff that starts at its first hunk header. */
export function parseDiff(patch: string): ParsedDiff {
  const lines = patch.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const rows: DiffRow[] = new Array(lines.length);
  let oldNo = 0;
  let newNo = 0;
  let additions = 0;
  let deletions = 0;
  let maxChars = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const prefix = line[0];
    let row: DiffRow;
    if (prefix === "+") {
      row = { kind: "add", oldNo: null, newNo: newNo++, text: expand(line.slice(1)) };
      additions++;
    } else if (prefix === "-") {
      row = { kind: "del", oldNo: oldNo++, newNo: null, text: expand(line.slice(1)) };
      deletions++;
    } else if (prefix === "@") {
      const match = HUNK.exec(line);
      if (match) {
        oldNo = Number(match[1]);
        newNo = Number(match[2]);
      }
      row = { kind: "hunk", oldNo: null, newNo: null, text: expand(line) };
    } else if (prefix === "\\") {
      row = { kind: "meta", oldNo: null, newNo: null, text: line.slice(2) };
    } else {
      row = { kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: expand(line.slice(1)) };
    }
    if (row.text.length > maxChars) maxChars = row.text.length;
    rows[i] = row;
  }
  return { rows, additions, deletions, maxChars, maxLineNo: Math.max(oldNo, newNo) };
}
