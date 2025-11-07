import fs from "node:fs/promises";

export async function existsDir(dir: string): Promise<boolean> {
  try {
    const s = await fs.stat(dir);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export function resolveUrl(urlStr: string): URL {
  try {
    return new URL(urlStr);
  } catch {
    return new URL("http://127.0.0.1:11434");
  }
}

export function parseList(input?: string | string[]): string[] | undefined {
  if (!input) return undefined;
  if (Array.isArray(input)) return input;
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
