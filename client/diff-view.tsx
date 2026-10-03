import type { PluginTheme } from "@getpaseo/plugin";
import { memo, type ReactNode, useCallback, useMemo, useState } from "react";
import { FlatList, type LayoutChangeEvent, Pressable, ScrollView, Text, View } from "react-native";
import type { DiffSource } from "../shared/git";
import { type DiffRow, parseDiff } from "./diff-parse";
import { formatBytes } from "./format";
import { buildContext, commentAnchor, type ReviewComment, type ReviewScope, reviewStore, scopeKey, useReview } from "./review";
import { useOpenInEditor } from "./file-actions";
import { CommentComposer } from "./review-ui";
import { useFileDiff } from "./queries";
import { DIFF_CHAR_WIDTH, DIFF_FONT_SIZE, DIFF_ROW_HEIGHT, MONO_FONT, palette } from "./theme";
import { IconButton, Message } from "./ui";

interface DiffViewProps {
  theme: PluginTheme;
  workspaceId: string;
  scope: ReviewScope;
  cwd: string;
  source: DiffSource;
  /** Changes when the underlying working-tree file changes. */
  version: string;
  compact: boolean;
}

type DiffStyles = ReturnType<typeof makeStyles>;

function makeStyles(theme: PluginTheme, gutterWidth: number) {
  const p = palette(theme);
  const c = theme.colors;
  const lineText = {
    fontFamily: MONO_FONT,
    fontSize: DIFF_FONT_SIZE,
    lineHeight: DIFF_ROW_HEIGHT,
    color: c.foreground,
  };
  return {
    row: { flexDirection: "row" as const, height: DIFF_ROW_HEIGHT },
    rowBg: { add: p.addBg, del: p.delBg, hunk: p.hunkBg, ctx: "transparent", meta: "transparent" },
    gutterBg: { add: p.addGutter, del: p.delGutter, hunk: p.hunkBg, ctx: c.surface1, meta: c.surface1 },
    gutter: {
      width: gutterWidth,
      paddingRight: 8,
      textAlign: "right" as const,
      ...lineText,
      color: c.foregroundMuted,
    },
    gutterBorder: { borderRightWidth: 1, borderRightColor: c.border },
    prefix: { width: 18, textAlign: "center" as const, ...lineText },
    text: { ...lineText, paddingRight: 24 },
    hunkText: { ...lineText, color: c.foregroundMuted, paddingLeft: 8 },
    metaText: { ...lineText, color: c.foregroundMuted, fontStyle: "italic" as const },
    prefixColor: { add: c.statusSuccess, del: c.statusDanger },
    activeBg: p.selected,
    commentedGutter: p.selected,
  };
}

const PREFIX = { add: "+", del: "-", ctx: " ", hunk: "", meta: "" } as const;

const DiffLine = memo(function DiffLine({
  row,
  index,
  styles,
  active,
  commented,
  onPress,
}: {
  row: DiffRow;
  index: number;
  styles: DiffStyles;
  active: boolean;
  commented: boolean;
  onPress: ((index: number) => void) | null;
}) {
  const gutterBg = commented ? styles.commentedGutter : styles.gutterBg[row.kind];
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress ? () => onPress(index) : undefined}
      accessibilityLabel={onPress ? `Comment on line ${row.newNo ?? row.oldNo}` : undefined}
      style={[styles.row, { backgroundColor: active ? styles.activeBg : styles.rowBg[row.kind] }]}
    >
      <Text style={[styles.gutter, { backgroundColor: gutterBg }]}>{row.oldNo ?? ""}</Text>
      <Text style={[styles.gutter, styles.gutterBorder, { backgroundColor: gutterBg }]}>{row.newNo ?? ""}</Text>
      {row.kind === "hunk" ? (
        <Text style={styles.hunkText} selectable>
          {row.text}
        </Text>
      ) : row.kind === "meta" ? (
        <Text style={[styles.prefix, styles.metaText]}>{` ${row.text}`}</Text>
      ) : (
        <>
          <Text
            style={[
              styles.prefix,
              row.kind === "add" || row.kind === "del" ? { color: styles.prefixColor[row.kind] } : null,
            ]}
          >
            {PREFIX[row.kind]}
          </Text>
          <Text style={styles.text} selectable>
            {row.text}
          </Text>
        </>
      )}
    </Pressable>
  );
});

