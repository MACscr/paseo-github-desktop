import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DesktopPanel } from "./client/panel";
import { EditorSettingsScreen } from "./client/settings";
import { openInGithubDesktopRpc } from "./shared/actions";

export default function contribute(client: PluginClientContext) {
  const removePanel = client.addWorkspacePanel({
    id: "desktop",
    title: "Git",
    icon: "GitCommitHorizontal",
    context: "workspace",
    Component: DesktopPanel,
  });
  const removeCommand = client.addCommandCenterItem({
    id: "open-desktop",
    title: "Open Git view",
    icon: "GitCommitHorizontal",
    keywords: ["git", "history", "commits", "changes", "diff", "review"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("desktop");
    },
  });
  // Shown everywhere; on a host without GitHub Desktop the daemon answers with a clear error toast.
  const removeGithubDesktop = client.addCommandCenterItem({
    id: "open-github-desktop",
    title: "Open in GitHub Desktop",
    icon: "Github",
    keywords: ["github", "desktop", "repository"],
    context: "workspace",
    async onSelect({ rpc, workspace }) {
      await rpc(openInGithubDesktopRpc, { cwd: workspace.directory });
    },
  });
  const removeSettings = client.addSettingsScreen({
    id: "editor",
    title: "Editor",
    icon: "SquareArrowOutUpRight",
    Component: EditorSettingsScreen,
  });
  return () => {
    removeSettings();
    removeGithubDesktop();
    removeCommand();
    removePanel();
  };
}
