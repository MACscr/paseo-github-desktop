import type { PluginServerContext } from "@getpaseo/plugin/server";
import { detectEditors, discard, openInEditor } from "./server/actions";
import { githubDesktopAvailable, openInGithubDesktop } from "./server/github-desktop";
import { clearCaches, getCommit, getFileDiff, getLog, getStatus } from "./server/repo";
import { trashAvailable } from "./server/trash";
import { capabilitiesRpc, discardRpc, openInEditorRpc, openInGithubDesktopRpc } from "./shared/actions";
import { commitRpc, fileDiffRpc, logRpc, statusRpc } from "./shared/git";
import { detectEditorsRpc, editorSettings } from "./shared/settings";

const DEFAULT_EDITOR = { editor: "auto", customCommand: "", customArgs: "{file}" } as const;

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(editorSettings);
  server.handle(statusRpc, getStatus);
  server.handle(logRpc, getLog);
  server.handle(commitRpc, getCommit);
  server.handle(fileDiffRpc, getFileDiff);
  server.handle(openInEditorRpc, async (input) => {
    const current = await settings.read();
    return openInEditor(input, current.status === "ready" ? current.values : DEFAULT_EDITOR);
  });
  server.handle(detectEditorsRpc, async () => ({ installed: await detectEditors() }));
  server.handle(discardRpc, (input) => discard(input));
  server.handle(capabilitiesRpc, async () => ({
    trash: await trashAvailable(),
    githubDesktop: await githubDesktopAvailable(),
  }));
  server.handle(openInGithubDesktopRpc, (input) => openInGithubDesktop(input));
  return () => clearCaches();
}
