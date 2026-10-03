import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginWorkspacePanelProps, useWorkspace } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Text, View } from "react-native";
import type { CommitSummary, DiffSource, RepoInfo, WorkingFile } from "../shared/git";
import { DiffView } from "./diff-view";
import { ContextMenuProvider, type MenuPoint } from "./context-menu";
import { GithubDesktopButton, useFileMenu } from "./file-actions";
import { CommitFileList, CommitHeader, CommitList } from "./history";
import { useCommit, useLog, usePrefetchCommit, useStatus } from "./queries";
import { commitScope, type ReviewScope } from "./review";
import { ReviewSheet, SubmitCommentsButton } from "./review-ui";
import { Divider, FileRow, IconButton, LIST_ROW_HEIGHT, Message, Tabs } from "./ui";

type Tab = "changes" | "history";
const SIDEBAR_WIDTH = 300;
const COMMIT_FILES_WIDTH = 280;
const UNCOMMITTED: ReviewScope = { mode: "uncommitted" };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function DesktopPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const cwd = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const [tab, setTab] = useState<Tab>("changes");
  const status = useStatus(cwd, tab === "changes" ? 2000 : 5000);
  const queryClient = useQueryClient();
  const c = theme.colors;
  const [reviewOpen, setReviewOpen] = useState(false);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["status", cwd] });
    void queryClient.invalidateQueries({ queryKey: ["diff", cwd, "worktree"] });
  }, [queryClient, cwd]);

  let content;
  if (!cwd) {
    content = <Message theme={theme} title="Workspace unavailable" />;
  } else if (status.data?.state === "not_repo" || status.data?.state === "no_git") {
    content = <Message theme={theme} title="No repository" detail={status.data.message} />;
  } else if (status.isError && !status.data) {
    content = (
      <Message
        theme={theme}
        tone="danger"
        title="Could not read the repository"
        detail={errorMessage(status.error)}
        action={{ label: "Retry", onPress: refresh }}
      />
    );
  } else if (!status.data) {
    content = <Message theme={theme} title="Reading repository…" />;
  } else {
    const { repo, files, totalFiles } = status.data;
    content = (
      <View style={{ flex: 1, minHeight: 0 }}>
        <Toolbar
          theme={theme}
          repo={repo}
          compact={layout.compact}
          onRefresh={refresh}
          trailing={
            <>
              <SubmitCommentsButton
                theme={theme}
                workspaceId={workspaceId}
                open={reviewOpen}
                onPress={() => setReviewOpen((value) => !value)}
              />
              <GithubDesktopButton theme={theme} cwd={cwd} />
            </>
          }
        />
        <Divider theme={theme} />
        {reviewOpen ? (
          <ReviewSheet theme={theme} workspaceId={workspaceId} cwd={cwd} onClose={() => setReviewOpen(false)} />
        ) : null}
        <Body
          workspaceId={workspaceId}
          theme={theme}
          compact={layout.compact}
          cwd={cwd}
          repo={repo}
          files={files}
          totalFiles={totalFiles}
          tab={tab}
          onTab={setTab}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: c.surface0 }}>
      <ContextMenuProvider theme={theme}>{content}</ContextMenuProvider>
    </View>
  );
}

