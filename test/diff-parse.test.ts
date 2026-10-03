import { describe, expect, it } from "vitest";
import { MAX_LINE_CHARS, parseDiff } from "../client/diff-parse";

describe("parseDiff", () => {
  it("numbers old and new lines across hunks", () => {
    const parsed = parseDiff(
      [
        "@@ -1,3 +1,3 @@ fn main",
        " keep",
        "-old",
        "+new",
        " keep",
        "@@ -10,2 +10,3 @@",
        " ten",
        "+added",
        " eleven",
        "",
      ].join("\n"),
    );
    expect(parsed.rows.map((r) => [r.kind, r.oldNo, r.newNo, r.text])).toEqual([
      ["hunk", null, null, "@@ -1,3 +1,3 @@ fn main"],
      ["ctx", 1, 1, "keep"],
      ["del", 2, null, "old"],
      ["add", null, 2, "new"],
      ["ctx", 3, 3, "keep"],
      ["hunk", null, null, "@@ -10,2 +10,3 @@"],
      ["ctx", 10, 10, "ten"],
      ["add", null, 11, "added"],
      ["ctx", 11, 12, "eleven"],
    ]);
    expect(parsed).toMatchObject({ additions: 2, deletions: 1, maxLineNo: 13 });
  });

  it("keeps no-newline markers, expands tabs, and caps very long lines", () => {
    const long = "x".repeat(MAX_LINE_CHARS + 50);
    const parsed = parseDiff(`@@ -1 +1 @@\n-\tindented\n\\ No newline at end of file\n+${long}\n`);
    expect(parsed.rows[1]).toMatchObject({ kind: "del", text: "    indented" });
    expect(parsed.rows[2]).toMatchObject({ kind: "meta", text: "No newline at end of file" });
    expect(parsed.rows[3]!.text).toHaveLength(MAX_LINE_CHARS + 1);
    expect(parsed.maxChars).toBe(MAX_LINE_CHARS + 1);
  });

  it("parses a 5,000 line diff quickly", () => {
    const patch = ["@@ -1,5000 +1,5000 @@", ...Array.from({ length: 5000 }, (_, i) => `${i % 3 ? " " : "+"}line ${i}`)].join("\n");
    const start = performance.now();
    const parsed = parseDiff(patch);
    expect(parsed.rows).toHaveLength(5001);
    expect(performance.now() - start).toBeLessThan(250);
  });
});
