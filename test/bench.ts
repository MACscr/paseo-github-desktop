// Times the daemon handlers against a real repository: npm run bench -- /path/to/repo
import { clearCaches, getCommit, getFileDiff, getLog, getStatus } from "../server/repo";

const cwd = process.argv[2] ?? process.cwd();

async function time<T>(label: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await run();
  console.log(`${label.padEnd(36)} ${(performance.now() - start).toFixed(1).padStart(7)} ms`);
  return result;
}

clearCaches();
const status = await time("status (cold)", () => getStatus({ cwd }));
if (status.state !== "ok") throw new Error(status.message);
await time("status (warm)", () => getStatus({ cwd }));
console.log(`  ${status.files.length} changed files on ${status.repo.branch}`);

const headSha = status.repo.headSha!;
const page = await time("log first page (cold)", () => getLog({ cwd, headSha, skip: 0, limit: 100 }));
await time("log first page (warm markers)", () => getLog({ cwd, headSha, skip: 0, limit: 100 }));
await time("log page at skip=1000", () => getLog({ cwd, headSha, skip: 1000, limit: 100 }));
console.log(`  base ${page.base}, ${page.commits.filter((c) => c.notOnBase).length} of first 100 not on base`);

const first = page.commits[0]!;
const detail = await time("commit detail (cold)", () => getCommit({ cwd, sha: first.sha }));
await time("commit detail (cached)", () => getCommit({ cwd, sha: first.sha }));
const file = detail.files[0];
if (file) {
  const source = { kind: "commit", sha: first.sha, parent: detail.parents[0] ?? null, path: file.path, origPath: file.origPath } as const;
  await time(`file diff (cold) ${file.path.slice(-18)}`, () => getFileDiff({ cwd, source }));
  await time("file diff (cached)", () => getFileDiff({ cwd, source }));
}
const changed = status.files[0];
if (changed) {
  await time(`worktree diff ${changed.path.slice(-22)}`, () =>
    getFileDiff({ cwd, source: { kind: "worktree", path: changed.path, origPath: changed.origPath, status: changed.status } }),
  );
}
