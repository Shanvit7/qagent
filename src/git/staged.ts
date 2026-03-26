import simpleGit from "simple-git";
import { resolve } from "node:path";

export interface StagedFile {
  path: string;
  status: "A" | "M" | "D" | "R" | "C" | "?";
  diff: string;
}

const parseStatus = (raw: string): StagedFile["status"] => {
  const first = raw[0]?.toUpperCase();
  if (first === "A") return "A";
  if (first === "M") return "M";
  if (first === "D") return "D";
  if (first === "R") return "R";
  if (first === "C") return "C";
  return "?";
};

const getFileDiff = async (
  git: ReturnType<typeof simpleGit>,
  filePath: string
): Promise<string> => {
  try {
    return await git.diff(["--staged", "--", filePath]);
  } catch {
    return "";
  }
};

/**
 * Returns all staged files with their diffs.
 */
export const getStagedFiles = async (cwd: string = process.cwd()): Promise<StagedFile[]> => {
  const git = simpleGit(cwd);
  const statusResult = await git.diff(["--staged", "--name-status"]);

  if (!statusResult.trim()) return [];

  const lines = statusResult.trim().split("\n");

  const files = await Promise.all(
    lines.map(async (line) => {
      const parts = line.split("\t");
      const rawStatus = parts[0]?.trim() ?? "?";
      const filePath = parts[1]?.trim() ?? parts[0] ?? "";

      if (!filePath) return null;

      const status = parseStatus(rawStatus);
      const diff = await getFileDiff(git, filePath);

      return { path: resolve(cwd, filePath), status, diff } satisfies StagedFile;
    })
  );

  return files.filter((f): f is StagedFile => f !== null);
};