function Toolbar({
  theme,
  repo,
  compact,
  onRefresh,
  trailing,
}: {
  theme: PluginTheme;
  repo: RepoInfo;
  compact: boolean;
  onRefresh: () => void;
  trailing: ReactNode;
}) {
  const c = theme.colors;
  const label = { color: c.foregroundMuted, fontSize: 10.5 };
  const value = { color: c.foreground, fontSize: 13, fontWeight: "600" as const };
  const section = { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, minWidth: 0 };
  return (
    <View
      style={{
        height: compact ? 44 : 48,
        paddingHorizontal: compact ? 10 : 14,
        flexDirection: "row",
        alignItems: "center",
        gap: compact ? 12 : 24,
        backgroundColor: c.surface1,
      }}
    >
      {compact ? null : (
        <View style={section}>
          <Icon name="BookMarked" size={16} color={c.foregroundMuted} />
          <View>
            <Text style={label}>Current repository</Text>
            <Text numberOfLines={1} style={value}>
              {repo.name}
            </Text>
          </View>
        </View>
      )}
      <View style={[section, { flexShrink: 1 }]}>
        <Icon name="GitBranch" size={16} color={c.foregroundMuted} />
        <View style={{ flexShrink: 1 }}>
          {compact ? null : <Text style={label}>Current branch</Text>}
          <Text numberOfLines={1} style={value}>
            {repo.branch ?? `Detached at ${repo.headSha?.slice(0, 7) ?? "?"}`}
          </Text>
        </View>
      </View>
      <View style={section}>
        <Icon name="ArrowUpDown" size={14} color={c.foregroundMuted} />
        <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12 }}>
          {repo.upstream ? `${repo.upstream}  ↑${repo.ahead} ↓${repo.behind}` : "Not published"}
        </Text>
      </View>
      <View style={{ flex: 1 }} />
      {trailing}
      <IconButton theme={theme} icon="RotateCw" label="Refresh" onPress={onRefresh} />
    </View>
  );
}

function Body({
  workspaceId,
  theme,
  compact,
  cwd,
  repo,
  files,
  totalFiles,
  tab,
  onTab,
}: {
  workspaceId: string;
  theme: PluginTheme;
  compact: boolean;
  cwd: string;
  repo: RepoInfo;
  files: readonly WorkingFile[];
  totalFiles: number;
  tab: Tab;
  onTab: (tab: Tab) => void;
}) {
  const tabs = useMemo(
    () => [
      { id: "changes" as const, label: totalFiles > 0 ? `Changes (${totalFiles})` : "Changes" },
      { id: "history" as const, label: "History" },
    ],
    [totalFiles],
  );
  const tabBar = <Tabs theme={theme} tabs={tabs} value={tab} onChange={onTab} />;
  return tab === "changes" ? (
    <ChangesTab workspaceId={workspaceId} theme={theme} compact={compact} cwd={cwd} files={files} totalFiles={totalFiles} tabBar={tabBar} />
  ) : (
    <HistoryTab workspaceId={workspaceId} theme={theme} compact={compact} cwd={cwd} headSha={repo.headSha} tabBar={tabBar} />
  );
}

function SplitLayout({
  theme,
  sidebar,
  children,
}: {
  theme: PluginTheme;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}>
      <View style={{ width: SIDEBAR_WIDTH, minHeight: 0 }}>{sidebar}</View>
      <Divider theme={theme} vertical />
      <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{children}</View>
    </View>
  );
}

function BackBar({ theme, title, onBack }: { theme: PluginTheme; title: string; onBack: () => void }) {
  const c = theme.colors;
  return (
    <View
      style={{
        height: 40,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 4,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
        backgroundColor: c.surface1,
      }}
    >
      <IconButton theme={theme} icon="ChevronLeft" label="Back" onPress={onBack} />
      <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontSize: 13, fontWeight: "500" }}>
        {title}
      </Text>
    </View>
  );
}

function workingFileKey(file: WorkingFile) {
  return file.path;
}

function workingFileLayout(_: ArrayLike<WorkingFile> | null | undefined, index: number) {
  return { length: LIST_ROW_HEIGHT, offset: LIST_ROW_HEIGHT * index, index };
}