const CommentRow = memo(function CommentRow({
  theme,
  comment,
  onRemove,
}: {
  theme: PluginTheme;
  comment: ReviewComment;
  onRemove: (id: string) => void;
}) {
  const c = theme.colors;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        marginVertical: 4,
        marginLeft: 12,
        padding: 8,
        maxWidth: 640,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface1,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 11, color: c.foregroundMuted }}>Pending comment</Text>
        <Text selectable style={{ fontSize: 12.5, color: c.foreground }}>
          {comment.body}
        </Text>
      </View>
      <IconButton theme={theme} icon="Trash2" label="Remove pending comment" onPress={() => onRemove(comment.id)} />
    </View>
  );
});

type DiffItem =
  | { kind: "line"; row: DiffRow; index: number }
  | { kind: "comment"; comment: ReviewComment }
  | { kind: "composer"; index: number };

function getItemLayout(_: ArrayLike<DiffItem> | null | undefined, index: number) {
  return { length: DIFF_ROW_HEIGHT, offset: DIFF_ROW_HEIGHT * index, index };
}

function keyExtractor(item: DiffItem) {
  return item.kind === "line" ? String(item.index) : item.kind === "comment" ? item.comment.id : `composer:${item.index}`;
}

function DiffLines({
  theme,
  patch,
  comments,
  activeIndex,
  onLinePress,
  onRemoveComment,
  composer,
}: {
  theme: PluginTheme;
  patch: string;
  comments: readonly ReviewComment[];
  activeIndex: number | null;
  onLinePress: (index: number, rows: readonly DiffRow[]) => void;
  onRemoveComment: (id: string) => void;
  /** The open comment box, rendered directly under the line at activeIndex. */
  composer: ReactNode;
}) {
  const parsed = useMemo(() => parseDiff(patch), [patch]);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const digits = Math.max(3, String(parsed.maxLineNo).length);
  const gutterWidth = digits * DIFF_CHAR_WIDTH + 16;
  const styles = useMemo(() => makeStyles(theme, gutterWidth), [theme, gutterWidth]);
  const contentWidth = gutterWidth * 2 + 18 + parsed.maxChars * DIFF_CHAR_WIDTH + 32;

  // Pending comments render under the line they target; without any, every row keeps its fixed height.
  const { items, commentedLines } = useMemo(() => {
    const byLine = new Map<string, ReviewComment[]>();
    for (const comment of comments) {
      const key = `${comment.side}:${comment.lineNumber}`;
      byLine.set(key, [...(byLine.get(key) ?? []), comment]);
    }
    const list: DiffItem[] = [];
    const commented = new Set<number>();
    parsed.rows.forEach((row, index) => {
      list.push({ kind: "line", row, index });
      const anchor = commentAnchor(row);
      const attached = anchor ? byLine.get(`${anchor.side}:${anchor.lineNumber}`) : undefined;
      if (attached) {
        commented.add(index);
        for (const comment of attached) list.push({ kind: "comment", comment });
      }
      if (index === activeIndex) list.push({ kind: "composer", index });
    });
    return { items: list, commentedLines: commented };
  }, [parsed.rows, comments, activeIndex]);

  const onPress = useCallback((index: number) => onLinePress(index, parsed.rows), [onLinePress, parsed.rows]);
  const renderItem = useCallback(
    ({ item }: { item: DiffItem }) =>
      item.kind === "line" ? (
        <DiffLine
          row={item.row}
          index={item.index}
          styles={styles}
          active={item.index === activeIndex}
          commented={commentedLines.has(item.index)}
          onPress={commentAnchor(item.row) ? onPress : null}
        />
      ) : item.kind === "comment" ? (
        <CommentRow theme={theme} comment={item.comment} onRemove={onRemoveComment} />
      ) : (
        // Pin the box to the visible width so it stays readable inside the horizontally scrolled diff.
        <View style={{ width: (size?.width ?? 640) - 24, marginHorizontal: 12, marginVertical: 6 }}>{composer}</View>
      ),
    [styles, activeIndex, commentedLines, onPress, theme, onRemoveComment, composer, size?.width],
  );
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) => (current?.width === width && current.height === height ? current : { width, height }));
  }, []);

  return (
    <View style={{ flex: 1, minHeight: 0 }} onLayout={onLayout}>
      {size ? (
        <ScrollView horizontal style={{ flex: 1 }} showsHorizontalScrollIndicator>
          <FlatList
            style={{ width: Math.max(contentWidth, size.width), height: size.height }}
            data={items}
            extraData={activeIndex}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            getItemLayout={comments.length === 0 && activeIndex === null ? getItemLayout : undefined}
            initialNumToRender={Math.ceil(size.height / DIFF_ROW_HEIGHT) + 10}
            maxToRenderPerBatch={80}
            windowSize={7}
            // Clipping would unmount the open comment box (and drop its text) when it scrolls offscreen.
            removeClippedSubviews={activeIndex === null}
            keyboardShouldPersistTaps="handled"
          />
        </ScrollView>
      ) : null}
    </View>
  );
}

