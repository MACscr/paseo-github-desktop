import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { memo } from "react";
import { type GestureResponderEvent, Pressable, Text, View } from "react-native";
import type { FileStatus } from "../shared/git";
import { splitPath } from "./format";
import { palette } from "./theme";
import { type MenuPoint, pointFromEvent } from "./context-menu";
import { contextMenuProps } from "./web";

export const LIST_ROW_HEIGHT = 30;

export function Message({
  theme,
  title,
  detail,
  tone,
  action,
}: {
  theme: PluginTheme;
  title: string;
  detail?: string;
  tone?: "danger";
  action?: { label: string; onPress: () => void };
}) {
  const c = theme.colors;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 }}>
      <Text style={{ color: tone === "danger" ? c.statusDanger : c.foreground, fontSize: 14, fontWeight: "600" }}>
        {title}
      </Text>
      {detail ? (
        <Text selectable style={{ color: c.foregroundMuted, fontSize: 12, textAlign: "center", maxWidth: 480 }}>
          {detail}
        </Text>
      ) : null}
      {action ? <Button theme={theme} label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}

export function Button({ theme, label, onPress }: { theme: PluginTheme; label: string; onPress: () => void }) {
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        marginTop: 4,
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 6,
        backgroundColor: c.accent,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ color: c.accentForeground, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  theme,
  icon,
  label,
  onPress,
}: {
  theme: PluginTheme;
  icon: string;
  label: string;
  onPress: (event: GestureResponderEvent) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ padding: 6, borderRadius: 6, opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name={icon} size={15} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}

const STATUS_ICON: Record<FileStatus, { icon: string; tone: "success" | "warning" | "danger" | "accent"; label: string }> = {
  added: { icon: "Plus", tone: "success", label: "Added" },
  untracked: { icon: "Plus", tone: "success", label: "New" },
  modified: { icon: "Dot", tone: "warning", label: "Modified" },
  typechange: { icon: "Replace", tone: "warning", label: "Type changed" },
  deleted: { icon: "Minus", tone: "danger", label: "Deleted" },
  conflicted: { icon: "TriangleAlert", tone: "danger", label: "Conflicted" },
  renamed: { icon: "ArrowRight", tone: "accent", label: "Renamed" },
  copied: { icon: "Copy", tone: "accent", label: "Copied" },
};

function toneColor(theme: PluginTheme, tone: "success" | "warning" | "danger" | "accent") {
  const c = theme.colors;
  return tone === "success" ? c.statusSuccess : tone === "warning" ? c.statusWarning : tone === "danger" ? c.statusDanger : c.accent;
}

export function StatusBadge({ theme, status }: { theme: PluginTheme; status: FileStatus }) {
  const spec = STATUS_ICON[status];
  const color = toneColor(theme, spec.tone);
  return (
    <View
      accessibilityLabel={spec.label}
      style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        borderWidth: 1.5,
        borderColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={spec.icon} size={status === "modified" ? 16 : 11} color={color} />
    </View>
  );
}

export const FileRow = memo(function FileRow({
  theme,
  path,
  status,
  selected,
  additions,
  deletions,
  onPress,
  onMenu,
  showMenuButton,
}: {
  theme: PluginTheme;
  path: string;
  status: FileStatus;
  selected: boolean;
  additions?: number | null;
  deletions?: number | null;
  onPress: (path: string) => void;
  /** Opens the file's actions; reached by right-click, long-press, or the ⋯ button. */
  onMenu?: (path: string, point: MenuPoint) => void;
  showMenuButton?: boolean;
}) {
  const c = theme.colors;
  const { dir, name } = splitPath(path);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${STATUS_ICON[status].label} ${path}`}
      accessibilityHint={onMenu ? "Long-press for file actions" : undefined}
      onPress={() => onPress(path)}
      onLongPress={onMenu ? (event) => onMenu(path, pointFromEvent(event)) : undefined}
      {...(onMenu ? contextMenuProps((event) => onMenu(path, pointFromEvent(event))) : {})}
      style={{
        height: LIST_ROW_HEIGHT,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: selected ? palette(theme).selected : "transparent",
      }}
    >
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5 }}>
        <Text style={{ color: c.foregroundMuted }}>{dir}</Text>
        <Text style={{ color: c.foreground }}>{name}</Text>
      </Text>
      {additions != null ? (
        <Text style={{ fontSize: 11, color: c.foregroundMuted }}>
          <Text style={{ color: c.statusSuccess }}>+{additions}</Text> <Text style={{ color: c.statusDanger }}>−{deletions}</Text>
        </Text>
      ) : null}
      <StatusBadge theme={theme} status={status} />
      {onMenu && (showMenuButton || selected) ? (
        <IconButton
          theme={theme}
          icon="Ellipsis"
          label={`Actions for ${path}`}
          onPress={(event) => onMenu(path, pointFromEvent(event))}
        />
      ) : null}
    </Pressable>
  );
});

export function Tabs<T extends string>({
  theme,
  tabs,
  value,
  onChange,
}: {
  theme: PluginTheme;
  tabs: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  const c = theme.colors;
  return (
    <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: c.border }}>
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(tab.id)}
            style={{
              flex: 1,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
              borderBottomWidth: 2,
              borderBottomColor: active ? c.accent : "transparent",
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: active ? "600" : "400", color: active ? c.foreground : c.foregroundMuted }}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Divider({ theme, vertical }: { theme: PluginTheme; vertical?: boolean }) {
  return (
    <View
      style={vertical ? { width: 1, backgroundColor: theme.colors.border } : { height: 1, backgroundColor: theme.colors.border }}
    />
  );
}
