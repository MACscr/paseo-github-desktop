import { useSyncExternalStore } from "react";
import type { DiffRow } from "./diff-parse";

/** Which diff a comment was written against: the working tree, or one commit against its first parent. */
export type ReviewScope = { mode: "uncommitted" } | { mode: "base"; baseRef: string };

export interface ReviewContextLine {
  oldLineNumber: number | null;
  newLineNumber: number | null;
  type: "add" | "remove" | "context";
  content: string;
}

export interface ReviewComment {
  id: string;
  scope: ReviewScope;
  filePath: string;
  side: "old" | "new";
  lineNumber: number;
  body: string;
  context: { hunkHeader: string; targetLine: ReviewContextLine; lines: ReviewContextLine[] };
}

/** Matches Paseo's `application/paseo-review` attachment, so agents get the same context as built-in diff comments. */
export interface ReviewAttachment {
  type: "review";
  mimeType: "application/paseo-review";
  cwd: string;
  mode: "uncommitted" | "base";
  baseRef?: string | null;
  comments: Array<Omit<ReviewComment, "id" | "scope">>;
}

const CONTEXT_RADIUS = 3;

export function commitScope(sha: string, parent: string | null): ReviewScope {
  return { mode: "base", baseRef: `${parent ? parent.slice(0, 12) : "(root)"}..${sha.slice(0, 12)}` };
}

export function scopeKey(scope: ReviewScope): string {
  return scope.mode === "uncommitted" ? "uncommitted" : `base:${scope.baseRef}`;
}

function toContextLine(row: DiffRow): ReviewContextLine | null {
  if (row.kind !== "add" && row.kind !== "del" && row.kind !== "ctx") return null;
  return {
    oldLineNumber: row.oldNo && row.oldNo > 0 ? row.oldNo : null,
    newLineNumber: row.newNo && row.newNo > 0 ? row.newNo : null,
    type: row.kind === "add" ? "add" : row.kind === "del" ? "remove" : "context",
    content: row.text,
  };
}

/** Where a click on a diff row anchors a comment, or null for hunk headers and meta rows. */
export function commentAnchor(row: DiffRow): { side: "old" | "new"; lineNumber: number } | null {
  if (row.kind === "del") return row.oldNo && row.oldNo > 0 ? { side: "old", lineNumber: row.oldNo } : null;
  if (row.kind === "add" || row.kind === "ctx") {
    return row.newNo && row.newNo > 0 ? { side: "new", lineNumber: row.newNo } : null;
  }
  return null;
}

/** The hunk header plus up to three lines either side of the target, never crossing into another hunk. */
export function buildContext(rows: readonly DiffRow[], index: number): ReviewComment["context"] | null {
  const target = rows[index] ? toContextLine(rows[index]!) : null;
  if (!target) return null;
  let start = index;
  while (start > 0 && rows[start - 1]!.kind !== "hunk") start--;
  const hunkHeader = start > 0 ? rows[start - 1]!.text : "";
  let end = index;
  while (end < rows.length - 1 && rows[end + 1]!.kind !== "hunk") end++;
  const lines: ReviewContextLine[] = [];
  for (let i = Math.max(start, index - CONTEXT_RADIUS); i <= Math.min(end, index + CONTEXT_RADIUS); i++) {
    const line = toContextLine(rows[i]!);
    if (line) lines.push(line);
  }
  return { hunkHeader, targetLine: target, lines };
}

/** One attachment per diff the comments were written against. */
export function toAttachments(cwd: string, comments: readonly ReviewComment[]): ReviewAttachment[] {
  const groups = new Map<string, { scope: ReviewScope; comments: ReviewComment[] }>();
  for (const comment of comments) {
    const key = scopeKey(comment.scope);
    const group = groups.get(key) ?? { scope: comment.scope, comments: [] };
    group.comments.push(comment);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ scope, comments: grouped }) => ({
    type: "review",
    mimeType: "application/paseo-review",
    cwd,
    mode: scope.mode,
    ...(scope.mode === "base" ? { baseRef: scope.baseRef } : {}),
    comments: grouped.map(({ id: _id, scope: _scope, ...comment }) => comment),
  }));
}

export function reviewMessage(comments: readonly ReviewComment[], note: string): string {
  const trimmed = note.trim();
  if (trimmed) return trimmed;
  return comments.length === 1 ? "Please address this review comment." : "Please address these review comments.";
}

// Queued comments live for the app session, per workspace, so they survive switching files, tabs, and panels.
interface WorkspaceReview {
  comments: ReviewComment[];
  agentId: string | null;
}

const EMPTY: WorkspaceReview = { comments: [], agentId: null };
const reviews = new Map<string, WorkspaceReview>();
const listeners = new Set<() => void>();
let nextId = 0;

function update(workspaceId: string, change: (current: WorkspaceReview) => WorkspaceReview) {
  reviews.set(workspaceId, change(reviews.get(workspaceId) ?? EMPTY));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReview(workspaceId: string): WorkspaceReview {
  return useSyncExternalStore(subscribe, () => reviews.get(workspaceId) ?? EMPTY);
}

export const reviewStore = {
  add(workspaceId: string, comment: Omit<ReviewComment, "id">) {
    update(workspaceId, (current) => ({ ...current, comments: [...current.comments, { ...comment, id: `c${++nextId}` }] }));
  },
  remove(workspaceId: string, id: string) {
    update(workspaceId, (current) => ({ ...current, comments: current.comments.filter((comment) => comment.id !== id) }));
  },
  clear(workspaceId: string) {
    update(workspaceId, (current) => ({ ...current, comments: [] }));
  },
  setAgent(workspaceId: string, agentId: string) {
    update(workspaceId, (current) => ({ ...current, agentId }));
  },
};