export function DiffView({ theme, workspaceId, scope, cwd, source, version, compact }: DiffViewProps) {
  const [full, setFull] = useState(false);
  const diff = useFileDiff(cwd, source, version, full);
  const c = theme.colors;
  const review = useReview(workspaceId);
  const key = scopeKey(scope);
  const fileComments = useMemo(
    () => review.comments.filter((comment) => comment.filePath === source.path && scopeKey(comment.scope) === key),
    [review.comments, source.path, key],
  );
  const [draft, setDraft] = useState<{ index: number; comment: Omit<ReviewComment, "id" | "body"> } | null>(null);

  const onLinePress = useCallback(
    (index: number, rows: readonly DiffRow[]) => {
      const row = rows[index];
      const anchor = row ? commentAnchor(row) : null;
      const context = buildContext(rows, index);
      if (!anchor || !context) return;
      setDraft({ index, comment: { scope, filePath: source.path, ...anchor, context } });
    },
    [scope, source.path],
  );
  const onRemoveComment = useCallback((id: string) => reviewStore.remove(workspaceId, id), [workspaceId]);

  const composer = draft ? (
    <CommentComposer
      key={`${draft.comment.side}:${draft.comment.lineNumber}`}
      theme={theme}
      workspaceId={workspaceId}
      cwd={cwd}
      label={`${source.path}:${draft.comment.lineNumber}${draft.comment.side === "old" ? " (removed line)" : ""}`}
      draft={draft.comment}
      onDone={() => setDraft(null)}
    />
  ) : null;

  let body;
  if (diff.data?.kind === "text") {
    body = (
      <DiffLines
        theme={theme}
        patch={diff.data.patch}
        comments={fileComments}
        activeIndex={draft?.index ?? null}
        onLinePress={onLinePress}
        onRemoveComment={onRemoveComment}
        composer={composer}
      />
    );
  } else if (diff.isError) {
    body = (
      <Message
        theme={theme}
        tone="danger"
        title="Could not load this diff"
        detail={diff.error instanceof Error ? diff.error.message : String(diff.error)}
        action={{ label: "Retry", onPress: () => void diff.refetch() }}
      />
    );
  } else if (!diff.data) {
    body = <Message theme={theme} title="Loading diff…" />;
  } else if (diff.data.kind === "binary") {
    body = <Message theme={theme} title="Binary file" detail="This binary file has changed." />;
  } else if (diff.data.kind === "empty") {
    body = (
      <Message
        theme={theme}
        title="No content changes"
        detail={source.origPath ? "The file was renamed without changing its contents." : "Only file metadata changed."}
      />
    );
  } else {
    body = (
      <Message
        theme={theme}
        title="This diff is large"
        detail={`${formatBytes(diff.data.bytes)}${diff.data.bytes >= 1024 * 1024 ? "+" : ""} or more than 5,000 lines. Loading it may be slow.`}
        action={{ label: "Load diff", onPress: () => setFull(true) }}
      />
    );
  }

  return (
    <View style={{ flex: 1, minHeight: 0, minWidth: 0, backgroundColor: c.surface0 }}>
      {compact ? null : <DiffHeader theme={theme} cwd={cwd} source={source} line={draft?.comment.lineNumber} />}
      {body}
    </View>
  );
}

function DiffHeader({
  theme,
  cwd,
  source,
  line,
}: {
  theme: PluginTheme;
  cwd: string;
  source: DiffSource;
  line?: number;
}) {
  const c = theme.colors;
  const openInEditor = useOpenInEditor(cwd);
  // A deleted file has nothing on disk to open.
  const openable = !(source.kind === "worktree" && source.status === "deleted");
  return (
    <View
      style={{
        height: 36,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: 1,
        borderBottomColor: c.border,
        backgroundColor: c.surface1,
      }}
    >
      <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontFamily: MONO_FONT, fontSize: 12 }}>
        {source.origPath && source.origPath !== source.path ? `${source.origPath} → ${source.path}` : source.path}
      </Text>
      {openable ? (
        <IconButton
          theme={theme}
          icon="SquareArrowOutUpRight"
          label="Open in editor"
          onPress={() => openInEditor.mutate({ path: source.path, line })}
        />
      ) : null}
    </View>
  );
}
