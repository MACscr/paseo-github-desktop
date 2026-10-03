import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { which } from "../server/process";
import { findTrasher, TRASHERS } from "../server/trash";

let bin: string;
let savedPath: string | undefined;

function stub(name: string) {
  const file = join(bin, name);
  writeFileSync(file, "#!/bin/sh\nexit 0\n");
  chmodSync(file, 0o755);
}

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), "gd-bin-"));
  savedPath = process.env.PATH;
  process.env.PATH = bin;
});

afterEach(() => {
  process.env.PATH = savedPath;
  rmSync(bin, { recursive: true, force: true });
});

describe("finding a Trash", () => {
  it("prefers gio on Linux, then trash-cli, then KDE", async () => {
    stub("trash-put");
    stub("kioclient5");
    expect((await findTrasher("linux"))?.trasher.name).toBe("trash-cli");
    stub("gio");
    expect((await findTrasher("linux"))?.trasher.name).toBe("gio");
  });

  it("reports no Trash when none of the commands exist", async () => {
    expect(await findTrasher("linux")).toBeNull();
    expect(await findTrasher("freebsd")).toBeNull();
  });

  it("passes the path safely to each command", () => {
    const path = "/repo/-rf weird name.txt";
    const linux = Object.fromEntries(TRASHERS.linux!.map((t) => [t.command, t.args(path)]));
    // `--` stops a path starting with "-" being read as an option.
    expect(linux.gio).toEqual(["trash", "--", path]);
    expect(linux["trash-put"]).toEqual(["--", path]);
    expect(linux.kioclient5).toEqual(["move", path, "trash:/"]);
    const windows = TRASHERS.win32![0]!;
    expect(windows.args(path).join(" ")).not.toContain(path);
    expect(windows.env?.(path)).toEqual({ PASEO_TRASH_PATH: path });
  });
});

describe("which", () => {
  it("finds executables on PATH and ignores ones that are not executable", async () => {
    stub("cursor");
    writeFileSync(join(bin, "notes"), "not a program");
    expect(await which("cursor")).toBe(join(bin, "cursor"));
    expect(await which("notes")).toBeNull();
    expect(await which("missing")).toBeNull();
  });
});