function ChangesTab({
  workspaceId,
  theme,
  compact,
  cwd,
  files,
  totalFiles,
  tabBar,
}: {
  workspaceId: string;
  theme: PluginTheme;
  compact: boolean;
  cwd: string;
  files: readonly WorkingFile[];
  totalFiles: number;
  tabBar: ReactNode;
}) {
  const c = theme.colors;
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const openFileMenu = useFileMenu(theme, cwd);
  const onMenu = useCallback(
    (path: string, point: MenuPoint) => {
      const file = files.find((item) => item.path === path);
      if (file) openFileMenu({ path: file.path, origPath: file.origPath, status: file.status, uncommitted: true }, point);
    },
    [files, openFileMenu],
  );
  const selected = files.find((file) => file.path === selectedPath) ?? (compact ? null : (files[0] ?? null));

  const onSelect = useCallback((path: string) => {
    setSelectedPath(path);
    setShowDetail(true);
  }, []);
  const renderItem = useCallback(
    ({ item }: { item: WorkingFile }) => (
      <FileRow
        theme={theme}
        path={item.path}
        status={item.status}
        selected={item.path === selected?.path}
        onPress={onSelect}
        onMenu={onMenu}
        showMenuButton={compact}
      />
    ),
    [theme, selected?.path, onSelect, onMenu, compact],
  );

  const source = useMemo<DiffSource | null>(
    () => (selected ? { kind: "worktree", path: selected.path, origPath: selected.origPath, status: selected.status } : null),
    [selected?.path, selected?.origPath, selected?.status],
  );

  const sidebar = (
    <View style={{ flex: 1, minHeight: 0 }}>
      {tabBar}
      {files.length === 0 ? (
        <Message theme={theme} title="No local changes" detail="There are no uncommitted changes in this workspace." />
      ) : (
        <>
          <Text style={{ color: c.foregroundMuted, fontSize: 11.5, paddingHorizontal: 10, paddingVertical: 6 }}>
            {totalFiles > files.length
              ? `Showing ${files.length.toLocaleString()} of ${totalFiles.toLocaleString()} changed files`
              : `${files.length} changed ${files.length === 1 ? "file" : "files"}`}
          </Text>
          <FlatList
            style={{ flex: 1 }}
            data={files as WorkingFile[]}
            extraData={selected?.path}
            renderItem={renderItem}
            keyExtractor={workingFileKey}
            getItemLayout={workingFileLayout}
            initialNumToRender={40}
            removeClippedSubviews
          />
        </>
      )}
    </View>
  );

  const diff =
    selected && source ? (
      <DiffView
        key={selected.path}
        theme={theme}
        workspaceId={workspaceId}
        scope={UNCOMMITTED}
        cwd={cwd}
        source={source}
        version={selected.fingerprint}
        compact={compact}
      />
    ) : (
      <Message theme={theme} title={files.length === 0 ? "No local changes" : "Select a file"} />
    );

  if (compact) {
    if (!showDetail || !selected) return sidebar;
    return (
      <View style={{ flex: 1, minHeight: 0 }}>
        <BackBar theme={theme} title={selected.path} onBack={() => setShowDetail(false)} />
        {diff}
      </View>
    );
  }
  return (
    <SplitLayout theme={theme} sidebar={sidebar}>
      {diff}
    </SplitLayout>
  );
}

