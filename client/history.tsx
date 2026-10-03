import type { PluginTheme } from "@getpaseo/plugin";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { memo, useCallback, useMemo } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import type { CommitDetail, CommitFile, CommitSummary } from "../shared/git";
import type { MenuPoint } from "./context-menu";
import { useFileMenu } from "./file-actions";
import { fullDate, relativeTime } from "./format";
import { MONO_FONT, palette } from "./theme";
import { FileRow, LIST_ROW_HEIGHT, Message } from "./ui";

export const COMMIT_ROW_HEIGHT = 50;

const CommitRow = memo(function CommitRow({
  theme,
  commit,
  selected,
  selectedBg,
  onPress,
}: {
  theme: PluginTheme;
  commit: CommitSummary;
  selected: boolean;
  selectedBg: string;
  onPress: (sha: string) => void;
}) {
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={commit.subject}
      onPress={() => onPress(commit.sha)}
      style={{
        height: COMMIT_ROW_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: 1,
        borderBottomColor: c.border,
        backgroundColor: selected ? selectedBg : "transparent",
      }}
    >
      <View style={{ width: 3, alignSelf: "stretch", backgroundColor: commit.notOnBase ? c.accent : "transparent" }} />
      <View style={{ flex: 1, paddingLeft: 9, paddingRight: 6, gap: 3 }}>
        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13, fontWeight: "500" }}>
          {commit.subject || "(no message)"}
        </Text>
        <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11.5 }}>
          {commit.authorName} · {relativeTime(commit.date)}
        </Text>
      </View>
      {commit.unpushed ? (
        <View accessibilityLabel="Not pushed" style={{ paddingRight: 10 }}>
          <Icon name="ArrowUp" size={14} color={c.foregroundMuted} />
        </View>
      ) : null}
    </Pressable>
  );
});

function commitKey(commit: CommitSummary) {
  return commit.sha;
}

function commitLayout(_: ArrayLike<CommitSummary> | null | undefined, index: number) {
  return { length: COMMIT_ROW_HEIGHT, offset: COMMIT_ROW_HEIGHT * index, index };
}

export function CommitList({
  theme,
  commits,
  selectedSha,
  base,
  loading,
  error,
  onSelect,
  onEndReached,
  loadingMore,
}: {
  theme: PluginTheme;
  commits: readonly CommitSummary[];
  selectedSha: string | null;
  base: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (sha: string) => void;
  onEndReached: () => void;
  loadingMore: boolean;
}) {
  const c = theme.colors;
  const selectedBg = useMemo(() => palette(theme).selected, [theme]);
  const renderItem = useCallback(
    ({ item }: { item: CommitSummary }) => (
      <CommitRow
        theme={theme}
        commit={item}
        selected={item.sha === selectedSha}
        selectedBg={selectedBg}
        onPress={onSelect}
      />
    ),
    [theme, selectedSha, selectedBg, onSelect],
  );
  if (error) return <Message theme={theme} tone="danger" title="Could not load history" detail={error} />;
  if (loading && commits.length === 0) return <Message theme={theme} title="Loading history…" />;
  if (commits.length === 0) return <Message theme={theme} title="No commits yet" />;
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      {base ? (
        <View
          style={{
            height: 26,
            paddingHorizontal: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
          }}
        >
          <View style={{ width: 3, height: 12, backgroundColor: c.accent }} />
          <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11 }}>
            Not in {base}
          </Text>
          <View style={{ marginLeft: 8 }}>
            <Icon name="ArrowUp" size={12} color={c.foregroundMuted} />
          </View>
          <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>Not pushed</Text>
        </View>
      ) : null}
      <FlatList
        style={{ flex: 1 }}
        data={commits as CommitSummary[]}
        extraData={selectedSha}
        renderItem={renderItem}
        keyExtractor={commitKey}
        getItemLayout={commitLayout}
        initialNumToRender={30}
        maxToRenderPerBatch={40}
        windowSize={9}
        onEndReached={onEndReached}
        onEndReachedThreshold={2}
        removeClippedSubviews
        ListFooterComponent={
          loadingMore ? (
            <Text style={{ color: c.foregroundMuted, fontSize: 11, padding: 10, textAlign: "center" }}>Loading…</Text>
          ) : null
        }
      />
    </View>
  );
}

