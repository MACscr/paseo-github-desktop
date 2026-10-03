import { useRpc } from "@getpaseo/plugin/client";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  commitRpc,
  type CommitDetail,
  type DiffSource,
  fileDiffRpc,
  logRpc,
  type LogResult,
  statusRpc,
} from "../shared/git";

export const LOG_PAGE_SIZE = 100;
const HOUR = 60 * 60 * 1000;

export function useStatus(cwd: string | null, pollMs: number) {
  const status = useRpc(statusRpc);
  return useQuery({
    queryKey: ["status", cwd],
    queryFn: () => status({ cwd: cwd! }),
    enabled: cwd !== null,
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

export function useLog(cwd: string | null, headSha: string | null) {
  const log = useRpc(logRpc);
  return useInfiniteQuery({
    queryKey: ["log", cwd, headSha],
    queryFn: ({ pageParam }) => log({ cwd: cwd!, headSha: headSha!, skip: pageParam, limit: LOG_PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (last: LogResult, pages: LogResult[]) =>
      last.hasMore ? pages.length * LOG_PAGE_SIZE : undefined,
    enabled: cwd !== null && headSha !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: HOUR,
    placeholderData: (previous) => previous,
  });
}

function commitKey(cwd: string, sha: string) {
  return ["commit", cwd, sha] as const;
}

export function useCommit(cwd: string | null, sha: string | null) {
  const commit = useRpc(commitRpc);
  return useQuery({
    queryKey: commitKey(cwd ?? "", sha ?? ""),
    queryFn: () => commit({ cwd: cwd!, sha: sha! }),
    enabled: cwd !== null && sha !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: HOUR,
  });
}

export function usePrefetchCommit(cwd: string | null) {
  const client = useQueryClient();
  const commit = useRpc(commitRpc);
  return useCallback(
    (sha: string) => {
      if (!cwd) return;
      void client.prefetchQuery<CommitDetail>({
        queryKey: commitKey(cwd, sha),
        queryFn: () => commit({ cwd, sha }),
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: HOUR,
      });
    },
    [client, commit, cwd],
  );
}

/** Commit diffs are immutable; working tree diffs are keyed by the file's status fingerprint. */
function diffKey(cwd: string, source: DiffSource, version: string, full: boolean) {
  return source.kind === "commit"
    ? (["diff", cwd, "commit", source.sha, source.path, full] as const)
    : (["diff", cwd, "worktree", source.path, version, full] as const);
}

export function useFileDiff(cwd: string | null, source: DiffSource | null, version: string, full: boolean) {
  const fileDiff = useRpc(fileDiffRpc);
  return useQuery({
    queryKey: source && cwd ? diffKey(cwd, source, version, full) : ["diff", "none"],
    queryFn: () => fileDiff({ cwd: cwd!, source: source!, full }),
    enabled: cwd !== null && source !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: source?.kind === "commit" ? HOUR : 5 * 60 * 1000,
    // Keep showing a working-tree file's previous diff while its new version loads, but never another file's.
    placeholderData: (previous, previousQuery) =>
      source?.kind === "worktree" && previousQuery?.queryKey[3] === source.path ? previous : undefined,
  });
}

export function usePrefetchDiff(cwd: string | null) {
  const client = useQueryClient();
  const fileDiff = useRpc(fileDiffRpc);
  return useCallback(
    (source: DiffSource, version: string) => {
      if (!cwd) return;
      void client.prefetchQuery({
        queryKey: diffKey(cwd, source, version, false),
        queryFn: () => fileDiff({ cwd, source, full: false }),
        staleTime: Number.POSITIVE_INFINITY,
      });
    },
    [client, cwd, fileDiff],
  );
}
