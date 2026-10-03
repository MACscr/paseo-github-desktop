import { ReviewAttachmentSchema } from "@getpaseo/protocol/messages";
import { describe, expect, it } from "vitest";
import { parseDiff } from "../client/diff-parse";
import { buildContext, commentAnchor, commitScope, type ReviewComment, reviewMessage, toAttachments } from "../client/review";

const patch = [
  "@@ -1,7 +1,7 @@",
  " one",
  " two",
  " three",
  "-four",
  "+4",
  " five",
  " six",
  " seven",
  "@@ -20,2 +20,3 @@",
  " twenty",
  "+twenty-one",
  " twenty-two",
].join("\n");
const rows = parseDiff(patch).rows;

describe("comment anchors", () => {
  it("anchors removed lines on the old side and everything else on the new side", () => {
    expect(commentAnchor(rows[4]!)).toEqual({ side: "old", lineNumber: 4 });
    expect(commentAnchor(rows[5]!)).toEqual({ side: "new", lineNumber: 4 });
    expect(commentAnchor(rows[1]!)).toEqual({ side: "new", lineNumber: 1 });
    expect(commentAnchor(rows[0]!)).toBeNull();
  });
});

describe("comment context", () => {
  it("takes three lines either side of the target inside its hunk", () => {
    const context = buildContext(rows, 5)!;
    expect(context.hunkHeader).toBe("@@ -1,7 +1,7 @@");
    expect(context.targetLine).toEqual({ oldLineNumber: null, newLineNumber: 4, type: "add", content: "4" });
    expect(context.lines.map((line) => line.content)).toEqual(["two", "three", "four", "4", "five", "six", "seven"]);
  });

  it("never crosses into the next hunk", () => {
    const context = buildContext(rows, 11)!;
    expect(context.hunkHeader).toBe("@@ -20,2 +20,3 @@");
    expect(context.lines.map((line) => line.content)).toEqual(["twenty", "twenty-one", "twenty-two"]);
  });

  it("has no context for a hunk header", () => {
    expect(buildContext(rows, 0)).toBeNull();
  });
});

describe("attachments", () => {
  const base = { side: "new" as const, lineNumber: 4, context: buildContext(rows, 5)! };
  const comments: ReviewComment[] = [
    { id: "a", scope: { mode: "uncommitted" }, filePath: "a.ts", body: "rename this", ...base },
    { id: "b", scope: commitScope("abcdef1234567890", "1234567890abcdef"), filePath: "b.ts", body: "why?", ...base },
    { id: "c", scope: { mode: "uncommitted" }, filePath: "c.ts", body: "and this", ...base },
  ];

  it("groups comments into one Paseo review attachment per diff", () => {
    const attachments = toAttachments("/repo", comments);
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      type: "review",
      mimeType: "application/paseo-review",
      cwd: "/repo",
      mode: "uncommitted",
    });
    expect(attachments[0]!.comments.map((comment) => comment.filePath)).toEqual(["a.ts", "c.ts"]);
    expect(attachments[0]!.comments[0]).not.toHaveProperty("id");
    expect(attachments[1]).toMatchObject({ mode: "base", baseRef: "1234567890ab..abcdef123456" });
  });

  it("matches the attachment schema Paseo's daemon validates", () => {
    for (const attachment of toAttachments("/repo", comments)) {
      expect(ReviewAttachmentSchema.safeParse(attachment).success).toBe(true);
    }
  });

  it("uses the note as the message, with a default when it is blank", () => {
    expect(reviewMessage(comments, "  ship it after these  ")).toBe("ship it after these");
    expect(reviewMessage(comments.slice(0, 1), " ")).toBe("Please address this review comment.");
    expect(reviewMessage(comments, "")).toBe("Please address these review comments.");
  });
});
