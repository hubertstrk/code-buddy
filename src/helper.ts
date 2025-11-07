import fs from "node:fs/promises";

export async function existsDir(dir: string): Promise<boolean> {
  try {
    const s = await fs.stat(dir);
    return s.isDirectory();
  } catch {
    return false;
  }
}
