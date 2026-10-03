import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { type GestureResponderEvent, type LayoutChangeEvent, Pressable, Text, View } from "react-native";

/** A point in window coordinates, from a press, long-press, or right-click. */
export interface MenuPoint {
  x: number;
  y: number;
}

type MenuContent = (close: () => void) => ReactNode;

const MenuContext = createContext<((point: MenuPoint, content: MenuContent) => void) | null>(null);

const MENU_WIDTH = 240;
const EDGE = 8;

export function pointFromEvent(event: GestureResponderEvent | { nativeEvent: unknown }): MenuPoint {
  const native = event.nativeEvent as { clientX?: number; clientY?: number; pageX?: number; pageY?: number };
  return { x: native.clientX ?? native.pageX ?? 0, y: native.clientY ?? native.pageY ?? 0 };
}

/** Hosts one floating menu over its children, positioned where it was opened and kept inside the panel. */
export function ContextMenuProvider({ theme, children }: { theme: PluginTheme; children: ReactNode }) {
  const c = theme.colors;
  const root = useRef<View>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; content: MenuContent } | null>(null);
  const [menuHeight, setMenuHeight] = useState(0);
  const close = useCallback(() => setMenu(null), []);

  const open = useCallback((point: MenuPoint, content: MenuContent) => {
    const view = root.current;
    if (!view) return;
    view.measureInWindow((left, top) => {
      setMenuHeight(0);
      setMenu({ x: point.x - left, y: point.y - top, content });
    });
  }, []);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  }, []);

  const position = useMemo(() => {
    if (!menu) return null;
    const left = Math.max(EDGE, Math.min(menu.x, size.width - MENU_WIDTH - EDGE));
    // Flip above the pointer when the menu would run off the bottom.
    const below = menu.y + menuHeight + EDGE <= size.height;
    const top = below ? menu.y : Math.max(EDGE, menu.y - menuHeight);
    return { left, top };
  }, [menu, menuHeight, size]);

  return (
    <MenuContext.Provider value={open}>
      <View ref={root} style={{ flex: 1, minHeight: 0 }} onLayout={onLayout}>
        {children}
        {menu && position ? (
          <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
            <Pressable accessibilityLabel="Close menu" onPress={close} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
            <View
              accessibilityRole="menu"
              onLayout={(event) => setMenuHeight(event.nativeEvent.layout.height)}
              style={{
                position: "absolute",
                left: position.left,
                top: position.top,
                width: MENU_WIDTH,
                padding: 4,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.surface1,
                shadowColor: "#000",
                shadowOpacity: 0.25,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: 8,
                opacity: menuHeight === 0 ? 0 : 1,
              }}
            >
              {menu.content(close)}
            </View>
          </View>
        ) : null}
      </View>
    </MenuContext.Provider>
  );
}

export function useContextMenu() {
  const open = useContext(MenuContext);
  if (!open) throw new Error("useContextMenu must be used inside ContextMenuProvider");
  return open;
}

export function MenuItem({
  theme,
  icon,
  label,
  danger,
  disabled,
  onPress,
}: {
  theme: PluginTheme;
  icon: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const c = theme.colors;
  const color = danger ? c.statusDanger : c.foreground;
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 5,
        opacity: disabled ? 0.5 : 1,
        backgroundColor: pressed || hovered ? c.surface2 : "transparent",
      })}
    >
      <Icon name={icon} size={15} color={color} />
      <Text style={{ fontSize: 13, color }}>{label}</Text>
    </Pressable>
  );
}

export function MenuSeparator({ theme }: { theme: PluginTheme }) {
  return <View style={{ height: 1, marginVertical: 4, backgroundColor: theme.colors.border }} />;
}
