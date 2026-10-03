import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSendReview, useWorkspaceAgents, type WorkspaceAgent } from "./agents";
import { type ReviewComment, reviewStore, useReview } from "./review";
import { MONO_FONT, tint } from "./theme";
import { IconButton } from "./ui";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** The agent reviews go to: the one last picked in this workspace, else its most recently active agent. */
export function useReviewTarget(workspaceId: string) {
  const agents = useWorkspaceAgents(workspaceId);
  const { agentId } = useReview(workspaceId);
  const list = agents.data ?? [];
  const agent = list.find((item) => item.id === agentId) ?? list[0] ?? null;
  return { agents: list, agent, loading: agents.isPending, error: agents.error };
}

function PillButton({
  theme,
  label,
  onPress,
  primary,
  disabled,
}: {
  theme: PluginTheme;
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: primary ? 0 : 1,
        borderColor: c.border,
        backgroundColor: primary ? c.accent : c.surface2,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ fontSize: 12, fontWeight: "600", color: primary ? c.accentForeground : c.foreground }}>{label}</Text>
    </Pressable>
  );
}

export function AgentPicker({
  theme,
  workspaceId,
  agents,
  agent,
}: {
  theme: PluginTheme;
  workspaceId: string;
  agents: readonly WorkspaceAgent[];
  agent: WorkspaceAgent | null;
}) {
  const c = theme.colors;
  const [open, setOpen] = useState(false);
  if (agents.length === 0) {
    return <Text style={{ fontSize: 12, color: c.statusWarning }}>No agent in this workspace to send to.</Text>;
  }
  return (
    <View style={{ gap: 4, minWidth: 0, flexShrink: 1, maxWidth: 320 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Send to ${agent?.title ?? "agent"}. Change agent`}
        onPress={() => setOpen((value) => !value)}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}
      >
        <Text style={{ fontSize: 12, color: c.foregroundMuted }}>To</Text>
        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "600", color: c.foreground, flexShrink: 1 }}>
          {agent?.title}
        </Text>
        {agents.length > 1 ? <Icon name={open ? "ChevronUp" : "ChevronDown"} size={13} color={c.foregroundMuted} /> : null}
      </Pressable>
      {open && agents.length > 1 ? (
        <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 6, backgroundColor: c.surface1, maxHeight: 180 }}>
          <ScrollView>
            {agents.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Send to ${item.title}`}
                onPress={() => {
                  reviewStore.setAgent(workspaceId, item.id);
                  setOpen(false);
                }}
                style={({ pressed }) => ({
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  flexDirection: "row",
                  gap: 8,
                  alignItems: "center",
                  backgroundColor: item.id === agent?.id ? c.surface2 : pressed ? c.surface2 : "transparent",
                })}
              >
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: c.foreground }}>
                  {item.title}
                </Text>
                <Text style={{ fontSize: 11, color: item.status === "running" ? c.statusSuccess : c.foregroundMuted }}>
                  {item.status}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/** Writes a comment on one diff line, then sends it on its own or queues it for the review. */
export function CommentComposer({
  theme,
  workspaceId,
  cwd,
  label,
  draft,
  onDone,
}: {
  theme: PluginTheme;
  workspaceId: string;
  cwd: string;
  label: string;
  draft: Omit<ReviewComment, "id" | "body">;
  onDone: () => void;
}) {
  const c = theme.colors;
  const [body, setBody] = useState("");
  const { agents, agent } = useReviewTarget(workspaceId);
  const send = useSendReview();
  const empty = body.trim() === "";

  const queue = () => {
    reviewStore.add(workspaceId, { ...draft, body: body.trim() });
    onDone();
  };
  const sendNow = () => {
    if (!agent) return;
    send.mutate(
      { agentId: agent.id, cwd, comments: [{ ...draft, id: "now", body: body.trim() }], note: "" },
      { onSuccess: onDone },
    );
  };

  return (
    <View style={{ borderRadius: 8, backgroundColor: tint(c.accent, 0.14, c.surface2), padding: 12, gap: 10 }}>
      <TextInput
        autoFocus
        multiline
        value={body}
        onChangeText={setBody}
        accessibilityLabel={`Comment on ${label}`}
        placeholder="Leave a comment"
        placeholderTextColor={c.foregroundMuted}
        style={{
          minHeight: 64,
          maxHeight: 180,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface0,
          color: c.foreground,
          fontSize: 13,
          textAlignVertical: "top",
        }}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <AgentPicker theme={theme} workspaceId={workspaceId} agents={agents} agent={agent} />
        <View style={{ flex: 1 }} />
        <TextButton theme={theme} label="Cancel" onPress={onDone} />
        <PillButton
          theme={theme}
          label={send.isPending ? "Sending…" : "Send now"}
          onPress={sendNow}
          disabled={empty || !agent || send.isPending}
        />
        <PillButton theme={theme} primary label="Comment" onPress={queue} disabled={empty} />
      </View>
      {send.isError ? (
        <Text style={{ fontSize: 12, color: c.statusDanger }}>Could not send: {errorMessage(send.error)}</Text>
      ) : null}
    </View>
  );
}

function TextButton({ theme, label, onPress }: { theme: PluginTheme; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ paddingHorizontal: 8, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>{label}</Text>
    </Pressable>
  );
}

/** Top-right toolbar button; only shown while comments are queued. */
export function SubmitCommentsButton({
  theme,
  workspaceId,
  open,
  onPress,
}: {
  theme: PluginTheme;
  workspaceId: string;
  open: boolean;
  onPress: () => void;
}) {
  const { comments } = useReview(workspaceId);
  if (comments.length === 0) return null;
  return (
    <PillButton
      theme={theme}
      primary={!open}
      label={`Submit comments (${comments.length})`}
      onPress={onPress}
    />
  );
}

export function ReviewSheet({
  theme,
  workspaceId,
  cwd,
  onClose,
}: {
  theme: PluginTheme;
  workspaceId: string;
  cwd: string;
  onClose: () => void;
}) {
  const c = theme.colors;
  const { comments } = useReview(workspaceId);
  const { agents, agent } = useReviewTarget(workspaceId);
  const [note, setNote] = useState("");
  const send = useSendReview();

  if (comments.length === 0) return null;

  const submit = () => {
    if (!agent) return;
    send.mutate(
      { agentId: agent.id, cwd, comments, note },
      {
        onSuccess: () => {
          reviewStore.clear(workspaceId);
          onClose();
        },
      },
    );
  };

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.surface1, padding: 12, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: c.foreground }}>
          {comments.length} pending {comments.length === 1 ? "comment" : "comments"}
        </Text>
        <IconButton theme={theme} icon="X" label="Close review" onPress={onClose} />
      </View>
      <ScrollView style={{ maxHeight: 200 }}>
        {comments.map((comment) => (
          <View key={comment.id} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 5 }}>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text numberOfLines={1} style={{ fontSize: 11.5, color: c.foregroundMuted, fontFamily: MONO_FONT }}>
                {comment.filePath}:{comment.lineNumber}
                {comment.scope.mode === "base" ? `  (${comment.scope.baseRef})` : ""}
              </Text>
              <Text style={{ fontSize: 12.5, color: c.foreground }}>{comment.body}</Text>
            </View>
            <IconButton
              theme={theme}
              icon="Trash2"
              label={`Remove comment on ${comment.filePath} line ${comment.lineNumber}`}
              onPress={() => reviewStore.remove(workspaceId, comment.id)}
            />
          </View>
        ))}
      </ScrollView>
      <TextInput
        multiline
        value={note}
        onChangeText={setNote}
        placeholder="Optional note to send with the review"
        placeholderTextColor={c.foregroundMuted}
        style={{
          minHeight: 40,
          maxHeight: 120,
          padding: 8,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface0,
          color: c.foreground,
          fontSize: 13,
          textAlignVertical: "top",
        }}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <AgentPicker theme={theme} workspaceId={workspaceId} agents={agents} agent={agent} />
        <View style={{ flex: 1 }} />
        <PillButton theme={theme} label="Discard all" onPress={() => reviewStore.clear(workspaceId)} />
        <PillButton
          theme={theme}
          primary
          label={send.isPending ? "Sending…" : "Send review"}
          onPress={submit}
          disabled={!agent || send.isPending}
        />
      </View>
      {send.isError ? (
        <Text style={{ fontSize: 12, color: c.statusDanger }}>Could not send: {errorMessage(send.error)}</Text>
      ) : null}
    </View>
  );
}
