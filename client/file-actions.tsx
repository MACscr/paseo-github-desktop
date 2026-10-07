import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  canDiscard,
  capabilitiesRpc,
  discardDeletesFile,
  discardRpc,
  openInEditorRpc,
  openInGithubDesktopRpc,
} from "../shared/actions";
import type { FileStatus } from "../shared/git";
import { type MenuPoint, MenuItem, MenuSeparator, useContextMenu } from "./context-menu";
import { GithubMark } from "./github-mark";
import { tint } from "./theme";

export interface FileTarget {
  path: string;
  origPath: string | null;
  status: FileStatus;
  /** Only uncommitted files can be discarded; files from a commit's history cannot. */
  uncommitted: boolean;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** What the daemon host supports; it cannot change without a plugin reload, so it is fetched once. */
export function useCapabilities() {
  const capabilities = useRpc(capabilitiesRpc);
  return useQuery({ queryKey: ["capabilities"], queryFn: () => capabilities({}), staleTime: Number.POSITIVE_INFINITY });
}

/** Toolbar button that opens the repository in GitHub Desktop; hidden where it is not installed. */
export function GithubDesktopButton({ theme, cwd }: { theme: PluginTheme; cwd: string }) {
  const host = useCapabilities();
  const open = useRpc(openInGithubDesktopRpc);
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () => open({ cwd }),
    onError: (error) => toast.error(`Could not open GitHub Desktop: ${errorMessage(error)}`),
  });
  if (!host.data?.githubDesktop) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open in GitHub Desktop"
      onPress={() => mutation.mutate()}
      hitSlop={6}
      style={({ pressed }) => ({ padding: 6, borderRadius: 6, opacity: pressed ? 0.6 : 1 })}
    >
      <GithubMark size={15} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}

export function useOpenInEditor(cwd: string) {
  const open = useRpc(openInEditorRpc);
  const toast = useToast();
  return useMutation({
    mutationFn: (input: { path: string; line?: number }) => open({ cwd, ...input }),
    onError: (error) => toast.error(`Could not open the file: ${errorMessage(error)}`),
  });
}

function ConfirmButton({
  theme,
  label,
  onPress,
  danger,
  disabled,
}: {
  theme: PluginTheme;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: danger ? c.statusDanger : c.border,
        backgroundColor: danger ? tint(c.statusDanger, 0.15, c.surface2) : c.surface2,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ fontSize: 12, fontWeight: "600", color: danger ? c.statusDanger : c.foreground }}>{label}</Text>
    </Pressable>
  );
}

/** Right-click / long-press menu for one file. Discarding asks for confirmation inside the menu itself. */
function FileActionsMenu({
  theme,
  cwd,
  target,
  close,
}: {
  theme: PluginTheme;
  cwd: string;
  target: FileTarget;
  close: () => void;
}) {
  const c = theme.colors;
  const toast = useToast();
  const queryClient = useQueryClient();
  const openInEditor = useOpenInEditor(cwd);
  const discardFile = useRpc(discardRpc);
  const [confirming, setConfirming] = useState(false);
  const deletes = discardDeletesFile(target.status);
  // Restoring HEAD over a deleted file loses nothing, so there is no copy to save.
  const savesCopy = target.status !== "deleted";
  const host = useCapabilities();
  // Until the host answers, assume the worst so the warning is never softer than the truth.
  const hasTrash = host.data?.trash === true;
  const discard = useMutation({
    mutationFn: () => discardFile({ cwd, path: target.path, origPath: target.origPath, status: target.status }),
    onSuccess: ({ trashed }) => {
      void queryClient.invalidateQueries({ queryKey: ["status", cwd] });
      void queryClient.invalidateQueries({ queryKey: ["diff", cwd, "worktree"] });
      toast.show(
        trashed
          ? deletes
            ? "File moved to the Trash"
            : "Changes discarded. Your version is in the Trash."
          : "Changes discarded",
        { variant: "success" },
      );
      close();
    },
  });

  if (confirming) {
    return (
      <View style={{ padding: 8, gap: 10 }}>
        <Text style={{ fontSize: 12.5, color: c.foreground }}>
          {!savesCopy
            ? "The deleted file comes back from its last committed version."
            : deletes
              ? hasTrash
                ? "This file has never been committed, so discarding removes it. It moves to the Trash."
                : "This file has never been committed, so discarding permanently deletes it. This host has no Trash, so it cannot be recovered."
              : hasTrash
                ? "The file goes back to its last committed version. A copy of your current version moves to the Trash."
                : "The file goes back to its last committed version. This host has no Trash, so your current version cannot be recovered."}
        </Text>
        <Text numberOfLines={2} style={{ fontSize: 11.5, color: c.foregroundMuted }}>
          {target.path}
        </Text>
        {discard.isError ? (
          <Text style={{ fontSize: 12, color: c.statusDanger }}>{errorMessage(discard.error)}</Text>
        ) : null}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 6 }}>
          <ConfirmButton theme={theme} label="Cancel" onPress={close} />
          <ConfirmButton
            theme={theme}
            danger
            label={
              discard.isPending ? "Discarding…" : deletes ? (hasTrash ? "Move to Trash" : "Delete permanently") : "Discard"
            }
            disabled={discard.isPending || host.isPending}
            onPress={() => discard.mutate()}
          />
        </View>
      </View>
    );
  }

  return (
    <View>
      <MenuItem
        theme={theme}
        icon="SquareArrowOutUpRight"
        label="Open in editor"
        onPress={() => {
          openInEditor.mutate({ path: target.path });
          close();
        }}
      />
      <MenuItem
        theme={theme}
        icon="Copy"
        label="Copy path"
        onPress={() => {
          void copyText(target.path).then(() => toast.show("Path copied"));
          close();
        }}
      />
      {target.uncommitted && canDiscard(target.status) ? (
        <>
          <MenuSeparator theme={theme} />
          <MenuItem
            theme={theme}
            icon="Undo2"
            label={deletes ? "Discard new file…" : "Discard changes…"}
            danger
            onPress={() => setConfirming(true)}
          />
        </>
      ) : null}
    </View>
  );
}

/** Opens the actions menu for a file at the given point. */
export function useFileMenu(theme: PluginTheme, cwd: string) {
  const openMenu = useContextMenu();
  return useCallback(
    (target: FileTarget, point: MenuPoint) =>
      openMenu(point, (close) => <FileActionsMenu theme={theme} cwd={cwd} target={target} close={close} />),
    [openMenu, theme, cwd],
  );
}