function HistoryTab({
  workspaceId,
  theme,
  compact,
  cwd,
  headSha,
  tabBar,
}: {
  workspaceId: string;
  theme: PluginTheme;
  compact: boolean;
  cwd: string;
  headSha: string | null;
  tabBar: ReactNode;
}) {
  const log = useLog(cwd, headSha);
  const commits = useMemo<CommitSummary[]>(() => log.data?.pages.flatMap((page) => page.commits) ?? [], [log.data]);
  const base = log.data?.pages[0]?.base ?? null;
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [depth, setDepth] = useState<0 | 1 | 2>(0);
  const effectiveSha = selectedSha ?? (compact ? null : (commits[0]?.sha ?? null));
  const commit = useCommit(cwd, effectiveSha);
  const files = commit.data?.files ?? [];
  const selectedFile = files.find((file) => file.path === selectedPath) ?? (compact ? null : (files[0] ?? null));
  const prefetchCommit = usePrefetchCommit(cwd);

  useEffect(() => {
    if (!effectiveSha) return;
    const index = commits.findIndex((item) => item.sha === effectiveSha);
    const next = commits[index + 1];
    if (next) prefetchCommit(next.sha);
  }, [effectiveSha, commits, prefetchCommit]);

  const onSelectCommit = useCallback((sha: string) => {
    setSelectedSha(sha);
    setSelectedPath(null);
    setDepth(1);
  }, []);
  const onSelectFile = useCallback((path: string) => {
    setSelectedPath(path);
    setDepth(2);
  }, []);
  const onEndReached = useCallback(() => {
    if (log.hasNextPage && !log.isFetchingNextPage) void log.fetchNextPage();
  }, [log.hasNextPage, log.isFetchingNextPage, log.fetchNextPage]);

  const source = useMemo<DiffSource | null>(
    () =>
      commit.data && selectedFile
        ? {
            kind: "commit",
            sha: commit.data.sha,
            parent: commit.data.parents[0] ?? null,
            path: selectedFile.path,
            origPath: selectedFile.origPath,
          }
        : null,
    [commit.data, selectedFile?.path, selectedFile?.origPath],
  );

  const list = (
    <View style={{ flex: 1, minHeight: 0 }}>
      {tabBar}
      <CommitList
        theme={theme}
        commits={commits}
        selectedSha={effectiveSha}
        base={base}
        loading={log.isPending && headSha !== null}
        error={log.isError ? errorMessage(log.error) : null}
        onSelect={onSelectCommit}
        onEndReached={onEndReached}
        loadingMore={log.isFetchingNextPage}
      />
    </View>
  );

  const diff = source ? (
    <DiffView key={`${source.kind === "commit" ? source.sha : ""}:${source.path}`} theme={theme}
      workspaceId={workspaceId}
      scope={source.kind === "commit" ? commitScope(source.sha, source.parent) : UNCOMMITTED}
      cwd={cwd}
      source={source}
      version=""
      compact={compact}
    />
  ) : (
    <Message theme={theme} title={files.length === 0 && commit.data ? "No file changes" : "Select a file"} />
  );

  const detail = commit.isError ? (
    <Message
      theme={theme}
      tone="danger"
      title="Could not load this commit"
      detail={errorMessage(commit.error)}
      action={{ label: "Retry", onPress: () => void commit.refetch() }}
    />
  ) : !commit.data ? (
    <Message theme={theme} title={effectiveSha ? "Loading commit…" : "Select a commit"} />
  ) : compact ? (
    <View style={{ flex: 1, minHeight: 0 }}>
      <CommitHeader theme={theme} commit={commit.data} compact />
      <CommitFileList theme={theme} cwd={cwd} compact={compact} files={files} selectedPath={selectedFile?.path ?? null} onSelect={onSelectFile} />
    </View>
  ) : (
    <View style={{ flex: 1, minHeight: 0 }}>
      <CommitHeader theme={theme} commit={commit.data} compact={false} />
      <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}>
        <View style={{ width: COMMIT_FILES_WIDTH, minHeight: 0 }}>
          <CommitFileList theme={theme} cwd={cwd} compact={compact} files={files} selectedPath={selectedFile?.path ?? null} onSelect={onSelectFile} />
        </View>
        <Divider theme={theme} vertical />
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{diff}</View>
      </View>
    </View>
  );

  if (compact) {
    if (depth === 0 || !effectiveSha) return list;
    if (depth === 1 || !selectedFile) {
      return (
        <View style={{ flex: 1, minHeight: 0 }}>
          <BackBar theme={theme} title="History" onBack={() => setDepth(0)} />
          {detail}
        </View>
      );
    }
    return (
      <View style={{ flex: 1, minHeight: 0 }}>
        <BackBar theme={theme} title={selectedFile.path} onBack={() => setDepth(1)} />
        {diff}
      </View>
    );
  }

  return (
    <SplitLayout theme={theme} sidebar={list}>
      {detail}
    </SplitLayout>
  );
}

