import { useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsInput, SettingsRow, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Text } from "react-native";
import { detectEditorsRpc, type EditorChoice, editorSettings } from "../shared/settings";

const LABELS: Record<EditorChoice, string> = {
  auto: "Automatic",
  code: "VS Code",
  cursor: "Cursor",
  zed: "Zed",
  subl: "Sublime Text",
  custom: "Custom command",
};

const SAVE_DELAY_MS = 500;

export function EditorSettingsScreen({ theme }: PluginSurfaceProps) {
  const c = theme.colors;
  const settings = useSettings(editorSettings);
  const detect = useRpc(detectEditorsRpc);
  const installed = useQuery({ queryKey: ["editors"], queryFn: () => detect({}), staleTime: 60_000 });
  // Text fields save after a pause, against whatever revision is current when the timer fires.
  const latest = useRef(settings);
  latest.current = settings;
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);

  if (settings.status === "loading") {
    return <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>Loading…</Text>;
  }
  if (settings.status !== "ready") {
    return <Text style={{ color: c.statusDanger, fontSize: 13 }}>Could not load settings: {settings.error}</Text>;
  }

  const values = settings.values;
  const found = new Set(installed.data?.installed ?? []);
  const options = (Object.keys(LABELS) as EditorChoice[]).map((value) => ({
    value,
    label:
      value === "auto" || value === "custom" || !installed.data || found.has(value)
        ? LABELS[value]
        : `${LABELS[value]} (not found)`,
  }));
  const autoHint = installed.data
    ? found.size > 0
      ? `Uses the first installed of VS Code, Cursor, Zed, Sublime Text. Currently: ${LABELS[installed.data.installed[0]!]}.`
      : "No supported editor command was found on this host's PATH."
    : undefined;

  function saveText(field: "customCommand" | "customArgs", text: string) {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      const current = latest.current;
      if (current.status === "ready") void current.save({ ...current.values, [field]: text }, current.revision);
    }, SAVE_DELAY_MS);
  }

  return (
    <SettingsSection title="Open in editor">
      <SettingsCard>
        <SettingsSelect
          label="Editor"
          hint={values.editor === "auto" ? autoHint : "Files open on this host, where the daemon runs."}
          value={values.editor}
          options={options}
          disabled={settings.saving}
          onValueChange={(editor) => void settings.save({ ...values, editor }, settings.revision)}
        />
        {values.editor === "custom" ? (
          <SettingsInput
            label="Command"
            hint="A command on the daemon's PATH, an absolute path, or a .app bundle (which opens without a line number)."
            placeholder="/Applications/PhpStorm.app/Contents/MacOS/phpstorm"
            initialValue={values.customCommand}
            onChangeText={(text) => saveText("customCommand", text)}
          />
        ) : null}
        {values.editor === "custom" ? (
          <SettingsInput
            label="Arguments"
            hint='Use {file} for the file and {line} for the line. Quote arguments containing spaces. Example: --line {line} "{file}"'
            placeholder="{file}"
            initialValue={values.customArgs}
            onChangeText={(text) => saveText("customArgs", text)}
          />
        ) : null}
        {settings.saveError ? (
          <SettingsRow label="Not saved" error={settings.saveError} />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
