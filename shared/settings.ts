import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const EditorChoice = z.enum(["auto", "code", "cursor", "zed", "subl", "custom"]);
export type EditorChoice = z.infer<typeof EditorChoice>;

export const editorSettings = defineSettings({
  id: "editor",
  scope: "host",
  version: 1,
  schema: z.object({
    editor: EditorChoice.default("auto"),
    /** Program for "custom": a name on the daemon's PATH or an absolute path. */
    customCommand: z.string().default(""),
    /** Arguments for "custom". `{file}` is the absolute path and `{line}` the line number (1 when none). */
    customArgs: z.string().default("{file}"),
  }),
});

export const detectEditorsRpc = defineRpc({
  name: "editors.detect",
  input: z.object({}),
  output: z.object({ installed: z.array(EditorChoice) }),
});