export function CommitHeader({ theme, commit, compact }: { theme: PluginTheme; commit: CommitDetail; compact: boolean }) {
  const c = theme.colors;
  const toast = useToast();
  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const file of commit.files) {
      additions += file.additions ?? 0;
      deletions += file.deletions ?? 0;
    }
    return { additions, deletions };
  }, [commit.files]);

  async function copySha() {
    try {
      await copyText(commit.sha);
      toast.show("Commit SHA copied", { variant: "success" });
    } catch {
      toast.error("Could not copy the SHA.");
    }
  }

  return (
    <View
      style={{
        paddingHorizontal: compact ? 12 : 16,
        paddingVertical: 10,
        gap: 6,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
        backgroundColor: c.surface1,
      }}
    >
      <Text selectable style={{ color: c.foreground, fontSize: 15, fontWeight: "600" }}>
        {commit.subject || "(no message)"}
      </Text>
      {commit.body ? (
        <ScrollView style={{ maxHeight: 120 }}>
          <Text selectable style={{ color: c.foregroundMuted, fontSize: 12.5, lineHeight: 18 }}>
            {commit.body}
          </Text>
        </ScrollView>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 14, rowGap: 4 }}>
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
          <Text style={{ color: c.foreground }}>{commit.authorName}</Text> · {fullDate(commit.date)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy commit SHA"
          onPress={() => void copySha()}
          style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
        >
          <Icon name="GitCommitHorizontal" size={13} color={c.foregroundMuted} />
          <Text style={{ color: c.foregroundMuted, fontSize: 12, fontFamily: MONO_FONT }}>{commit.sha.slice(0, 7)}</Text>
        </Pressable>
        {commit.parents.length > 1 ? (
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Merge · diff vs first parent</Text>
        ) : null}
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
          {commit.files.length} changed {commit.files.length === 1 ? "file" : "files"}{" "}
          <Text style={{ color: c.statusSuccess }}>+{totals.additions}</Text>{" "}
          <Text style={{ color: c.statusDanger }}>−{totals.deletions}</Text>
        </Text>
      </View>
    </View>
  );
}

function fileKey(file: CommitFile) {
  return file.path;
}

function fileLayout(_: ArrayLike<CommitFile> | null | undefined, index: number) {
  return { length: LIST_ROW_HEIGHT, offset: LIST_ROW_HEIGHT * index, index };
}

export function CommitFileList({
  theme,
  cwd,
  compact,
  files,
  selectedPath,
  onSelect,
}: {
  theme: PluginTheme;
  cwd: string;
  compact: boolean;
  files: readonly CommitFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const openFileMenu = useFileMenu(theme, cwd);
  const onMenu = useCallback(
    (path: string, point: MenuPoint) => {
      const file = files.find((item) => item.path === path);
      if (file) openFileMenu({ path: file.path, origPath: file.origPath, status: file.status, uncommitted: false }, point);
    },
    [files, openFileMenu],
  );
  const renderItem = useCallback(
    ({ item }: { item: CommitFile }) => (
      <FileRow
        theme={theme}
        path={item.path}
        status={item.status}
        additions={item.additions}
        deletions={item.deletions}
        selected={item.path === selectedPath}
        onPress={onSelect}
        onMenu={onMenu}
        showMenuButton={compact}
      />
    ),
    [theme, selectedPath, onSelect, onMenu, compact],
  );
  if (files.length === 0) return <Message theme={theme} title="No file changes" />;
  return (
    <FlatList
      style={{ flex: 1 }}
      data={files as CommitFile[]}
      extraData={selectedPath}
      renderItem={renderItem}
      keyExtractor={fileKey}
      getItemLayout={fileLayout}
      initialNumToRender={40}
      removeClippedSubviews
    />
  );
}
