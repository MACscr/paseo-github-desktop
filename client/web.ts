import { Platform } from "react-native";

interface ContextMenuEvent {
  preventDefault(): void;
  nativeEvent?: unknown;
}

/** Right-click props for a Pressable on desktop; nothing on native, where long-press opens the same menu. */
export function contextMenuProps(onOpen: (event: { nativeEvent: unknown }) => void): object {
  if (Platform.OS !== "web") return {};
  return {
    onContextMenu: (event: ContextMenuEvent) => {
      event.preventDefault();
      // React Native Web passes the DOM event itself; its clientX/clientY are what the menu needs.
      onOpen({ nativeEvent: event.nativeEvent ?? event });
    },
  };
}
